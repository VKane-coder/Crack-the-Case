import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAFE_FALLBACK_LINE } from "@/server/agents/guardrails/patient";
import type { PatientEvent } from "@/server/agents/patient";
import type { PatientLlm } from "@/server/agents/patient/llm";
import { NO_USAGE } from "@/server/agents/shared/models";
import { loadCaseLibrary } from "@/server/cases/library";
import { leakTerms } from "@/server/cases/projector";
import { runPatientTurn } from "./patient-turn";

const gp = loadCaseLibrary(path.resolve(__dirname, "../../../content")).find((c) => c.content.meta.slug === "gp-change-in-bowel-habit")!;

/** A model that says each scripted reply in turn and records the correction it was given. */
function scripted(replies: string[], seen: (string | undefined)[] = []): PatientLlm {
  let i = 0;
  return {
    async run(req, model, cb) {
      const last = req.messages.at(-1);
      seen.push(typeof last?.content === "string" ? last.content : undefined);
      const reply = replies[Math.min(i++, replies.length - 1)];
      for (const ch of reply.match(/[\s\S]{1,8}/g) ?? []) cb.onText(ch);
      return { model, factIds: [], refused: reply === "REFUSE", usage: NO_USAGE };
    },
  };
}

async function turn(llm: PatientLlm) {
  const events: PatientEvent[] = [];
  const result = await runPatientTurn({
    view: gp.patientView,
    leakTerms: leakTerms(gp.content),
    history: [{ role: "student", content: "What do you think is going on?" }],
    state: { elapsedSeconds: 60, limitSeconds: 300, disclosedFactIds: [] },
    llm,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  });
  return { result, events };
}

describe("runPatientTurn", () => {
  it("passes a clean reply straight through", async () => {
    const { result, events } = await turn(scripted(["[emotion:anxious] I thought it might be piles."]));
    expect(result.outcome).toBe("ok");
    expect(events).toEqual([
      { type: "emotion", emotion: "anxious" },
      { type: "sentence", text: "I thought it might be piles." },
    ]);
  });

  it("withdraws a leaking reply and regenerates once with a correction", async () => {
    const seen: (string | undefined)[] = [];
    const { result, events } = await turn(
      scripted(["[emotion:anxious] Ron thinks it's piles. But is it bowel cancer?", "[emotion:anxious] I'm just worried, doctor."], seen),
    );
    expect(result).toMatchObject({ outcome: "regenerated", text: "I'm just worried, doctor.", guardrail: { reason: "diagnosis_leak" } });
    // The clean first sentence was shown, then withdrawn before the retry.
    expect(events.map((e) => e.type)).toEqual(["emotion", "sentence", "reset", "emotion", "sentence"]);
    expect(seen[1]).toContain("without naming any condition");
    expect(JSON.stringify(events)).not.toContain("cancer");
  });

  it("falls back to a neutral line when the retry also trips, or the model refuses", async () => {
    for (const llm of [scripted(["[emotion:sad] It's cancer, isn't it?"]), scripted(["REFUSE"])]) {
      const { result, events } = await turn(llm);
      expect(result.outcome).toBe("safe_fallback");
      expect(events.at(-1)).toEqual({ type: "sentence", text: SAFE_FALLBACK_LINE });
      expect(JSON.stringify(events)).not.toContain("cancer");
    }
  });
});
