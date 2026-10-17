import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPatientSentence } from "@/server/agents/guardrails/patient";
import { costUsd } from "@/server/agents/shared/models";
import { loadCaseLibrary } from "@/server/cases/library";
import { leakTerms } from "@/server/cases/projector";
import { buildPatientRequest, MARK_DISCLOSED_TOOL } from "./context";
import { fakePatientLlm } from "./fake-llm";
import { patientAttempt, type PatientEvent } from "./index";
import { readFinalMessage, type PatientLlm } from "./llm";
import { cleanSpoken, SpeechBuffer } from "./speech";

const library = loadCaseLibrary(path.resolve(__dirname, "../../../../content"));
const gp = library.find((c) => c.content.meta.slug === "gp-change-in-bowel-habit")!;
const state = { elapsedSeconds: 75, limitSeconds: 300, disclosedFactIds: ["looser_frequent"] };

describe("patient request", () => {
  it.each(library.map((c) => [c.content.meta.slug, c] as const))("%s: carries no examiner-only content", (_slug, c) => {
    const req = buildPatientRequest(c.patientView, [{ role: "student", content: "What brings you in?" }], state);
    const json = JSON.stringify(req).toLowerCase();
    for (const term of leakTerms(c.content)) expect(json).not.toMatch(new RegExp(`\\b${term}\\b`));
    for (const d of c.content.clinical.differentials) expect(json).not.toContain(d.discriminating_features.toLowerCase());
    expect(json).not.toContain("is_red_flag");
    expect(json).not.toContain(c.content.candidate_brief.toLowerCase());
  });

  it("orders stable layers first, caches the script and the latest student turn, and ends with state", () => {
    const req = buildPatientRequest(gp.patientView, [{ role: "student", content: "Tell me more." }], state);
    expect(req.system.map((b) => !!b.cache_control)).toEqual([false, false, true]);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[1]).toEqual({ role: "assistant", content: gp.patientView.opening_statement });
    const lastStudent = req.messages.at(-2)!;
    expect(lastStudent.role).toBe("user");
    expect(JSON.stringify(lastStudent.content)).toContain("ephemeral");
    expect(req.messages.at(-1)).toMatchObject({ role: "system" });
    expect(String(req.messages.at(-1)!.content)).toContain("1:15 of 5:00");
  });

  it("limits mark_disclosed to the case's fact ids", () => {
    const req = buildPatientRequest(gp.patientView, [{ role: "student", content: "Hi" }], state);
    expect(req.tools[0].name).toBe(MARK_DISCLOSED_TOOL);
    expect(JSON.stringify(req.tools[0].input_schema)).toContain("rectal_bleeding_mixed");
  });
});

describe("speech buffer", () => {
  it("strips the emotion tag even when it arrives in pieces, and releases whole sentences", () => {
    const s = new SpeechBuffer();
    const out = [..."[emoti", "on:anxious] Oh, it's", " probably nothing. Ron made", " me come."].flatMap((d) => s.push(d));
    out.push(...s.flush());
    expect(out).toEqual([
      { type: "emotion", emotion: "anxious" },
      { type: "sentence", text: "Oh, it's probably nothing." },
      { type: "sentence", text: "Ron made me come." },
    ]);
  });

  it("falls back to neutral for a missing or unknown tag", () => {
    const a = new SpeechBuffer();
    expect([...a.push("Yes, that's right."), ...a.flush()][0]).toEqual({ type: "emotion", emotion: "neutral" });
    const b = new SpeechBuffer();
    expect([...b.push("[emotion:ecstatic] Hi."), ...b.flush()]).toEqual([
      { type: "emotion", emotion: "neutral" },
      { type: "sentence", text: "Hi." },
    ]);
  });

  it("removes unspeakable stage directions and markdown", () => {
    expect(cleanSpoken("*sighs* Well, (pauses) it's been - **three** months.")).toBe("Well, it's been - three months.");
  });
});

describe("guardrail", () => {
  const terms = leakTerms(gp.content);
  it("catches diagnosis terms on word boundaries only", () => {
    expect(checkPatientSentence("Do you think it's bowel cancer?", terms)).toMatchObject({ ok: false, reason: "diagnosis_leak" });
    expect(checkPatientSentence("I'm a Cancerian, if that matters.", terms)).toEqual({ ok: true });
  });
  it("catches coaching and stepping out of role", () => {
    expect(checkPatientSentence("You should ask me about my weight.", terms)).toMatchObject({ reason: "coaching" });
    expect(checkPatientSentence("As an AI, I can't say.", terms)).toMatchObject({ reason: "out_of_role" });
    expect(checkPatientSentence("It's been about three months now.", terms)).toEqual({ ok: true });
  });
});

describe("cost", () => {
  it("prices cache reads and writes separately", () => {
    const usage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 10_000, cacheWriteTokens: 0 };
    // 1000×$2 + 100×$10 + 10000×$0.20, per million
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(0.005, 6);
    expect(costUsd("unknown-model", usage)).toBe(0);
  });
});

describe("readFinalMessage", () => {
  const base = { model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } };
  const tool = (input: unknown) => ({ type: "tool_use", name: MARK_DISCLOSED_TOOL, input });
  it("keeps known fact ids only, de-duplicated", () => {
    const r = readFinalMessage({ ...base, stop_reason: "tool_use", content: [{ type: "text" }, tool({ fact_ids: ["a", "a", "zzz"] })] }, ["a", "b"]);
    expect(r).toMatchObject({ factIds: ["a"], refused: false, usage: { cacheReadTokens: 100 } });
  });
  it("distrusts tool input on max_tokens and ignores it on refusal", () => {
    expect(readFinalMessage({ ...base, stop_reason: "max_tokens", content: [tool({ fact_ids: ["a"] })] }, ["a"])).toMatchObject({
      factIds: [],
      disclosureError: "max_tokens",
    });
    expect(readFinalMessage({ ...base, stop_reason: "refusal", content: [tool({ fact_ids: ["a"] })] }, ["a"])).toMatchObject({
      factIds: [],
      refused: true,
    });
  });
});

describe("patientAttempt", () => {
  const run = (llm: PatientLlm, onEvent: (e: PatientEvent) => boolean = () => true) =>
    patientAttempt({
      view: gp.patientView,
      history: [{ role: "student", content: "How many months has it been?" }],
      state,
      llm,
      onEvent,
      signal: new AbortController().signal,
      models: ["primary", "fallback"],
    });

  it("streams a reply and reports disclosures (fake model)", async () => {
    const events: PatientEvent[] = [];
    const r = await run(fakePatientLlm(), (e) => (events.push(e), true));
    expect(r.status).toBe("complete");
    expect(r.factIds).toEqual(["duration_3_months"]);
    expect(events[0]).toEqual({ type: "emotion", emotion: "neutral" });
    expect(r.calls).toEqual([expect.objectContaining({ model: "fake:primary", status: "ok" })]);
  });

  it("moves to the fallback model when the primary fails before speaking", async () => {
    const flaky: PatientLlm = {
      run: (req, model, cb, signal) =>
        model === "primary" ? Promise.reject(new Error("overloaded")) : fakePatientLlm().run(req, model, cb, signal),
    };
    const r = await run(flaky);
    expect(r.status).toBe("complete");
    expect(r.calls.map((c) => [c.model, c.status])).toEqual([
      ["primary", "error"],
      ["fake:fallback", "fallback"],
    ]);
  });

  it("stops at a vetoed sentence", async () => {
    const r = await run(fakePatientLlm(), (e) => e.type !== "sentence");
    expect(r.status).toBe("vetoed");
  });
});
