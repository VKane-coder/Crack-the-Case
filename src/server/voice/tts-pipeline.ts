import type { Emotion } from "@/server/agents/patient";

// Turns released sentences into audio while the patient is still "thinking" of the next one.
// Each sentence is synthesised as soon as it arrives (in parallel), but audio is emitted strictly
// in order. reset() drops everything in flight when the text is withdrawn (guardrail retry).

export type Synthesize = (
  text: string,
  opts: { emotion: Emotion; previousText: string },
  signal: AbortSignal,
) => Promise<{ data: Uint8Array; mime: string }>;

export type AudioEvent = { type: "audio"; index: number; mime: string; data: string };

/** Short provider code for a failed synthesis (e.g. "elevenlabs_401_missing_permissions"); never secrets. */
export function voiceErrorCode(err: unknown) {
  return (err as { voiceCode?: string } | null)?.voiceCode ?? "tts_failed";
}

/**
 * Sentences voiced at once. ElevenLabs caps simultaneous requests per account (lower on smaller
 * plans) and refuses the rest; two keeps the next sentence ready without hitting the cap.
 */
export const MAX_CONCURRENT_SYNTHESIS = 2;

export class TtsPipeline {
  private chain: Promise<void> = Promise.resolve();
  private active = 0;
  private waiting: (() => void)[] = [];
  private ctrl = new AbortController();
  private index = 0;
  private spoken: string[] = [];
  /** Characters sent for synthesis (for cost logging), including withdrawn sentences. */
  characters = 0;
  failures = 0;

  constructor(
    private readonly synthesize: Synthesize,
    private readonly emit: (e: AudioEvent) => void,
    /** Called once, on the first failure, so the student learns why the patient is silent. */
    private readonly onFirstFailure?: (code: string) => void,
    private readonly maxConcurrent = MAX_CONCURRENT_SYNTHESIS,
  ) {}

  /** Runs a synthesis once fewer than maxConcurrent are in flight; sentences start in the order pushed. */
  private async slot<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) await new Promise<void>((resume) => this.waiting.push(resume));
    this.active++;
    try {
      return await run();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  push(text: string, emotion: Emotion) {
    const signal = this.ctrl.signal;
    const index = this.index++;
    const previousText = this.spoken.slice(-2).join(" ");
    this.spoken.push(text);
    this.characters += text.length;
    // Start as soon as a slot is free; the chain only orders the emits.
    const audio = this.slot(() =>
      signal.aborted ? Promise.reject(new Error("withdrawn")) : this.synthesize(text, { emotion, previousText }, signal),
    ).catch((err) => {
      if (!signal.aborted) {
        if (this.failures++ === 0) this.onFirstFailure?.(voiceErrorCode(err));
        console.warn("tts failed", { code: voiceErrorCode(err), message: err instanceof Error ? err.message : String(err) });
      }
      return null;
    });
    this.chain = this.chain.then(async () => {
      const result = await audio;
      if (result && !signal.aborted) {
        this.emit({ type: "audio", index, mime: result.mime, data: Buffer.from(result.data).toString("base64") });
      }
    });
  }

  /** Withdraws everything not yet played; later sentences start a fresh sequence. */
  reset() {
    this.ctrl.abort("reset");
    this.ctrl = new AbortController();
    this.spoken = [];
  }

  /** Resolves once every audio event still owed has been emitted. */
  finish() {
    return this.chain;
  }

  abort() {
    this.ctrl.abort("aborted");
  }
}
