import "server-only";
import { Anthropic, anthropic } from "@/server/agents/shared/anthropic-client";
import { MODELS } from "@/server/agents/shared/models";
import { knownFactIds, readFinalMessage, type PatientLlm } from "./llm";

// Streams a patient reply from the Claude API. Low effort keeps first-token latency down for short
// spoken answers. On the primary model, server-side refusal fallback ("default" routing) lets the
// API re-run a declined turn on a fallback model inside the same call.
export const claudePatientLlm: PatientLlm = {
  async run(req, model, cb, signal) {
    const stream = anthropic().beta.messages.stream(
      {
        model,
        max_tokens: 1024,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
        output_config: { effort: "low" },
        ...(model === MODELS.patient ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );

    let sawText = false;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "fallback") {
          if (sawText) cb.onReset();
          sawText = false;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          sawText = true;
          cb.onText(event.delta.text);
        }
      }
      return readFinalMessage(await stream.finalMessage(), knownFactIds(req));
    } catch (err) {
      // With eager input streaming the SDK parses tool input at block stop, so malformed JSON
      // surfaces here. The spoken text is already out; only the disclosure log is lost.
      if (err instanceof Anthropic.APIError || signal.aborted || !sawText) throw err;
      return {
        model,
        factIds: [],
        refused: false,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        disclosureError: err instanceof Error ? err.message.slice(0, 200) : "unparseable tool input",
      };
    }
  },
};
