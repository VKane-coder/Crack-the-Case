/**
 * Lists the ElevenLabs voices on your account with their accent, gender and age labels, and the
 * voice_profile each launch case asks for, so you can fill in ELEVENLABS_VOICE_MAP.
 *
 *   ELEVENLABS_API_KEY=... npm run voices:list
 */
import path from "node:path";
import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { loadCaseLibrary } from "../src/server/cases/library";

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY first.");
  const client = new ElevenLabsClient({ apiKey });

  const voices: ElevenLabs.Voice[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await client.voices.search({ pageSize: 100, nextPageToken });
    voices.push(...page.voices);
    nextPageToken = page.hasMore ? page.nextPageToken : undefined;
  } while (nextPageToken);

  const accent = (v: (typeof voices)[number]) => v.labels?.accent ?? "";
  voices.sort((a, b) => Number(/austral/i.test(accent(b))) - Number(/austral/i.test(accent(a))));
  console.log("Voices on this account (Australian accents first):\n");
  for (const v of voices) {
    const l = v.labels ?? {};
    console.log(`${v.voiceId}  ${(v.name ?? "").padEnd(24)} ${[l.accent, l.gender, l.age, l.description].filter(Boolean).join(" · ")}`);
  }

  const profiles = [...new Set(loadCaseLibrary(path.resolve(__dirname, "../content")).map((c) => c.content.patient.voice_profile))];
  console.log(`\nVoice profiles the cases use: ${profiles.join(", ")}`);
  console.log(`Set ELEVENLABS_VOICE_MAP to JSON like {"${profiles[0]}":"<voice id>", ...}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
