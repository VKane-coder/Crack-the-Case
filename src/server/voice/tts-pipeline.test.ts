import { describe, expect, it } from "vitest";
import { voiceSettingsFor } from "./emotion-voice";
import { TtsPipeline, type AudioEvent, type Synthesize } from "./tts-pipeline";

const decode = (e: AudioEvent) => Buffer.from(e.data, "base64").toString();

/** Synthesises each sentence after `delays[text]` ms, echoing the text as the "audio". */
function slowEcho(delays: Record<string, number>, seen: { text: string; previousText: string }[] = []): Synthesize {
  return (text, { previousText }, signal) =>
    new Promise((resolve, reject) => {
      seen.push({ text, previousText });
      const t = setTimeout(() => resolve({ data: new TextEncoder().encode(text), mime: "audio/mpeg" }), delays[text] ?? 0);
      signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))));
    });
}

describe("TtsPipeline", () => {
  it("synthesises in parallel but emits audio in sentence order, with continuity text", async () => {
    const out: AudioEvent[] = [];
    const seen: { text: string; previousText: string }[] = [];
    const p = new TtsPipeline(slowEcho({ "First.": 40, "Second.": 5 }, seen), (e) => out.push(e));
    const started = Date.now();
    p.push("First.", "anxious");
    p.push("Second.", "anxious");
    await p.finish();
    expect(out.map(decode)).toEqual(["First.", "Second."]);
    expect(out.map((e) => e.index)).toEqual([0, 1]);
    expect(Date.now() - started).toBeLessThan(80); // parallel, not 45 ms in sequence plus overhead
    expect(seen[1].previousText).toBe("First.");
    expect(p.characters).toBe(13);
  });

  it("drops withdrawn sentences on reset and keeps going with new ones", async () => {
    const out: AudioEvent[] = [];
    const p = new TtsPipeline(slowEcho({ "Leaky.": 30 }), (e) => out.push(e));
    p.push("Leaky.", "neutral");
    p.reset();
    p.push("Clean.", "neutral");
    await p.finish();
    expect(out.map(decode)).toEqual(["Clean."]);
  });

  it("skips a failed sentence without blocking the rest", async () => {
    const out: AudioEvent[] = [];
    const flaky: Synthesize = async (text) => {
      if (text === "Bad.") throw new Error("429");
      return { data: new TextEncoder().encode(text), mime: "audio/mpeg" };
    };
    const p = new TtsPipeline(flaky, (e) => out.push(e));
    p.push("Bad.", "neutral");
    p.push("Good.", "neutral");
    await p.finish();
    expect(out.map(decode)).toEqual(["Good."]);
    expect(p.failures).toBe(1);
  });
});

describe("voiceSettingsFor", () => {
  it("makes distress more expressive and keeps values in range", () => {
    expect(voiceSettingsFor("anxious").stability).toBeLessThan(voiceSettingsFor("neutral").stability);
    for (const e of ["neutral", "anxious", "tearful", "in_pain"] as const) {
      const v = voiceSettingsFor(e);
      expect(v.stability).toBeGreaterThanOrEqual(0);
      expect(v.stability).toBeLessThanOrEqual(1);
      expect(v.speed).toBeGreaterThan(0.7);
      expect(v.speed).toBeLessThan(1.2);
    }
  });
});
