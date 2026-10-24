import { describe, expect, it } from "vitest";
import { chunkPcm, pcmRate, pcmToWav } from "./pcm";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const bytesOf = (base64: string) => [...atob(base64)].map((c) => c.charCodeAt(0));

describe("chunkPcm", () => {
  it("splits audio into chunks of whole samples, in order", () => {
    const audio = Array.from({ length: 10 }, (_, i) => i);
    const chunks = chunkPcm(b64(audio), 4);
    expect(chunks.map(bytesOf)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });

  it("never splits a 16-bit sample", () => {
    expect(chunkPcm(b64([1, 2, 3, 4, 5, 6]), 5).map(bytesOf)).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
  });

  it("handles a long sentence (several seconds of audio)", () => {
    const long = btoa("\0".repeat(16000 * 2 * 6)); // 6 s at 16 kHz
    expect(chunkPcm(long)).toHaveLength(60);
  });
});

describe("pcmToWav", () => {
  it("wraps PCM in a playable 16-bit mono WAV header", () => {
    const wav = bytesOf(pcmToWav(b64([1, 2, 3, 4]), 16000));
    const view = new DataView(new Uint8Array(wav).buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 16))).toBe("WAVEfmt ");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(wav.slice(44)).toEqual([1, 2, 3, 4]);
  });
});

describe("pcmRate", () => {
  it("reads the rate from a PCM mime type and ignores other audio", () => {
    expect(pcmRate("audio/pcm;rate=16000")).toBe(16000);
    expect(pcmRate("audio/pcm")).toBe(16000);
    expect(pcmRate("audio/mpeg")).toBeNull();
  });
});
