// Assembles what the student said during one push-to-talk press from Deepgram's streaming results.
// Interim results replace each other; final results (is_final) are committed in order.

export type SttResult = {
  type: "Results";
  is_final?: boolean;
  from_finalize?: boolean;
  start?: number;
  duration?: number;
  channel: { alternatives: { transcript: string }[] };
};

export class TranscriptAssembler {
  private finals: string[] = [];
  private interim = "";

  /** Returns true when this result closes a Finalize request (the press is fully transcribed). */
  add(r: SttResult): boolean {
    const text = r.channel.alternatives[0]?.transcript?.trim() ?? "";
    if (r.is_final) {
      if (text) this.finals.push(text);
      this.interim = "";
    } else {
      this.interim = text;
    }
    return Boolean(r.from_finalize);
  }

  /** Everything heard so far, for live captions. */
  get live(): string {
    return [...this.finals, this.interim].filter(Boolean).join(" ");
  }

  /** The committed transcript; falls back to the last interim if Finalize never came back. */
  get final(): string {
    return (this.finals.length ? this.finals : [this.interim]).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  reset() {
    this.finals = [];
    this.interim = "";
  }
}

/** Float32 samples in [-1, 1] → little-endian 16-bit PCM, Deepgram's linear16 encoding. */
export function floatTo16BitPcm(input: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(input.length * 2));
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out.buffer;
}
