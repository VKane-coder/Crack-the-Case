// Chooses a voice from the ElevenLabs account for a case's voice_profile (e.g. "au-female-60s-soft")
// when ELEVENLABS_VOICE_MAP doesn't name one. Voice labels are free-form, so matching is tolerant:
// accent first (Australian), then gender, then rough age.

export type VoiceOption = { voiceId: string; name?: string; labels?: Record<string, string> };

export type Profile = { accent: string; gender: string; decade: number | null };

export function parseProfile(profile: string): Profile {
  const [accent = "", gender = "", age = ""] = profile.toLowerCase().split("-");
  const decade = /^(\d{2})s$/.exec(age);
  return { accent, gender, decade: decade ? Number(decade[1]) : null };
}

function ageBand(decade: number | null) {
  if (decade === null) return null;
  return decade < 35 ? "young" : decade < 60 ? "middle" : "old";
}

export function scoreVoice(v: VoiceOption, p: Profile): number {
  const l = Object.fromEntries(Object.entries(v.labels ?? {}).map(([k, val]) => [k.toLowerCase(), val.toLowerCase()]));
  let score = 0;
  if (p.accent === "au" && /austral|aussie/.test(`${l.accent ?? ""} ${l.description ?? ""} ${v.name ?? ""}`.toLowerCase())) score += 4;
  const gender = l.gender ?? "";
  if (p.gender && (gender === p.gender || (p.gender === "female" && /woman|female/.test(gender)) || (p.gender === "male" && /^(man|male)$/.test(gender)))) {
    score += 2;
  }
  const band = ageBand(p.decade);
  if (band && (l.age ?? "").includes(band)) score += 1;
  return score;
}

/** Best match, or null when the account has no voices. Ties keep the account's order. */
export function pickVoice(voices: VoiceOption[], profile: string): VoiceOption | null {
  const p = parseProfile(profile);
  let best: VoiceOption | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v, p);
    if (s > bestScore) [best, bestScore] = [v, s];
  }
  return best;
}
