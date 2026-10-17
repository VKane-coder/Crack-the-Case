import { z } from "zod";
import { NO_USAGE, type TokenUsage } from "@/server/agents/shared/models";
import { MARK_DISCLOSED_TOOL, type PatientRequest } from "./context";

// The model boundary for the patient agent. The real implementation streams from the Claude API;
// tests and e2e runs swap in a scripted fake so the rest of the turn logic runs unchanged.

export type PatientLlmCallbacks = {
  onText: (delta: string) => void;
  /** Text streamed so far was declined and replaced (server-side refusal fallback); discard it. */
  onReset: () => void;
};

export type PatientLlmResult = {
  model: string;
  factIds: string[];
  refused: boolean;
  usage: TokenUsage;
  /** Set when the tool input couldn't be read; the spoken text is still usable. */
  disclosureError?: string;
};

export interface PatientLlm {
  run(req: PatientRequest, model: string, cb: PatientLlmCallbacks, signal: AbortSignal): Promise<PatientLlmResult>;
}

export const markDisclosedInput = z.object({ fact_ids: z.array(z.string()) });

type FinalMessage = {
  model: string;
  stop_reason: string | null;
  content: { type: string; name?: string; input?: unknown }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

/** Pulls usage and disclosed facts out of a finished message. Exported for tests. */
export function readFinalMessage(msg: FinalMessage, knownFactIds: string[]): PatientLlmResult {
  const usage: TokenUsage = {
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
  };
  const refused = msg.stop_reason === "refusal";
  const call = msg.content.find((b) => b.type === "tool_use" && b.name === MARK_DISCLOSED_TOOL);
  if (!call || refused) return { model: msg.model, factIds: [], refused, usage };
  // A tool input cut off by max_tokens can still parse as a valid (shorter) list; don't trust it.
  if (msg.stop_reason === "max_tokens") return { model: msg.model, factIds: [], refused, usage, disclosureError: "max_tokens" };
  const parsed = markDisclosedInput.safeParse(call.input);
  if (!parsed.success) return { model: msg.model, factIds: [], refused, usage, disclosureError: "invalid_input" };
  const known = new Set(knownFactIds);
  return { model: msg.model, factIds: [...new Set(parsed.data.fact_ids.filter((id) => known.has(id)))], refused, usage };
}

export function knownFactIds(req: PatientRequest): string[] {
  const schema = req.tools[0]?.input_schema as { properties?: { fact_ids?: { items?: { enum?: string[] } } } };
  return schema.properties?.fact_ids?.items?.enum ?? [];
}

export const EMPTY_RESULT = (model: string): PatientLlmResult => ({ model, factIds: [], refused: false, usage: NO_USAGE });
