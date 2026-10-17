import type { PatientView } from "@/server/cases/projector";
import { MODELS, NO_USAGE, type TokenUsage } from "@/server/agents/shared/models";
import { buildPatientRequest, type ChatTurn, type StationState } from "./context";
import type { PatientLlm } from "./llm";
import type { Emotion } from "./prompts/role-contract";
import { SpeechBuffer, type SpeechEvent } from "./speech";

export { PATIENT_PROMPT_VERSION } from "./prompts/role-contract";
export type { ChatTurn, StationState } from "./context";
export type { Emotion } from "./prompts/role-contract";

/** What the student receives: emotion and sentences, or a reset when released text is withdrawn. */
export type PatientEvent = SpeechEvent | { type: "reset" };

export type ModelCall = {
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  status: "ok" | "error" | "fallback";
  error?: string;
};

export type AttemptResult = {
  /** complete: model finished; vetoed: onEvent rejected a sentence; failed: no usable reply. */
  status: "complete" | "vetoed" | "failed";
  text: string;
  emotion: Emotion;
  factIds: string[];
  refused: boolean;
  calls: ModelCall[];
};

/** Abort the primary model and move to the fallback if no text has arrived by then. */
export const FIRST_TEXT_TIMEOUT_MS = 8_000;

/**
 * One generation of the patient's reply. Speech events are passed to onEvent as whole sentences;
 * returning false from onEvent vetoes the reply (the stream is aborted and status is "vetoed").
 * Tries the primary model, then the fallback model if the primary errors or is slow to start,
 * as long as nothing has been released to the student yet.
 */
export async function patientAttempt(opts: {
  view: PatientView;
  history: ChatTurn[];
  state: StationState;
  correction?: string;
  llm: PatientLlm;
  onEvent: (e: PatientEvent) => boolean;
  signal: AbortSignal;
  models?: string[];
}): Promise<AttemptResult> {
  const req = buildPatientRequest(opts.view, opts.history, opts.state, opts.correction);
  const calls: ModelCall[] = [];
  const models = opts.models ?? [MODELS.patient, MODELS.patientFallback];

  for (const [i, model] of models.entries()) {
    let speech = new SpeechBuffer();
    const spoken: string[] = [];
    let released = false;
    let vetoed = false;
    let gotText = false;
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort(opts.signal.reason);
    opts.signal.addEventListener("abort", onOuterAbort, { once: true });
    const timer = setTimeout(() => !gotText && ctrl.abort("first_text_timeout"), FIRST_TEXT_TIMEOUT_MS);

    const deliver = (events: SpeechEvent[]) => {
      for (const e of events) {
        if (vetoed) return;
        if (!opts.onEvent(e)) {
          vetoed = true;
          ctrl.abort("vetoed");
          return;
        }
        released = true;
        if (e.type === "sentence") spoken.push(e.text);
      }
    };

    const started = Date.now();
    try {
      const result = await opts.llm.run(
        req,
        model,
        {
          onText: (delta) => {
            gotText = true;
            deliver(speech.push(delta));
          },
          onReset: () => {
            // The draft so far was declined and the API continues on a fallback model.
            speech = new SpeechBuffer();
            spoken.length = 0;
            if (released) opts.onEvent({ type: "reset" });
            released = false;
          },
        },
        ctrl.signal,
      );
      if (!vetoed) deliver(speech.flush());
      const status = i > 0 ? "fallback" : "ok";
      calls.push({ model: result.model, usage: result.usage, latencyMs: Date.now() - started, status, error: result.disclosureError });
      if (vetoed) return done("vetoed");
      const text = spoken.join(" ");
      if (result.refused || !text) return done("failed", result.refused);
      return { status: "complete", text, emotion: speech.emotion, factIds: result.factIds, refused: false, calls };
    } catch (err) {
      const reason = ctrl.signal.aborted ? String(ctrl.signal.reason) : err instanceof Error ? err.message : String(err);
      calls.push({ model, usage: NO_USAGE, latencyMs: Date.now() - started, status: "error", error: reason.slice(0, 500) });
      if (vetoed) return done("vetoed");
      if (opts.signal.aborted || released) return done("failed");
      // Otherwise fall through to the next model.
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onOuterAbort);
    }

    function done(status: "vetoed" | "failed", refused = false): AttemptResult {
      return { status, text: spoken.join(" "), emotion: speech.emotion, factIds: [], refused, calls };
    }
  }
  return { status: "failed", text: "", emotion: "neutral", factIds: [], refused: false, calls };
}
