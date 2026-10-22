// Output guardrail for patient speech (docs/architecture.md §3.2). Runs on each sentence before the
// student sees it. Lives outside agents/patient because it needs the diagnosis terms, which the
// patient agent itself must never see.

export type GuardrailVerdict = { ok: true } | { ok: false; reason: "diagnosis_leak" | "coaching" | "out_of_role"; match: string };

const COACHING = [
  "you should ask",
  "you might want to ask",
  "you may want to ask",
  "don't forget to ask",
  "you forgot to ask",
  "have you considered",
  "you should consider",
  "you should check",
  "the next question",
  "red flag",
  "differential",
  "my diagnosis",
  "the diagnosis is",
];

const OUT_OF_ROLE = [
  "as an ai",
  "language model",
  "standardised patient",
  "standardized patient",
  "my script",
  "my instructions",
  "role-play",
  "roleplay",
  "osce",
  "the examiner",
  "mark_disclosed",
  "fact_ids",
  "[emotion:",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function firstMatch(text: string, phrases: string[], wordBoundary: boolean): string | undefined {
  const lower = text.toLowerCase();
  return phrases.find((p) => (wordBoundary ? new RegExp(`(^|[^a-z])${escape(p.toLowerCase())}($|[^a-z])`).test(lower) : lower.includes(p)));
}

/** @param leakTerms the diagnosis and its synonyms, lower-cased (from cases/projector leakTerms). */
export function checkPatientSentence(text: string, leakTerms: string[]): GuardrailVerdict {
  const leak = firstMatch(text, leakTerms, true);
  if (leak) return { ok: false, reason: "diagnosis_leak", match: leak };
  const outOfRole = firstMatch(text, OUT_OF_ROLE, false);
  if (outOfRole) return { ok: false, reason: "out_of_role", match: outOfRole };
  const coaching = firstMatch(text, COACHING, true);
  if (coaching) return { ok: false, reason: "coaching", match: coaching };
  return { ok: true };
}

/** Operator note for the single regeneration after a guardrail trip. Never repeats the matched term. */
export function correctionFor(verdict: Extract<GuardrailVerdict, { ok: false }>): string {
  switch (verdict.reason) {
    case "diagnosis_leak":
      return "Your last draft named a medical diagnosis. You are a layperson who doesn't know what is wrong. Answer the student's last question again in plain words about your symptoms and feelings only, without naming any condition.";
    case "coaching":
      return "Your last draft commented on or guided the student's questioning. Answer the student's last question again purely as the patient, with no hints, praise or suggestions about what to ask.";
    case "out_of_role":
      return "Your last draft stepped out of role. Answer the student's last question again as the patient would, in plain spoken words.";
  }
}

/** Spoken when the patient can't produce a safe reply. Neutral, in role, and never informative. */
export const SAFE_FALLBACK_LINE = "Sorry, doctor, I'm not sure what you mean. Could you ask me that another way?";
