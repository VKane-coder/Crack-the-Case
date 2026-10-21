import "server-only";
import { DeepgramClient } from "@deepgram/sdk";
import { requireServerEnv } from "@/lib/env.server";

// The browser streams microphone audio straight to Deepgram with a short-lived token minted here,
// so raw audio never passes through our servers (docs/architecture.md §1, §8.1).

export const TOKEN_TTL_SECONDS = 30;

/**
 * Words students say that general models often mishear. Deliberately generic: case-specific terms
 * would reach the browser and could hint at the diagnosis.
 */
export const STT_KEYTERMS = [
  "paracetamol",
  "Panadol",
  "ibuprofen",
  "Nurofen",
  "thyroxine",
  "metformin",
  "salbutamol",
  "Ventolin",
  "warfarin",
  "apixaban",
  "atorvastatin",
  "perindopril",
  "frusemide",
  "prednisolone",
  "amoxicillin",
  "endone",
  "SOCRATES",
  "haematuria",
  "haematemesis",
  "melaena",
  "dyspnoea",
  "orthopnoea",
  "palpitations",
  "syncope",
  "dysuria",
  "PR bleeding",
  "menstrual",
  "contraception",
  "Aboriginal or Torres Strait Islander",
  "bulk-billed",
];

export async function mintDeepgramToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const client = new DeepgramClient({ apiKey: requireServerEnv("DEEPGRAM_API_KEY") });
  const res = await client.auth.v1.tokens.grant({ ttl_seconds: TOKEN_TTL_SECONDS });
  return { accessToken: res.access_token, expiresIn: res.expires_in ?? TOKEN_TTL_SECONDS };
}
