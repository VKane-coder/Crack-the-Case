"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SpeechError, useSpeechInput } from "@/features/station/use-speech-input";

// How the student speaks in every phase: hold-to-talk (button or space bar) or type. Used for the
// history, the presentation and the answers to the examiner.

const MAX_CHARS = 500;

const SPEECH_ERRORS: Record<SpeechError, string> = {
  mic_denied: "Microphone access is blocked. Allow it in your browser's site settings, or type instead.",
  unavailable: "Voice input isn't available right now. Type instead.",
  connection: "Couldn't connect to speech recognition. Try again, or type instead.",
};

export type Spoken = { text: string; seconds: number };

export type TalkControlsHandle = { focus: () => void };

type Props = {
  speech: ReturnType<typeof useSpeechInput>;
  voiceInput: boolean;
  /** Blocks talking and sending (e.g. while the patient is replying). */
  busy: boolean;
  /** Called on press, before listening starts (barge-in, audio unlock). */
  onTalkStart?: () => void;
  /** Return false to keep the typed text in the box (e.g. the send failed). */
  onSubmit: (text: string, spoken?: Spoken) => Promise<boolean | void> | boolean | void;
  onError: (message: string) => void;
  label: string;
  placeholder: string;
  maxChars?: number;
};

export const TalkControls = forwardRef<TalkControlsHandle, Props>(function TalkControls(
  { speech, voiceInput, busy, onTalkStart, onSubmit, onError, label, placeholder, maxChars = MAX_CHARS },
  ref,
) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const talking = useRef(false);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  async function submitTyped(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    if ((await onSubmit(text)) === false) setDraft(text);
    inputRef.current?.focus();
  }

  function talkDown() {
    if (talking.current || busy) return;
    talking.current = true;
    onTalkStart?.();
    speech.start();
  }
  async function talkUp() {
    if (!talking.current) return;
    talking.current = false;
    const result = await speech.stop();
    if (!result) return;
    if (result.text) void onSubmit(result.text, result);
    else onError("Didn't catch that. Hold the button the whole time you're speaking.");
  }

  // Space bar talks too, unless the student is typing. Handlers read the latest props via a ref.
  const keys = useRef({ down: talkDown, up: talkUp });
  useEffect(() => {
    keys.current = { down: talkDown, up: talkUp };
  });
  useEffect(() => {
    if (!voiceInput) return;
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
  }, [voiceInput]);

  const pressed = speech.state === "listening" || speech.state === "connecting";
  return (
    <>
      {voiceInput && (
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
            disabled={busy || speech.state === "finalizing"}
            aria-pressed={speech.state === "listening"}
            className={cn(
              "flex h-16 w-full max-w-sm touch-none items-center justify-center gap-2 rounded-2xl text-lg font-black text-white shadow-[0_4px_0_0_rgb(0_0_0/0.15)] transition select-none disabled:opacity-50",
              pressed ? "scale-[0.98] bg-brand-coral" : "bg-brand-teal hover:brightness-105",
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
        </p>
      )}

      <form onSubmit={submitTyped} className="flex items-end gap-2">
        <label htmlFor="utterance" className="sr-only">
          {label}
        </label>
        <textarea
          id="utterance"
          ref={inputRef}
          value={draft}
          maxLength={maxChars}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submitTyped();
            }
          }}
          placeholder={placeholder}
          className="min-h-12 flex-1 resize-none rounded-xl border-2 bg-card px-3 py-2 outline-none focus-visible:border-brand-purple"
        />
        <Button type="submit" size="lg" disabled={!draft.trim() || busy} aria-label="Send">
          <Send />
        </Button>
      </form>
    </>
  );
});
