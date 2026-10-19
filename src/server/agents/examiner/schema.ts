import { z } from "zod";
import { GLOBAL_RATINGS, OUTCOMES } from "@/server/assessment/scoring";

// Structured outputs for the two examiner calls. The API constrains the model to these shapes;
// we still validate (and the scoring code recomputes every number).

export const questionerOutput = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      rationale: z.string(),
      targets: z.array(z.string()),
    }),
  ),
});
export type QuestionerOutput = z.infer<typeof questionerOutput>;

export function assessorOutput(itemKeys: string[]) {
  return z.object({
    items: z.array(
      z.object({
        key: z.enum(itemKeys as [string, ...string[]]),
        outcome: z.enum(OUTCOMES),
        /** Marks awarded for a partial outcome, following the item's marking criteria. */
        points: z.number(),
        evidence: z.string(),
      }),
    ),
    global_rating: z.enum(GLOBAL_RATINGS),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    missed_questions: z.array(z.string()),
    missed_red_flags: z.array(z.string()),
    revision_topics: z.array(z.string()),
    examiner_comment: z.string(),
  });
}
export type AssessorOutput = z.infer<ReturnType<typeof assessorOutput>>;
