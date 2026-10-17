import "server-only";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireServerEnv } from "@/lib/env.server";
import { voiceSettingsFor } from "./emotion-voice";
import type { Synthesize } from "./tts-pipeline";

// Text-to-speech for patient sentences. Flash v2.5 is ElevenLabs' low-latency model; 64 kbps MP3
// keeps each sentence small enough to send inline in the NDJSON stream.

export const TTS_MODEL = "eleven_flash_v2_5";
const OUTPUT_FORMAT = "mp3_44100_64" as const;

let client: ElevenLabsClient | undefined;
const elevenlabs = () => (client ??= new ElevenLabsClient({ apiKey: requireServerEnv("ELEVENLABS_API_KEY") }));

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function elevenLabsSynthesize(voiceId: string): Synthesize {
  return async (text, { emotion, previousText }, signal) => {
    const stream = await elevenlabs().textToSpeech.stream(
      voiceId,
      {
        text,
        modelId: TTS_MODEL,
        outputFormat: OUTPUT_FORMAT,
        languageCode: "en",
        previousText: previousText || undefined,
        voiceSettings: { ...voiceSettingsFor(emotion), style: 0, useSpeakerBoost: false },
      },
      { abortSignal: signal, maxRetries: 0, timeoutInSeconds: 15 },
    );
    return { data: await collect(stream), mime: "audio/mpeg" };
  };
}

/** Silent WAV of roughly the length the sentence would take to say. Used by e2e runs. */
export function fakeSynthesize(): Synthesize {
  return async (text) => {
    const sampleRate = 8000;
    const samples = Math.min(sampleRate * 4, Math.round((text.length / 15) * sampleRate));
    const buf = Buffer.alloc(44 + samples);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + samples, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate, 28); // byte rate (8-bit mono)
    buf.writeUInt16LE(1, 32);
    buf.writeUInt16LE(8, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(samples, 40);
    buf.fill(128, 44); // 8-bit silence
    return { data: new Uint8Array(buf), mime: "audio/wav" };
  };
}
