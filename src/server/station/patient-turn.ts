import { checkPatientSentence, correctionFor, SAFE_FALLBACK_LINE, type GuardrailVerdict } from "@/server/agents/guardrails/patient";
import {
  patientAttempt,
  type ChatTurn,
  type Emotion,
  type ModelCall,
  type PatientEvent,
  type StationState,
} from "@/server/agents/patient";
import type { PatientLlm } from "@/server/agents/patient/llm";
import type { PatientView } from "@/server/cases/projector";

// One patient turn: generate, check every sentence with the guardrail, regenerate once with a
// correction if a sentence trips it, and fall back to a neutral in-role line if that fails too.

export type PatientTurnResult = {
  text: string;
  emotion: Emotion;
  factIds: string[];
  outcome: "ok" | "regenerated" | "safe_fallback";
  guardrail?: Extract<GuardrailVerdict, { ok: false }>;
  calls: ModelCall[];
};

export async function runPatientTurn(opts: {
  view: PatientView;
  leakTerms: string[];
  history: ChatTurn[];
  state: StationState;
  llm: PatientLlm;
  emit: (e: PatientEvent) => void;
  signal: AbortSignal;
}): Promise<PatientTurnResult> {
  const calls: ModelCall[] = [];
  let tripped: Extract<GuardrailVerdict, { ok: false }> | undefined;
  let emitted = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await patientAttempt({
      view: opts.view,
      history: opts.history,
      state: opts.state,
      correction: tripped && correctionFor(tripped),
      llm: opts.llm,
      signal: opts.signal,
      onEvent: (e) => {
        if (e.type === "sentence") {
          const verdict = checkPatientSentence(e.text, opts.leakTerms);
          if (!verdict.ok) {
            tripped = verdict;
            return false;
          }
        }
        opts.emit(e);
        emitted = true;
        return true;
      },
    });
    calls.push(...result.calls);

    if (result.status === "complete") {
      return { text: result.text, emotion: result.emotion, factIds: result.factIds, outcome: attempt ? "regenerated" : "ok", guardrail: tripped, calls };
    }
    if (emitted) {
      opts.emit({ type: "reset" });
      emitted = false;
    }
    // Only a guardrail veto earns a regeneration; model failures and refusals go straight to the fallback line.
    if (result.status !== "vetoed" || opts.signal.aborted) break;
  }

  opts.emit({ type: "emotion", emotion: "confused" });
  opts.emit({ type: "sentence", text: SAFE_FALLBACK_LINE });
  return { text: SAFE_FALLBACK_LINE, emotion: "confused", factIds: [], outcome: "safe_fallback", guardrail: tripped, calls };
}
