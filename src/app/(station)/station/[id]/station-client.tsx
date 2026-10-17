"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Mic, Send, Volume2, VolumeX } from "lucide-react";
import { faceFor, PatientStage } from "@/components/station/patient-stage";
import { formatClock, PhaseTimer } from "@/components/station/phase-timer";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AudioQueue } from "@/features/station/audio-queue";
import { readNdjson, type PatientStreamEvent } from "@/features/station/ndjson";
import { useSpeechInput, type SpeechError } from "@/features/station/use-speech-input";
import type { StationData } from "@/server/station/orchestrator";

const READING_SECONDS = 60;
const MAX_CHARS = 500;

type Msg = { role: "student" | "patient"; content: string; emotion?: string | null };

async function post<T>(url: string, body: object = {}): Promise<{ data?: T; error?: { code: string; message: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: { code: "network", message: "Couldn't reach the server. Please try again." } }));
}

const SPEECH_ERRORS: Record<SpeechError, string> = {
  mic_denied: "Microphone access is blocked. Allow it in your browser's site settings, or type your questions.",
  unavailable: "Voice input isn't available right now. Type your questions instead.",
  connection: "Couldn't connect to speech recognition. Try again, or type your question.",
};

export function StationClient({ station, voice }: { station: StationData; voice: { input: boolean; output: boolean } }) {
  const [status, setStatus] = useState(station.status);
  const [deadline, setDeadline] = useState(station.deadline);
  const [messages, setMessages] = useState<Msg[]>(station.messages);
  const [emotion, setEmotion] = useState(station.messages.findLast((m) => m.role === "patient")?.emotion ?? "neutral");
  const [live, setLive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [readingEnds] = useState(() => Date.now() + READING_SECONDS * 1000);
  const ending = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [voiceOn, setVoiceOn] = useState(voice.output);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<AudioQueue | null>(null);
  const player = () => (audio.current ??= new AudioQueue(setPlaying));
  const speech = useSpeechInput(station.id, voice.input && status === "history");
  const talking = useRef(false);

  useEffect(() => () => audio.current?.stop(), []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live]);

  const startHistory = useCallback(async () => {
    audio.current?.unlock();
    setBusy(true);
    setError(null);
    const res = await post<{ deadline: string; opening: string | null }>(`/api/consultations/${station.id}/start-history`);
    setBusy(false);
    if (!res.data) return setError(res.error?.message ?? "Couldn't start the station.");
    setDeadline(res.data.deadline);
    if (res.data.opening) setMessages([{ role: "patient", content: res.data.opening, emotion: "neutral" }]);
    setStatus("history");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [station.id]);

  const endHistory = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    const res = await post(`/api/consultations/${station.id}/end-history`);
    if (res.error) {
      ending.current = false;
      return setError(res.error.message);
    }
    setStatus("history_ended");
  }, [station.id]);

  // The clock: re-renders the timers and fires the phase changes a real OSCE makes on its own
  // (reading time over → patient comes in; history time over → move on). The latest state is read
  // through a ref so the interval is set up once.
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    tick.current = () => {
      const t = Date.now();
      if (status === "briefing" && t >= readingEnds && !busy) void startHistory();
      if (status === "history" && deadline && Date.parse(deadline) <= t && live === null) void endHistory();
    };
  });
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      tick.current();
    }, 250);
    return () => clearInterval(t);
  }, []);

  const remaining = deadline ? Date.parse(deadline) - now : station.historySeconds * 1000;

  async function send(e?: React.FormEvent, spoken?: { text: string; seconds: number }) {
    e?.preventDefault();
    const utterance = (spoken?.text ?? draft).trim();
    if (!utterance || live !== null || status !== "history") return;
    const clientSeq = messages.filter((m) => m.role === "student").length;
    if (!spoken) setDraft("");
    audio.current?.stop();
    setError(null);
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
    try {
      const res = await fetch(`/api/consultations/${station.id}/patient-turn`, {
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
          } else if (ev.type === "audio" && voiceOn) player().enqueue(ev.data, ev.mime);
          else if (ev.type === "done") commit();
          else if (ev.type === "error") failure = ev;
        });
      }
    } catch {
      if (!committed) failure = { code: "network", message: "Connection lost. Please try again." };
    }

    if (committed) {
      // Saved already; a dropped connection afterwards only loses trailing audio.
    } else if (failure) {
      setLive(null);
      const f = failure as { code: string; message: string };
      if (f.code === "phase_over") setStatus("history_ended");
      else {
        // Put the question back so the student can resend it.
        setMessages((m) => m.slice(0, -1));
        if (!spoken) setDraft(utterance);
        setError(f.message);
      }
    } else {
      setLive(null);
      if (reply) setMessages((m) => [...m, { role: "patient", content: reply, emotion: replyEmotion }]);
    }
    if (!spoken) inputRef.current?.focus();
  }

  // Push-to-talk: pressing silences the patient (barge-in) and starts listening; releasing sends.
  function talkDown() {
    if (talking.current || live !== null || status !== "history") return;
    talking.current = true;
    player().unlock();
    audio.current?.stop();
    speech.start();
  }
  async function talkUp() {
    if (!talking.current) return;
    talking.current = false;
    const result = await speech.stop();
    if (!result) return;
    if (result.text) void send(undefined, result);
    else setError("Didn't catch that. Hold the button the whole time you're speaking.");
  }

  // Space bar talks too, unless the student is typing.
  const keys = useRef({ down: talkDown, up: talkUp });
  useEffect(() => {
    keys.current = { down: talkDown, up: talkUp };
  });
  useEffect(() => {
    if (!voice.input) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(TEXTAREA|INPUT)$/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      keys.current.down();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      void keys.current.up();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [voice.input]);

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
            You&apos;ll have {formatClock(station.historySeconds * 1000)} to take a history from {station.patient.name}.{" "}
            {voice.input
              ? "Hold the talk button (or the space bar) while you speak, and let go when you've finished. You can also type."
              : "Type your questions as you'd say them."}
          </p>
        </Card>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">{error}</p>}
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

        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">{error}</p>}

        {voice.input && (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                talkDown();
              }}
              onPointerUp={() => void talkUp()}
              onPointerCancel={() => void talkUp()}
              onContextMenu={(e) => e.preventDefault()}
              disabled={live !== null || speech.state === "finalizing"}
              aria-pressed={speech.state === "listening"}
              className={cn(
                "flex h-16 w-full max-w-sm touch-none items-center justify-center gap-2 rounded-2xl text-lg font-black text-white shadow-[0_4px_0_0_rgb(0_0_0/0.15)] transition select-none disabled:opacity-50",
                speech.state === "listening" || speech.state === "connecting"
                  ? "scale-[0.98] bg-brand-coral"
                  : "bg-brand-teal hover:brightness-105",
              )}
            >
              <Mic className="size-6" />
              {speech.state === "listening"
                ? "Listening… release to send"
                : speech.state === "connecting"
                  ? "Getting ready…"
                  : speech.state === "finalizing"
                    ? "Sending…"
                    : "Hold to talk"}
            </button>
            <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
              {speech.state === "listening" || speech.state === "finalizing" ? speech.caption || "…" : "or press and hold the space bar"}
            </p>
          </div>
        )}

        {speech.error && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {SPEECH_ERRORS[speech.error]}
            {speech.detail && <span className="ml-1 font-normal opacity-70">({speech.detail})</span>}
          </p>
        )}

        <form onSubmit={send} className="flex items-end gap-2">
          <label htmlFor="utterance" className="sr-only">
            Your question to the patient
          </label>
          <textarea
            id="utterance"
            ref={inputRef}
            value={draft}
            maxLength={MAX_CHARS}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={voice.input ? "Or type a question…" : `Ask ${station.patient.name.split(" ")[0]} a question…`}
            className="min-h-12 flex-1 resize-none rounded-xl border-2 bg-card px-3 py-2 outline-none focus-visible:border-brand-purple"
          />
          <Button type="submit" size="lg" disabled={!draft.trim() || live !== null} aria-label="Send">
            <Send />
          </Button>
        </form>
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
    const used =
      station.historyStartedAt && deadline
        ? Math.min(station.historySeconds * 1000, Date.parse(station.historyEndedAt ?? new Date(now).toISOString()) - Date.parse(station.historyStartedAt))
        : null;
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <CheckCircle2 className="text-brand-teal" /> History complete
            </CardTitle>
            <CardDescription>
              {messages.filter((m) => m.role === "student").length} questions asked
              {used !== null && used > 0 && ` in ${formatClock(used)}`}. Presenting to the examiner and your feedback report arrive in an
              upcoming update.
            </CardDescription>
          </CardHeader>
          <Button asChild size="lg" className="self-start">
            <Link href="/hub">Back to the hub</Link>
          </Button>
        </Card>
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
      </div>
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

function Bubble({ role, emotion, children }: { role: Msg["role"]; emotion?: string | null; children: React.ReactNode }) {
  const student = role === "student";
  return (
    <div className={cn("flex gap-2", student && "flex-row-reverse")}>
      {!student && (
        <span className="mt-1 text-xl" aria-hidden>
          {faceFor(emotion).emoji}
        </span>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed",
          student ? "bg-brand-purple text-white" : "border bg-card",
        )}
      >
        <span className="sr-only">{student ? "You: " : "Patient: "}</span>
        {children}
      </div>
    </div>
  );
}
