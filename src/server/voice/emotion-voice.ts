import type { Emotion } from "@/server/agents/patient";

// How the patient's emotion tag shapes their voice. Lower stability sounds more expressive and
// variable; speed nudges pace. Style exaggeration stays at 0 because it adds latency.

export type VoiceSettings = { stability: number; similarityBoost: number; speed: number };

const BASE: VoiceSettings = { stability: 0.5, similarityBoost: 0.75, speed: 1 };

const BY_EMOTION: Partial<Record<Emotion, Partial<VoiceSettings>>> = {
  anxious: { stability: 0.35, speed: 1.06 },
  embarrassed: { stability: 0.4, speed: 0.96 },
  frustrated: { stability: 0.3, speed: 1.05 },
  sad: { stability: 0.55, speed: 0.92 },
  tearful: { stability: 0.3, speed: 0.9 },
  relieved: { stability: 0.5, speed: 1 },
  confused: { stability: 0.45, speed: 0.97 },
  in_pain: { stability: 0.3, speed: 0.94 },
};

export function voiceSettingsFor(emotion: Emotion): VoiceSettings {
  return { ...BASE, ...BY_EMOTION[emotion] };
}
