import { beforeEach, describe, expect, it, vi } from "vitest";

// The ElevenLabs SDK is replaced with a stub: `refuse` lists voice ids it rejects, and each call is recorded.
const sdk = vi.hoisted(() => ({
  refuse: new Map<string, { statusCode: number; body: unknown }>(),
  spoken: [] as string[],
  searches: 0,
  voices: [
    { voiceId: "library-voice", name: "From the Voice Library", category: "professional", labels: { accent: "australian", gender: "female", age: "young" } },
    { voiceId: "premade-man", name: "Charlie", category: "premade", labels: { accent: "australian", gender: "male", age: "middle aged" } },
    { voiceId: "premade-woman", name: "Mia", category: "premade", labels: { accent: "australian", gender: "female", age: "young" } },
  ],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({ requireServerEnv: () => "test-key" }));
vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    textToSpeech = {
      stream: async (voiceId: string) => {
        const refusal = sdk.refuse.get(voiceId);
        if (refusal) throw Object.assign(new Error("refused"), refusal);
        sdk.spoken.push(voiceId);
        return new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1, 2, 3]));
            c.close();
          },
        });
      },
    };
    voices = {
      search: async () => {
        sdk.searches++;
        return { voices: sdk.voices };
      },
    };
  },
}));

const { caseVoiceSynthesize, voiceRefused } = await import("./elevenlabs");

const freePlan = { statusCode: 400, body: { detail: { status: "free_users_not_allowed" } } };
const opts = { emotion: "neutral" as const, previousText: "" };
const signal = new AbortController().signal;

beforeEach(() => {
  sdk.refuse.clear();
  sdk.spoken.length = 0;
});

describe("caseVoiceSynthesize", () => {
  it("speaks with the case's own voice when ElevenLabs accepts it", async () => {
    await caseVoiceSynthesize("chosen-voice", "au-female-20s")("Hello.", opts, signal);
    expect(sdk.spoken).toEqual(["chosen-voice"]);
  });

  it("switches to the best built-in voice when the case's voice is refused, and remembers the refusal", async () => {
    sdk.refuse.set("library-voice-1", freePlan);
    const speak = caseVoiceSynthesize("library-voice-1", "au-female-20s");
    const audio = await speak("I have no idea what's wrong.", opts, signal);
    expect(audio.mime).toBe("audio/mpeg");
    // A premade woman's voice, not the Library voice that would be refused too, nor a man's.
    expect(sdk.spoken).toEqual(["premade-woman"]);

    const searches = sdk.searches;
    await speak("He just can't stop vomiting.", opts, signal);
    expect(sdk.spoken).toEqual(["premade-woman", "premade-woman"]);
    expect(sdk.searches).toBe(searches); // the pick is cached, and the refused voice isn't tried again
  });

  it("doesn't swap voices for failures that would refuse every voice", async () => {
    sdk.refuse.set("chosen-voice-2", { statusCode: 401, body: { detail: { status: "invalid_api_key" } } });
    await expect(caseVoiceSynthesize("chosen-voice-2", "au-female-20s")("Hello.", opts, signal)).rejects.toMatchObject({
      voiceCode: "elevenlabs_401_invalid_api_key",
    });
    expect(sdk.spoken).toEqual([]);
  });
});

describe("voiceRefused", () => {
  it("recognises refusals of one voice", () => {
    expect(voiceRefused({ voiceStatus: 400, voiceReason: "free_users_not_allowed" })).toBe(true);
    expect(voiceRefused({ voiceStatus: 404 })).toBe(true);
    expect(voiceRefused({ voiceStatus: 429, voiceReason: "quota_exceeded" })).toBe(false);
    expect(voiceRefused(new Error("network"))).toBe(false);
  });
});
