import { describe, expect, it } from "vitest";
import { floatTo16BitPcm, TranscriptAssembler, type SttResult } from "./transcript";

const r = (transcript: string, extra: Partial<SttResult> = {}): SttResult => ({
  type: "Results",
  channel: { alternatives: [{ transcript }] },
  ...extra,
});

describe("TranscriptAssembler", () => {
  it("shows interims live, commits finals in order, and reports the Finalize response", () => {
    const t = new TranscriptAssembler();
    t.add(r("how long"));
    expect(t.live).toBe("how long");
    t.add(r("How long has this", { is_final: true }));
    t.add(r("been going"));
    expect(t.live).toBe("How long has this been going");
    expect(t.add(r("been going on?", { is_final: true, from_finalize: true }))).toBe(true);
    expect(t.final).toBe("How long has this been going on?");
  });

  it("falls back to the last interim when no final arrives", () => {
    const t = new TranscriptAssembler();
    t.add(r("any allergies"));
    expect(t.final).toBe("any allergies");
    t.reset();
    expect(t.final).toBe("");
  });
});

describe("floatTo16BitPcm", () => {
  it("clamps and scales to signed 16-bit little-endian", () => {
    const view = new DataView(floatTo16BitPcm(new Float32Array([0, 1, -1, 2])));
    expect([0, 2, 4, 6].map((o) => view.getInt16(o, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
