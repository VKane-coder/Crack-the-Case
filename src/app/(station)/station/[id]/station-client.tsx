"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CheckCircle2, ClipboardList, ListChecks, Loader2, Presentation, RotateCcw, UserRound, Volume2, VolumeX } from "lucide-react";
import { faceFor, PatientStage } from "@/components/station/patient-stage";
import { formatClock, PhaseTimer } from "@/components/station/phase-timer";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AudioQueue } from "@/features/station/audio-queue";
import type { AvatarLink, AvatarState } from "@/features/station/avatar-link";
import type { AvatarAccess } from "@/features/station/avatar-protocol";
import { pcmRate, pcmToWav } from "@/features/station/pcm";
import { readNdjson, type PatientStreamEvent } from "@/features/station/ndjson";
import { useSpeechInput } from "@/features/station/use-speech-input";
import type { StationData } from "@/server/station/orchestrator";
import { TalkControls, type Spoken, type TalkControlsHandle } from "./talk-controls";

const POLL_MS = 2_000;
/** Stages that run on the station clock; when it hits zero the station goes straight to marking. */
const STATION_STAGES: string[] = ["history", "history_ended", "presentation", "examiner_questions"];
const STRUCTURE = ["Summary", "Key positives", "Key negatives", "Differentials", "Investigations", "Management"];

type Msg = { role: "student" | "patient"; content: string; emotion?: string | null };
type Media = { url: string; alt: string; caption: string | null };
type Question = { ord: number; text: string; answered: boolean; media?: Media | null };
type ApiResult<T> = { data?: T; error?: { code: string; message: string } };

async function post<T>(url: string, body: object = {}): Promise<ApiResult<T>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: { code: "network", message: "Couldn't reach the server. Please try again." } }));
}

type TurnClock = {
  releasedAt: number | null;
  sentAt: number;
  audioAt?: number;
  server?: { readyMs: number; firstTextMs: number | null; firstAudioMs: number; region: string | null };
};

const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

/** "2.4s to voice: speech-to-text 0.4s · network 0.3s · …" for preview builds, to see where a reply's wait goes. */
function describeLatency(c: TurnClock, playAt: number, last: "playback" | "face" = "playback") {
  const parts = [];
  if (c.releasedAt !== null) parts.push(`speech-to-text ${secs(c.sentAt - c.releasedAt)}`);
  if (c.server && c.audioAt) {
    const s = c.server;
    parts.push(`network + sign-in ${secs(c.audioAt - c.sentAt - s.firstAudioMs)}`);
    parts.push(`database ${secs(s.readyMs)}`);
    if (s.firstTextMs !== null) {
      parts.push(`Claude ${secs(s.firstTextMs - s.readyMs)}`);
      parts.push(`voice ${secs(s.firstAudioMs - s.firstTextMs)}`);
    }
    // "face": LemonSlice animating the reply until LiveKit hears it talking (its speaker detection adds a little).
    parts.push(`${last} ${secs(playAt - c.audioAt)}`);
  }
  const region = c.server?.region ? ` (server ${c.server.region})` : "";
  return `${secs(playAt - (c.releasedAt ?? c.sentAt))} to voice${region}: ${parts.join(" · ")}`;
}

