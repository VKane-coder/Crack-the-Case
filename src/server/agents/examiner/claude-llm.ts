import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { anthropic } from "@/server/agents/shared/anthropic-client";
import { MODELS, NO_USAGE } from "@/server/agents/shared/models";
import { assessorPrompt, questionerPrompt } from "./context";
import type { ExaminerCall, ExaminerLlm } from "./llm";
import { ASSESSOR_SYSTEM, QUESTIONER_SYSTEM } from "./prompts";
import { assessorOutput, questionerOutput } from "./schema";

// Both examiner calls return structured output (output_config.format), validated against Zod by
// the SDK. Server-side refusal fallback re-runs a declined call on another model in the same request.

async function structured<S extends z.ZodType>(opts: {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  prompt: string;
  schema: S;
  signal: AbortSignal;
}): Promise<{ output: z.infer<S>; call: ExaminerCall }> {
  const started = Date.now();
  const res = await anthropic().beta.messages.parse(
    {
      model: opts.model,
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal: opts.signal, timeout: 240_000 },
  );
  const call: ExaminerCall = {
    model: res.model,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    },
    latencyMs: Date.now() - started,
    status: "ok",
  };
  if (res.stop_reason === "refusal") throw Object.assign(new Error("examiner declined"), { call: { ...call, status: "error" } });
  if (res.stop_reason === "max_tokens" || !res.parsed_output) {
    throw Object.assign(new Error(`examiner output unusable (${res.stop_reason})`), { call: { ...call, status: "error" } });
  }
  return { output: res.parsed_output as z.infer<S>, call };
}

export const claudeExaminerLlm: ExaminerLlm = {
  questions: (input, signal) =>
    structured({
      model: MODELS.questioner,
      effort: "low",
      system: QUESTIONER_SYSTEM,
      prompt: questionerPrompt(input),
      schema: questionerOutput,
      signal,
    }),
  assess: (input, signal) =>
    structured({
      model: MODELS.assessor,
      effort: "high",
      system: ASSESSOR_SYSTEM,
      prompt: assessorPrompt(input),
      schema: assessorOutput(input.rubric.items.map((i) => i.key)),
      signal,
    }),
};

/** The failed call attached to an error thrown above, for cost logging. */
export function failedCall(err: unknown, model: string): ExaminerCall {
  const call = (err as { call?: ExaminerCall }).call;
  return (
    call ?? { model, usage: NO_USAGE, latencyMs: 0, status: "error", error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
  );
}
