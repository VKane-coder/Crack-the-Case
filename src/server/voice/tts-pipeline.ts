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

export class TtsPipeline {
  private chain: Promise<void> = Promise.resolve();
  private ctrl = new AbortController();
  private index = 0;
  private spoken: string[] = [];
  /** Characters sent for synthesis (for cost logging), including withdrawn sentences. */
  characters = 0;
  failures = 0;

  constructor(
    private readonly synthesize: Synthesize,
    private readonly emit: (e: AudioEvent) => void,
  ) {}

  push(text: string, emotion: Emotion) {
    const signal = this.ctrl.signal;
    const index = this.index++;
    const previousText = this.spoken.slice(-2).join(" ");
    this.spoken.push(text);
    this.characters += text.length;
    // Start now; the chain only orders the emits.
    const audio = this.synthesize(text, { emotion, previousText }, signal).catch((err) => {
      if (!signal.aborted) {
        this.failures++;
        console.warn("tts failed", { message: err instanceof Error ? err.message : String(err) });
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
