// Model choices and per-token pricing (USD per million tokens). See docs/architecture.md §3 and §19.

export const MODELS = {
  patient: "claude-sonnet-5-5",
  patientFallback: "claude-haiku-5-5",
  questioner: "claude-sonnet-5-5",
  assessor: "claude-opus-5-5",
} as const;

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Cache writes (5-minute TTL) bill at 1.25× input; reads at 0.1×.
const PRICES: Record<string, Price> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Cost in USD, rounded to the 6 decimal places ai_calls stores. Unknown models cost 0 (and are logged). */
export function costUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const usd =
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
