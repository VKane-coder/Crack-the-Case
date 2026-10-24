// Raw 16-bit mono PCM (what the server sends while the animated face is on), handled as base64.

/** 100 ms of 16 kHz 16-bit mono audio: LemonSlice recommends 80–100 ms chunks. */
export const PCM_CHUNK_BYTES = 3200;

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  // In slices: String.fromCharCode(...bytes) overflows the call stack on long sentences.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Splits a sentence's audio into ~100 ms base64 chunks, keeping whole 16-bit samples together. */
export function chunkPcm(base64: string, chunkBytes = PCM_CHUNK_BYTES): string[] {
  const bytes = decode(base64);
  const size = chunkBytes - (chunkBytes % 2);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(encode(bytes.subarray(i, i + size)));
  return chunks;
}

/** Wraps raw PCM in a WAV header so the browser can play it: used if the face drops out mid-reply. */
export function pcmToWav(base64: string, sampleRate: number): string {
  const pcm = decode(base64);
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return encode(wav);
}

/** The sample rate in a mime type like "audio/pcm;rate=16000", or null for other audio. */
export function pcmRate(mime: string): number | null {
  const m = /^audio\/pcm(?:;\s*rate=(\d+))?/.exec(mime);
  return m ? Number(m[1] ?? 16000) : null;
}