export function StationClient({
  station,
  voice,
  showLatency = false,
}: {
  station: StationData;
  voice: { input: boolean; output: boolean };
  showLatency?: boolean;
}) {
  const router = useRouter();
  const api = `/api/consultations/${station.id}`;
  const [status, setStatus] = useState(station.status);
  const [deadline, setDeadline] = useState(station.deadline);
  const [messages, setMessages] = useState<Msg[]>(station.messages);
  const [segments, setSegments] = useState<string[]>(station.presentation);
  const [questions, setQuestions] = useState<Question[]>(station.questions);
  const [emotion, setEmotion] = useState(station.messages.findLast((m) => m.role === "patient")?.emotion ?? "neutral");
  const [live, setLive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [readingEnds] = useState(() =>
    station.readingEndsAt ? Math.max(Date.parse(station.readingEndsAt), Date.now()) : Date.now() + station.readingSeconds * 1000,
  );
  const [timedOut, setTimedOut] = useState(false);
  const finishing = useRef(false);
  const [voiceOn, setVoiceOn] = useState(voice.output);
  const [playing, setPlaying] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [latency, setLatency] = useState<string | null>(null);
  const clock = useRef<TurnClock | null>(null);
  const ending = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const talk = useRef<TalkControlsHandle>(null);
  const audio = useRef<AudioQueue | null>(null);
  // The patient's animated face, when LemonSlice is set up and the case has a picture.
  const avatar = useRef<AvatarLink | null>(null);
  const [avatarLink, setAvatarLink] = useState<AvatarLink | null>(null);
  const [avatarState, setAvatarState] = useState<AvatarState | null>(null);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [avatarProblem, setAvatarProblem] = useState<string | null>(null);
  const avatarRequested = useRef(false);
  const patientStage = useRef(false);
  /** Barge-in: the patient stops talking, whether through the speaker or the animated face. */
  const silence = () => {
    audio.current?.stop();
    avatar.current?.interrupt();
  };
  const player = () =>
    (audio.current ??= new AudioQueue((p) => {
      setPlaying(p);
      // The first sound of a reply ends the measured wait.
      if (p && clock.current?.audioAt) {
        setLatency(describeLatency(clock.current, performance.now()));
        clock.current = null;
      }
    }));
  const speaking = status === "history" || status === "presentation" || status === "examiner_questions";
  const speech = useSpeechInput(station.id, voice.input && speaking);

  useEffect(
    () => () => {
      audio.current?.stop();
      avatar.current?.close();
    },
    [],
  );

  // Closing the tab, leaving or reloading the page ends the face at once (it bills while it runs). The
  // request is sent with keepalive so it still goes out as the page unloads; a reload starts a fresh face.
  useEffect(() => {
    if (!avatarLink) return;
    const end = () => {
      avatarLink.close();
      void fetch(`${api}/avatar`, { method: "DELETE", keepalive: true, headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    };
    // A page restored from the browser's back/forward cache has lost its face: load it afresh.
    const restored = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", end);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pagehide", end);
      window.removeEventListener("pageshow", restored);
    };
  }, [avatarLink, api]);

  // The face starts during reading time (it can take a while to warm up) and goes when the patient stage ends.
  useEffect(() => {
    patientStage.current = status === "briefing" || status === "history";
    if (!patientStage.current) {
      avatar.current?.close();
      return;
    }
    if (!voice.output || avatarRequested.current) return;
    avatarRequested.current = true;
    void post<AvatarAccess | null>(`${api}/avatar`).then(async (res) => {
      if (res.error) setAvatarProblem(res.error.message);
      if (!res.data || !patientStage.current) return; // not set up, no picture for this case, or already moved on
      // Loaded only when there's a face to show: the video library is large.
      const { AvatarLink } = await import("@/features/station/avatar-link");
      if (!patientStage.current) return;
      const link = new AvatarLink(res.data, {
        state: setAvatarState,
        speaking: setAvatarSpeaking,
        // A reply's wait ends when the face is heard talking, not when its audio is handed to LemonSlice.
        heard: () => {
          if (!clock.current?.audioAt) return;
          setLatency(describeLatency(clock.current, performance.now(), "face"));
          clock.current = null;
        },
      });
      avatar.current = link;
      setAvatarLink(link);
      setAvatarState("connecting");
      link.connect().catch(() => {
        link.close();
        setAvatarState("lost");
      });
    });
  }, [status, api, voice.output]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live, segments]);

  // Phase changes -------------------------------------------------------------------------------

  const startHistory = useCallback(async () => {
    audio.current?.unlock();
    avatar.current?.startAudio();
    setBusy(true);
    setError(null);
    const res = await post<{ deadline: string; opening: string | null }>(`${api}/start-history`);
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "Couldn't start the station.");
    setDeadline(res.data.deadline);
    if (res.data.opening) setMessages([{ role: "patient", content: res.data.opening, emotion: "neutral" }]);
    setStatus("history");
    setTimeout(() => talk.current?.focus(), 0);
  }, [api]);

  async function startPresentation() {
    setBusy(true);
    setError(null);
    const res = await post<{ deadline: string }>(`${api}/start-presentation`);
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "Couldn't start the presentation.");
    if (res.data.deadline) setDeadline(res.data.deadline);
    setStatus("presentation");
  }

  /** The student leaves the patient: straight on to presenting, on the same clock. */
  const moveToExaminer = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    silence();
    const res = await post(`${api}/end-history`);
    ending.current = false;
    if (res.error) return setError(res.error.message);
    setStatus("history_ended");
    await startPresentation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPresentation only uses api and setters
  }, [api]);

  const endPresentation = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    setError(null);
    const res = await post<{ question: { ord: number; text: string; media: Media | null } | null; total: number }>(`${api}/end-presentation`);
    ending.current = false;
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "The examiner couldn't load a question. Please try again.");
    if (res.data.question) setQuestions([{ ...res.data.question, answered: false }]);
    setStatus("examiner_questions");
  }, [api]);

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    const res = await post(`${api}/finish`);
    setBusy(false);
    finishing.current = false;
    if (res.error) return setError(res.error.message);
    setStatus("assessing");
  }

  /** The station clock ran out: like the bell in a real OSCE, everything stops and marking begins. */
  const timeUp = useCallback(() => {
    if (finishing.current) return;
    silence();
    setTimedOut(true);
    void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish only uses api and setters
  }, [api]);

  async function retry() {
    setBusy(true);
    const res = await post(`${api}/retry-assessment`);
    setBusy(false);
    if (res.error) return setError(res.error.message);
    setStatus("assessing");
  }

  // The clock: re-renders timers and makes the phase changes a real OSCE makes on its own. The
  // latest state is read through a ref so the interval is set up once.
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    tick.current = () => {
      const t = Date.now();
      if (status === "briefing" && t >= readingEnds && !busy) void startHistory();
      if (STATION_STAGES.includes(status) && deadline && Date.parse(deadline) <= t) timeUp();
    };
  });
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      tick.current();
    }, 250);
    return () => clearInterval(t);
  }, []);

  // While the examiner marks, poll until the report is ready, then navigate exactly once: pushing
  // again while the report page loads would restart that navigation.
  useEffect(() => {
    if (status !== "assessing") return;
    let stopped = false;
    const t = setInterval(async () => {
      const res = await fetch(`${api}/result`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const next = res?.data?.status as string | undefined;
      if (stopped || (next !== "completed" && next !== "assessment_failed")) return;
      stopped = true;
      clearInterval(t);
      if (next === "completed") {
        setStatus("completed");
        router.push(`/results/${station.id}`);
      } else setStatus("assessment_failed");
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [status, api, router, station.id]);

  const remaining = deadline ? Date.parse(deadline) - now : 0;

  // Speaking in each phase -----------------------------------------------------------------------

  async function askPatient(utterance: string, spoken?: Spoken): Promise<boolean> {
    if (live !== null || status !== "history") return false;
    const clientSeq = messages.filter((m) => m.role === "student").length;
    setError(null);
    silence();
    setMessages((m) => [...m, { role: "student", content: utterance }]);
    setLive("");

    let reply = "";
    let replyEmotion = emotion;
    let committed = false;
    let failure: { code: string; message: string } | null = null;
    // "done" arrives as soon as the turn is saved; audio for the last sentences may still follow.
    const commit = () => {
      if (committed || !reply) return;
      committed = true;
      setLive(null);
      setMessages((m) => [...m, { role: "patient", content: reply, emotion: replyEmotion }]);
    };
    clock.current = { releasedAt: spoken?.releasedAt ?? null, sentAt: performance.now() };
    try {
      const res = await fetch(`${api}/patient-turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          utterance,
          clientSeq,
          voice: voiceOn,
          avatar: voiceOn && avatar.current?.state === "ready",
          sttSeconds: spoken?.seconds ?? 0,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        failure = body?.error ?? { code: "network", message: "The patient didn't catch that. Please try again." };
      } else {
        await readNdjson<PatientStreamEvent>(res.body, (ev) => {
          if (ev.type === "emotion") setEmotion((replyEmotion = ev.emotion));
          else if (ev.type === "text") setLive((reply = reply ? `${reply} ${ev.text}` : ev.text));
          else if (ev.type === "reset") {
            setLive((reply = ""));
            silence();
          } else if (ev.type === "audio" && voiceOn) {
            setVoiceError(null);
            if (clock.current && !clock.current.audioAt) clock.current.audioAt = performance.now();
            const rate = pcmRate(ev.mime);
            if (rate === null) player().enqueue(ev.data, ev.mime);
            else if (!avatar.current?.speak(ev.data)) player().enqueue(pcmToWav(ev.data, rate), "audio/wav"); // the face dropped out mid-reply
          } else if (ev.type === "voice_error") setVoiceError(ev.code);
          else if (ev.type === "timing" && clock.current) clock.current.server = ev;
          else if (ev.type === "done") commit();
          else if (ev.type === "error") failure = ev;
        });
      }
    } catch {
      if (!committed) failure = { code: "network", message: "Connection lost. Please try again." };
    }
    avatar.current?.endReply();

    if (committed) return true; // a dropped connection after "done" only loses trailing audio
    setLive(null);
    if (failure) {
      const f = failure as { code: string; message: string };
      setMessages((m) => m.slice(0, -1));
      if (f.code === "phase_over") {
        timeUp();
        return true;
      }
      setError(f.message);
      return false; // keeps a typed question in the box so it can be resent
    }
    if (reply) setMessages((m) => [...m, { role: "patient", content: reply, emotion: replyEmotion }]);
    return true;
  }

  async function present(text: string): Promise<boolean> {
    setError(null);
    setSegments((s) => [...s, text]);
    const res = await post(`${api}/presentation-segment`, { text, clientSeq: segments.length });
    if (!res.error) return true;
    setSegments((s) => s.slice(0, -1));
    if (res.error.code === "phase_over") timeUp();
    else setError(res.error.message);
    return false;
  }

  async function answer(text: string): Promise<boolean> {
    const current = questions.find((q) => !q.answered);
    if (!current) return false;
    setError(null);
    setBusy(true);
    const res = await post<{ question: { ord: number; text: string; media: Media | null } | null }>(`${api}/examiner-answer`, {
      ord: current.ord,
      answer: text,
    });
    setBusy(false);
    if (!res.data) {
      if (res.error?.code === "phase_over") {
        timeUp();
        return true;
      }
      setError(res.error?.message ?? "Couldn't save that answer.");
      return false;
    }
    const next = res.data.question;
    setQuestions((qs) => {
      const done = qs.map((q) => (q.ord === current.ord ? { ...q, answered: true } : q));
      return next && !done.some((q) => q.ord === next.ord) ? [...done, { ...next, answered: false }] : done;
    });
    if (!next) void finish();
    return true;
  }

  const errorBox = error && (
    <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
      {error}
    </p>
  );

  // Screens --------------------------------------------------------------------------------------

  if (status === "briefing" || status === "created") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
              <BookOpen className="size-3.5" /> Reading time
            </p>
            <h1 className="text-2xl font-black">Your candidate brief</h1>
          </div>
          <PhaseTimer remainingMs={readingEnds - now} label="Reading" warnAtMs={10_000} />
        </div>
        <Card>
          <p className="text-lg leading-relaxed whitespace-pre-line">{station.brief}</p>
          {station.readingMedia.map((m) => (
            <MediaFigure key={m.url} media={m} />
          ))}
        </Card>
        <Card>
          <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
            <ListChecks className="size-3.5" /> Your task
          </p>
          {station.tasks.length ? (
            <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
              {station.tasks.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          ) : (
            <p className="leading-relaxed whitespace-pre-line">{station.task}</p>
          )}
          <p className="text-sm text-muted-foreground">
            When reading time ends, you&apos;ll have {formatClock(station.stationSeconds * 1000)} for the whole station: {station.patient.name} first, then the
            examiner. If time runs out, the station ends and goes straight to marking.{" "}
            {voice.input
              ? "Hold the talk button (or the space bar) while you speak, and let go when you've finished. You can also type."
              : "Type what you'd say."}
          </p>
        </Card>
        {errorBox}
        <Button size="lg" onClick={startHistory} disabled={busy} className="self-start">
          I&apos;m ready, bring the patient in
        </Button>
      </div>
    );
  }

  if (status === "history") {
    return (
      <div className="flex h-[calc(100dvh-7.5rem)] flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <PatientStage
            name={station.patient.name}
            age={station.patient.age}
            emotion={emotion ?? "neutral"}
            speaking={live !== null || playing || avatarSpeaking}
            avatarUrl={station.patient.avatarUrl}
          />
          <PhaseTimer remainingMs={remaining} label="Station" />
        </div>
        {avatarLink && avatarState === "ready" && <AvatarFace link={avatarLink} name={station.patient.name} />}
        <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto rounded-2xl border bg-muted/30 p-4" role="log" aria-live="polite" aria-label="Consultation">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} emotion={m.emotion}>
              {m.content}
            </Bubble>
          ))}
          {live !== null && (
            <Bubble role="patient" emotion={emotion}>
              {live || <span className="text-muted-foreground">…</span>}
            </Bubble>
          )}
        </div>
        {errorBox}
        <TalkControls
          ref={talk}
          speech={speech}
          voiceInput={voice.input}
          busy={live !== null}
          onTalkStart={() => {
            player().unlock();
            avatar.current?.startAudio();
            silence();
          }}
          onSubmit={askPatient}
          onError={setError}
          label="Your question to the patient"
          placeholder={voice.input ? "Or type a question…" : `Ask ${station.patient.name.split(" ")[0]} a question…`}
        />
        {showLatency && latency && <p className="text-center text-xs text-muted-foreground">{latency}</p>}
        {avatarState === "connecting" && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            Bringing {station.patient.name.split(" ")[0]} in… you can start talking now.
          </p>
        )}
        {avatarState === "lost" && voiceOn && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            {station.patient.name.split(" ")[0]}&apos;s animated face isn&apos;t available right now, so you&apos;ll hear their voice only.
          </p>
        )}
        {showLatency && avatarProblem && (
          <p className="text-center text-xs text-muted-foreground">Preview: animated face unavailable ({avatarProblem})</p>
        )}
        {voiceOn && voiceError && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            {station.patient.name.split(" ")[0]}&apos;s voice isn&apos;t working right now, so replies are text only.{" "}
            <span className="opacity-70">({voiceError})</span>
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {voice.output && (
            <Button
              variant="ghost"
              onClick={() => {
                if (voiceOn) silence();
                setVoiceOn(!voiceOn);
              }}
              aria-pressed={voiceOn}
            >
              {voiceOn ? <Volume2 /> : <VolumeX />} Patient voice {voiceOn ? "on" : "off"}
            </Button>
          )}
          <Button variant="outline" onClick={moveToExaminer} disabled={busy}>
            Move to the examiner <ArrowRight />
          </Button>
        </div>
      </div>
    );
  }

  if (status === "history_ended") {
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <CheckCircle2 className="text-brand-teal" /> History complete
            </CardTitle>
            <CardDescription>
              {messages.filter((m) => m.role === "student").length} questions asked. Now present your findings to the examiner. The station
              clock is still running: {formatClock(remaining)} left.
            </CardDescription>
          </CardHeader>
          <StructureHint />
          {errorBox}
          <Button size="lg" onClick={startPresentation} disabled={busy} className="self-start">
            <Presentation /> Start presenting
          </Button>
        </Card>
        <Transcript messages={messages} />
      </div>
    );
  }

  if (status === "presentation") {
    return (
      <div className="flex h-[calc(100dvh-7.5rem)] flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <ExaminerStage caption={busy ? "reviewing your presentation…" : "listening"} />
          <PhaseTimer remainingMs={remaining} label="Station" />
        </div>
        <StructureHint compact />
        <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto rounded-2xl border bg-muted/30 p-4" role="log" aria-live="polite" aria-label="Presentation so far">
          {segments.length === 0 && <p className="text-center text-sm text-muted-foreground">Present in your own words. The examiner listens without interrupting.</p>}
          {segments.map((s, i) => (
            <Bubble key={i} role="student">
              {s}
            </Bubble>
          ))}
        </div>
        {errorBox}
        <TalkControls
          ref={talk}
          speech={speech}
          voiceInput={voice.input}
          busy={busy}
          onSubmit={present}
          onError={setError}
          label="Your presentation"
          placeholder={voice.input ? "Or type part of your presentation…" : "Present your findings…"}
        />
        <Button variant="outline" onClick={endPresentation} disabled={busy} className="self-center">
          {busy ? <Loader2 className="animate-spin" /> : null} I&apos;ve finished presenting <ArrowRight />
        </Button>
      </div>
    );
  }

  if (status === "examiner_questions") {
    const current = questions.find((q) => !q.answered);
    const asked = questions.filter((q) => q.answered).length + (current ? 1 : 0);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <ExaminerStage caption={busy ? "noting your answer…" : current ? "waiting for your answer" : "finishing up…"} />
          <PhaseTimer remainingMs={remaining} label="Station" />
        </div>
        <Card className="border-brand-purple/30">
          <p className="text-xs font-extrabold tracking-wide text-brand-purple uppercase">
            Examiner · question {asked}
          </p>
          <p className="text-xl leading-relaxed font-bold" aria-live="polite">
            {current?.text ?? "Thank you. That's the end of the station."}
          </p>
          {current?.media && <MediaFigure media={current.media} />}
        </Card>
        {errorBox}
        {current && (
          <TalkControls
            ref={talk}
            speech={speech}
            voiceInput={voice.input}
            busy={busy}
            onSubmit={answer}
            onError={setError}
            label="Your answer to the examiner"
            placeholder={voice.input ? "Or type your answer…" : "Type your answer…"}
            maxChars={1500}
          />
        )}
        {!current && (
          <Button size="lg" onClick={finish} disabled={busy} className="self-start">
            See my results
          </Button>
        )}
      </div>
    );
  }

  if (status === "assessing") {
    return (
      <Card className="items-center py-12 text-center">
        <Loader2 className="size-10 animate-spin text-brand-purple motion-reduce:animate-none" aria-hidden />
        <CardTitle className="text-2xl">{timedOut ? "Time's up!" : "The examiner is writing your report…"}</CardTitle>
        <CardDescription>
          {timedOut ? "The examiner is marking what you completed. " : ""}Marking every rubric item against your transcript. This usually takes
          under a minute.
        </CardDescription>
      </Card>
    );
  }

  if (status === "assessment_failed") {
    return (
      <Card>
        <CardTitle>The examiner couldn&apos;t finish your report</CardTitle>
        <CardDescription>Your station is saved. Try again, and if it still doesn&apos;t work, come back a little later.</CardDescription>
        {errorBox}
        <Button onClick={retry} disabled={busy} className="self-start">
          <RotateCcw /> Try again
        </Button>
      </Card>
    );
  }

  if (status === "completed") {
    return (
      <Card>
        <CardTitle>Station complete</CardTitle>
        <Button asChild className="self-start">
          <Link href={`/results/${station.id}`}>See your report</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>This station has finished</CardTitle>
      <CardDescription>Start a fresh case from your hub whenever you&apos;re ready.</CardDescription>
      <Button asChild className="self-start">
        <Link href="/hub">Back to the hub</Link>
      </Button>
    </Card>
  );
}

/** A case image (reading material or an examiner item), from a short-lived signed link. */
function MediaFigure({ media }: { media: Media }) {
  return (
    <figure className="space-y-1.5">
      <a href={media.url} target="_blank" rel="noreferrer" title="Open full size">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, not optimisable */}
        <img src={media.url} alt={media.alt} className="max-h-[50dvh] w-full rounded-xl border bg-white object-contain" />
      </a>
      {media.caption && <figcaption className="text-sm text-muted-foreground">{media.caption}</figcaption>}
    </figure>
  );
}

function StructureHint({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-sm", compact && "text-xs")} aria-label="Suggested structure">
      <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
      {STRUCTURE.map((s) => (
        <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 font-semibold text-muted-foreground">
          {s}
        </span>
      ))}
    </div>
  );
}

function ExaminerStage({ caption }: { caption: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 place-items-center rounded-full bg-brand-purple/10 text-brand-purple" aria-hidden>
        <UserRound className="size-8" />
      </div>
      <div>
        <div className="font-extrabold">Examiner</div>
        <div className="text-sm text-muted-foreground">{caption}</div>
      </div>
    </div>
  );
}

function Transcript({ messages }: { messages: Msg[] }) {
  return (
    <Card>
      <CardTitle>Your consultation</CardTitle>
      <div className="space-y-3">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} emotion={m.emotion}>
            {m.content}
          </Bubble>
        ))}
      </div>
    </Card>
  );
}

function Bubble({ role, emotion, children }: { role: Msg["role"]; emotion?: string | null; children: React.ReactNode }) {
  const student = role === "student";
  return (
    <div className={cn("flex gap-2", student && "flex-row-reverse")}>
      {!student && (
        <span className="mt-1 text-xl" aria-hidden>
          {faceFor(emotion).emoji}
        </span>
      )}
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed", student ? "bg-brand-purple text-white" : "border bg-card")}>
        <span className="sr-only">{student ? "You: " : "Patient: "}</span>
        {children}
      </div>
    </div>
  );
}

/** The patient's animated face: LemonSlice's video, mounted where the page wants it. */
function AvatarFace({ link, name }: { link: AvatarLink; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.appendChild(link.video);
    return () => link.video.remove();
  }, [link]);
  return <div ref={box} role="img" aria-label={`${name}, your patient`} className="mx-auto aspect-[2/3] h-[34dvh] shrink-0 overflow-hidden rounded-2xl bg-muted" />;
}
