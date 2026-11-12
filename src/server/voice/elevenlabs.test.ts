import { beforeEach, describe, expect, it, vi } from "vitest";

// The ElevenLabs SDK is replaced with a stub: `refuse` lists voice ids it rejects, and each call is recorded.
const sdk = vi.hoisted(() => ({
  refuse: new Map<string, { statusCode: number; body: unknown }>(),
  /** Times each voice id answers "busy" (409 already_running) before it speaks. */
  busy: new Map<string, number>(),
  spoken: [] as string[],
  searches: 0,
  voices: [
    {
      voiceId: "library-voice",
      name: "From the Voice Library",
      category: "professional",
      labels: { accent: "australian", gender: "female", age: "young" },
    },
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
        const busy = sdk.busy.get(voiceId) ?? 0;
        if (busy > 0) {
          sdk.busy.set(voiceId, busy - 1);
          throw Object.assign(new Error("busy"), { statusCode: 409, body: { detail: { status: "already_running" } } });
        }
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

const { caseVoiceSynthesize, voiceRefused, elevenLabsSynthesize, voiceBusy } = await import("./elevenlabs");

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

describe("elevenLabsSynthesize", () => {
  const opts = { emotion: "neutral" as const, previousText: "" };

  it("retries when ElevenLabs is busy, then speaks", async () => {
    sdk.busy.set("busy-voice", 2);
    const audio = await elevenLabsSynthesize("busy-voice")("Hello.", opts, new AbortController().signal);
    expect(audio.mime).toBe("audio/mpeg");
    expect(sdk.busy.get("busy-voice")).toBe(0);
  });

  it("gives up after two retries with ElevenLabs' code", async () => {
    sdk.busy.set("stuck-voice", 5);
    await expect(elevenLabsSynthesize("stuck-voice")("Hello.", opts, new AbortController().signal)).rejects.toMatchObject({
      voiceCode: "elevenlabs_409_already_running",
    });
    expect(sdk.busy.get("stuck-voice")).toBe(2); // three attempts made
  });

  it("treats 409 and 429 as busy, and nothing else", () => {
    expect(voiceBusy({ voiceStatus: 409 })).toBe(true);
    expect(voiceBusy({ voiceStatus: 429 })).toBe(true);
    expect(voiceBusy({ voiceStatus: 401 })).toBe(false);
    expect(voiceBusy(new Error("network"))).toBe(false);
  });
});
