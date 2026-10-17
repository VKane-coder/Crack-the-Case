import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireServerEnv } from "@/lib/env.server";

let client: Anthropic | undefined;

// One client per server instance. Retries are off: callers own fallback (Sonnet → Haiku) so a slow
// retry never eats the turn's latency budget.
export function anthropic() {
  client ??= new Anthropic({ apiKey: requireServerEnv("ANTHROPIC_API_KEY"), maxRetries: 0, timeout: 30_000 });
  return client;
}

export { Anthropic };
