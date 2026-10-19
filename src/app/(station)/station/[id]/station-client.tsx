"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CheckCircle2, ClipboardList, Loader2, Presentation, RotateCcw, UserRound, Volume2, VolumeX } from "lucide-react";
import { faceFor, PatientStage } from "@/components/station/patient-stage";
import { formatClock, PhaseTimer } from "@/components/station/phase-timer";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AudioQueue } from "@/features/station/audio-queue";
import { readNdjson, type PatientStreamEvent } from "@/features/station/ndjson";
import { useSpeechInput } from "@/features/station/use-speech-input";
import type { StationData } from "@/server/station/orchestrator";
import { TalkControls, type Spoken, type TalkControlsHandle } from "./talk-controls";

const READING_SECONDS = 60;
const POLL_MS = 2_000;
const STRUCTURE = ["Summary", "Key positives", "Key negatives", "Differentials", "Investigations", "Management"];

type Msg = { role: "student" | "patient"; content: string; emotion?: string | null };
type Question = { ord: number; text: string; answered: boolean };
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
function describeLatency(c: TurnClock, playAt: number) {
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
    parts.push(`playback ${secs(playAt - c.audioAt)}`);
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
  const [readingEnds] = useState(() => Date.now() + READING_SECONDS * 1000);
  const [voiceOn, setVoiceOn] = useState(voice.output);
  const [playing, setPlaying] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [latency, setLatency] = useState<string | null>(null);
  const clock = useRef<TurnClock | null>(null);
  const ending = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const talk = useRef<TalkControlsHandle>(null);
  const audio = useRef<AudioQueue | null>(null);
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

  useEffect(() => () => audio.current?.stop(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live, segments]);

  // Phase changes -------------------------------------------------------------------------------

  const startHistory = useCallback(async () => {
    audio.current?.unlock();
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

  const endHistory = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    audio.current?.stop();
    const res = await post(`${api}/end-history`);
    ending.current = false;
    if (res.error) return setError(res.error.message);
    setDeadline(null);
    setStatus("history_ended");
  }, [api]);

  async function startPresentation() {
    setBusy(true);
    setError(null);
    const res = await post<{ deadline: string }>(`${api}/start-presentation`);
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "Couldn't start the presentation.");
    setDeadline(res.data.deadline);
    setStatus("presentation");
  }

  const endPresentation = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    setError(null);
    const res = await post<{ question: { ord: number; text: string } | null; total: number }>(`${api}/end-presentation`);
    ending.current = false;
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "The examiner couldn't load a question. Please try again.");
    setDeadline(null);
    if (res.data.question) setQuestions([{ ...res.data.question, answered: false }]);
    setStatus("examiner_questions");
  }, [api]);

  async function finish() {
    setBusy(true);
    const res = await post(`${api}/finish`);
    setBusy(false);
    if (res.error) return setError(res.error.message);
    setStatus("assessing");
  }

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
      if (status === "history" && deadline && Date.parse(deadline) <= t && live === null) void endHistory();
      if (status === "presentation" && deadline && Date.parse(deadline) <= t && !busy) void endPresentation();
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
    audio.current?.stop();
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
        body: JSON.stringify({ utterance, clientSeq, voice: voiceOn, sttSeconds: spoken?.seconds ?? 0 }),
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
            audio.current?.stop();
          } else if (ev.type === "audio" && voiceOn) {
            setVoiceError(null);
            if (clock.current && !clock.current.audioAt) clock.current.audioAt = performance.now();
            player().enqueue(ev.data, ev.mime);
          } else if (ev.type === "voice_error") setVoiceError(ev.code);
          else if (ev.type === "timing" && clock.current) clock.current.server = ev;
          else if (ev.type === "done") commit();
          else if (ev.type === "error") failure = ev;
        });
      }
    } catch {
      if (!committed) failure = { code: "network", message: "Connection lost. Please try again." };
    }

    if (committed) return true; // a dropped connection after "done" only loses trailing audio
    setLive(null);
    if (failure) {
      const f = failure as { code: string; message: string };
      setMessages((m) => m.slice(0, -1));
      if (f.code === "phase_over") {
        setStatus("history_ended");
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
    if (res.error.code === "phase_over") void endPresentation();
    else setError(res.error.message);
    return false;
  }

  async function answer(text: string): Promise<boolean> {
    const current = questions.find((q) => !q.answered);
    if (!current) return false;
    setError(null);
    setBusy(true);
    const res = await post<{ question: { ord: number; text: string } | null }>(`${api}/examiner-answer`, { ord: current.ord, answer: text });
    setBusy(false);
    if (!res.data) {
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
          <p className="text-lg leading-relaxed">{station.brief}</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll have {formatClock(station.historySeconds * 1000)} to take a history from {station.patient.name}, then{" "}
            {formatClock(station.presentationSeconds * 1000)} to present to the examiner and answer their questions.{" "}
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
          <PatientStage name={station.patient.name} age={station.patient.age} emotion={emotion ?? "neutral"} speaking={live !== null || playing} />
          <PhaseTimer remainingMs={remaining} label="History" />
        </div>
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
            audio.current?.stop();
          }}
          onSubmit={askPatient}
          onError={setError}
          label="Your question to the patient"
          placeholder={voice.input ? "Or type a question…" : `Ask ${station.patient.name.split(" ")[0]} a question…`}
        />
        {showLatency && latency && <p className="text-center text-xs text-muted-foreground">{latency}</p>}
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
                if (voiceOn) audio.current?.stop();
                setVoiceOn(!voiceOn);
              }}
              aria-pressed={voiceOn}
            >
              {voiceOn ? <Volume2 /> : <VolumeX />} Patient voice {voiceOn ? "on" : "off"}
            </Button>
          )}
          <Button variant="outline" onClick={endHistory}>
            End history and move on <ArrowRight />
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
              {messages.filter((m) => m.role === "student").length} questions asked. Now present your findings to the examiner. You have{" "}
              {formatClock(station.presentationSeconds * 1000)}.
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
          <PhaseTimer remainingMs={remaining} label="Presentation" />
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
        <ExaminerStage caption={busy ? "noting your answer…" : current ? "waiting for your answer" : "finishing up…"} />
        <Card className="border-brand-purple/30">
          <p className="text-xs font-extrabold tracking-wide text-brand-purple uppercase">
            Examiner · question {asked}
          </p>
          <p className="text-xl leading-relaxed font-bold" aria-live="polite">
            {current?.text ?? "Thank you. That's the end of the station."}
          </p>
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
        <CardTitle className="text-2xl">The examiner is writing your report…</CardTitle>
        <CardDescription>Marking every rubric item against your transcript. This usually takes under a minute.</CardDescription>
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
