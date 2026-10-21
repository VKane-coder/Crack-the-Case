import { NO_USAGE, type TokenUsage } from "@/server/agents/shared/models";
import type { ExaminerInput } from "./context";
import type { AssessorOutput, QuestionerOutput } from "./schema";

// The model boundary for the examiner. The real implementation calls the Claude API; e2e runs and
// tests use the deterministic fake below.

export type ExaminerCall = { model: string; usage: TokenUsage; latencyMs: number; status: "ok" | "error"; error?: string };

export interface ExaminerLlm {
  questions(input: ExaminerInput, signal: AbortSignal): Promise<{ output: QuestionerOutput; call: ExaminerCall }>;
  assess(input: ExaminerInput, signal: AbortSignal): Promise<{ output: AssessorOutput; call: ExaminerCall }>;
}

/**
 * Asks the first one or two bank questions, and marks history items from the disclosure log
 * (everything else "partial"). Enough to drive the full station flow without the API.
 */
export const fakeExaminerLlm: ExaminerLlm = {
  async questions(input) {
    const bank = input.rubric.question_bank.slice(0, 2);
    return {
      output: { questions: bank.map((q) => ({ question: q.question, rationale: "fake: bank question", targets: q.targets })) },
      call: { model: "fake:questioner", usage: NO_USAGE, latencyMs: 0, status: "ok" },
    };
  },
  async assess(input) {
    const disclosed = new Set(input.disclosedFactIds);
    const items = input.rubric.items.map((i) => {
      const found = i.linked_fact_ids.filter((id) => disclosed.has(id)).length;
      const outcome = !i.linked_fact_ids.length ? "partial" : found === i.linked_fact_ids.length ? "met" : found ? "partial" : "not_met";
      return { key: i.key, outcome: outcome as "met" | "partial" | "not_met", points: i.max_points / 2, evidence: "" };
    });
    const met = items.filter((i) => i.outcome === "met").length / Math.max(1, items.length);
    return {
      output: {
        items,
        global_rating: met > 0.6 ? "good" : met > 0.3 ? "pass" : "borderline",
        strengths: ["You kept the consultation focused on the presenting complaint."],
        improvements: ["Ask about red flags explicitly and early."],
        missed_questions: [],
        missed_red_flags: input.content.clinical.red_flags.filter((r) => !disclosed.has(r.fact_id)).map((r) => r.why),
        revision_topics: [input.content.meta.title],
        examiner_comment: "A solid start. Keep working on a structured, safety-focused history.",
      },
      call: { model: "fake:assessor", usage: NO_USAGE, latencyMs: 0, status: "ok" },
    };
  },
};
