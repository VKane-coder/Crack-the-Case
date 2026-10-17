import type { CaseContent } from "./schema";

// The patient agent's only view of a case. Built by allow-list (never by deleting fields from the
// full case) so new examiner-only fields can't leak by accident. Stored as case_versions.patient_view.

export type PatientView = ReturnType<typeof toPatientView>;

export function toPatientView(c: CaseContent) {
  const p = c.patient;
  return {
    name: p.name,
    age: p.age,
    sex: p.sex,
    pronouns: p.pronouns,
    occupation: p.occupation,
    background: p.background,
    persona: p.persona,
    persona_notes: p.persona_notes,
    opening_statement: p.opening_statement,
    presenting_complaint: { ...p.presenting_complaint },
    // is_red_flag is an examiner signal; the patient shouldn't treat red flags differently.
    facts: p.facts.map(({ id, category, content, disclosure }) => ({ id, category, content, disclosure })),
    ice: { ...p.ice },
    behaviour_rules: [...p.behaviour_rules],
  };
}

/** Terms that must never appear in the patient view (or, later, in patient speech). */
export function leakTerms(c: CaseContent): string[] {
  return [c.clinical.diagnosis, ...c.clinical.diagnosis_synonyms].map((t) => t.toLowerCase());
}

export function findLeaks(view: PatientView, terms: string[]): string[] {
  const text = JSON.stringify(view).toLowerCase();
  return terms.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}
