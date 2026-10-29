import { describe, expect, it } from "vitest";
import { parseProfile, pickVoice, voiceProfileFor, type VoiceOption } from "./pick-voice";

const voices: VoiceOption[] = [
  { voiceId: "us-f", name: "Rachel", labels: { accent: "american", gender: "female", age: "young" } },
  { voiceId: "au-m", name: "Charlie", labels: { accent: "australian", gender: "male", age: "middle aged" } },
  { voiceId: "au-f-young", name: "Mia", labels: { accent: "Australian", gender: "female", age: "young" } },
  { voiceId: "au-f-old", name: "Joan", labels: { accent: "australian", gender: "female", age: "old" } },
];

describe("pickVoice", () => {
  it("parses profiles", () => {
    expect(parseProfile("au-female-60s-soft")).toEqual({ accent: "au", gender: "female", decade: 60 });
  });

  it("prefers accent, then gender, then age", () => {
    expect(pickVoice(voices, "au-female-60s-soft")?.voiceId).toBe("au-f-old");
    expect(pickVoice(voices, "au-female-30s-direct")?.voiceId).toBe("au-f-young");
    expect(pickVoice(voices, "au-male-50s-warm")?.voiceId).toBe("au-m");
  });

  it("still picks something without an Australian voice, and nothing from an empty account", () => {
    expect(pickVoice([voices[0]], "au-male-50s-warm")?.voiceId).toBe("us-f");
    expect(pickVoice([], "au-male-50s-warm")).toBeNull();
  });

  it("builds a profile from the patient when the case has none", () => {
    expect(voiceProfileFor({ voice_profile: "", sex: "female", age: 28 })).toBe("au-female-20s");
    expect(voiceProfileFor({ voice_profile: "au-male-50s-warm", sex: "female", age: 28 })).toBe("au-male-50s-warm");
    expect(pickVoice(voices, voiceProfileFor({ sex: "female", age: 67 }))?.voiceId).toBe("au-f-old");
    expect(parseProfile(voiceProfileFor({ sex: "intersex", age: 40 }))).toEqual({ accent: "au", gender: "", decade: 40 });
  });
});
