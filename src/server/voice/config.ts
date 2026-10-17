import "server-only";
import { z } from "zod";

// Voice configuration (docs/architecture.md §8). Everything is optional: without keys the station
// runs in text mode, and VOICE_PROVIDERS=fake swaps in silent stand-ins for e2e runs.

const isFake = () => process.env.VOICE_PROVIDERS === "fake" && process.env.VERCEL_ENV !== "production";

export function sttAvailable() {
  return isFake() || Boolean(process.env.DEEPGRAM_API_KEY);
}

export function ttsAvailable() {
  return isFake() || Boolean(process.env.ELEVENLABS_API_KEY);
}

export const voiceFake = isFake;

/** Deepgram streaming settings sent to the browser alongside its short-lived token. */
export function sttSettings() {
  return {
    model: process.env.DEEPGRAM_MODEL || "nova-3-medical",
    language: process.env.DEEPGRAM_LANGUAGE || "en",
  };
}

const voiceMap = z.record(z.string(), z.string().min(1));

/**
 * ElevenLabs voice for a case's voice_profile (e.g. "au-female-60s-soft"). ELEVENLABS_VOICE_MAP is a
 * JSON object of profile → voice id; ELEVENLABS_DEFAULT_VOICE_ID covers unmapped profiles. Returns
 * null when no voice is configured, in which case the patient replies in text only.
 */
export function voiceIdFor(profile: string): string | null {
  if (isFake()) return "fake-voice";
  let map: Record<string, string> = {};
  try {
    map = voiceMap.parse(JSON.parse(process.env.ELEVENLABS_VOICE_MAP || "{}"));
  } catch {
    console.error("ELEVENLABS_VOICE_MAP is not a JSON object of profile → voice id");
  }
  return map[profile] ?? process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? null;
}

/** USD per 1,000 characters for cost logging; depends on the ElevenLabs plan, so it's configurable. */
export function ttsUsdPer1kChars() {
  const n = Number(process.env.ELEVENLABS_USD_PER_1K_CHARS);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** USD per minute of streamed speech-to-text, for cost logging. */
export function sttUsdPerMinute() {
  const n = Number(process.env.DEEPGRAM_USD_PER_MINUTE);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
