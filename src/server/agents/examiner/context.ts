import type { CaseContent } from "@/server/cases/schema";
import type { ScoringItem } from "@/server/assessment/scoring";

// The examiner's view: the full case (diagnosis included), the rubric, the patient's disclosure log
// and the transcripts as quoted data. Never shown to the student before the station is over.

export type ExaminerRubric = {
  items: (ScoringItem & { description?: string | null })[];
  question_bank: { question: string; targets: string[] }[];
  global_rating_descriptors: Record<string, string>;
};

export type Transcripts = {
  history: { role: "student" | "patient"; content: string }[];
  presentation: string[];
  qa: { question: string; answer: string | null }[];
};

export type ExaminerInput = {
  content: CaseContent;
  rubric: ExaminerRubric;
  disclosedFactIds: string[];
  transcripts: Transcripts;
};

/** Student text can't close our tags early. */
const quote = (s: string) => s.replace(/<\//g, "< /");

export function caseBlock(c: CaseContent): string {
  const p = c.patient;
  const lines = [
    `<case>`,
    `Title: ${c.meta.title} (difficulty ${c.meta.difficulty}/5)`,
    `Candidate brief: ${c.candidate_brief}`,
    `Task: ${c.assessment_task}`,
    `Patient: ${p.name}, ${p.age}, ${p.sex}, ${p.occupation}. Persona: ${p.persona}.`,
    `Case facts (id [category, disclosure rule]):`,
    ...p.facts.map((f) => `- ${f.id} [${f.category}, ${f.disclosure}${f.is_red_flag ? ", RED FLAG" : ""}]: ${f.content}`),
    `Ideas, concerns, expectations: ${p.ice.ideas} / ${p.ice.concerns} / ${p.ice.expectations}`,
    `Diagnosis: ${c.clinical.diagnosis}`,
    `Differentials:`,
    ...c.clinical.differentials.map((d) => `- ${d.dx} (${d.likelihood}): ${d.discriminating_features}`),
    `Red flags:`,
    ...c.clinical.red_flags.map((r) => `- ${r.fact_id}: ${r.why}`),
    `Expected investigations: ${c.clinical.expected_investigations.join("; ")}`,
    `Expected management: ${c.clinical.expected_management.join("; ")}`,
    `Safety-netting: ${c.clinical.safety_netting.join("; ") || "n/a"}`,
    `</case>`,
  ];
  return lines.join("\n");
}

export function rubricBlock(r: ExaminerRubric): string {
  return [
    `<rubric>`,
    `Items (key [domain, max points, critical?, linked facts]: label):`,
    ...r.items.map(
      (i) =>
        `- ${i.key} [${i.domain}, ${i.max_points}${i.is_critical ? ", CRITICAL" : ""}${i.linked_fact_ids.length ? `, facts: ${i.linked_fact_ids.join(" ")}` : ""}]: ${i.label}${i.description ? ` (${i.description})` : ""}`,
    ),
    `Global rating descriptors:`,
    ...Object.entries(r.global_rating_descriptors).map(([k, v]) => `- ${k}: ${v}`),
    `Question bank (question → targeted items):`,
    ...r.question_bank.map((q) => `- ${q.question} → ${q.targets.join(", ") || "general"}`),
    `</rubric>`,
  ].join("\n");
}

export function disclosureBlock(c: CaseContent, disclosed: string[]): string {
  const set = new Set(disclosed);
  const revealed = c.patient.facts.filter((f) => set.has(f.id)).map((f) => f.id);
  const hidden = c.patient.facts.filter((f) => !set.has(f.id)).map((f) => f.id);
  return `<disclosure_log>\nRevealed by the patient: ${revealed.join(", ") || "none"}\nNever revealed: ${hidden.join(", ") || "none"}\n</disclosure_log>`;
}

export function transcriptBlocks(t: Transcripts, includeQa: boolean): string {
  const history = t.history.map((m) => `${m.role === "student" ? "Student" : "Patient"}: ${quote(m.content)}`).join("\n");
  const blocks = [
    `<history_transcript>\n${history || "(the student asked nothing)"}\n</history_transcript>`,
    `<presentation_transcript>\n${t.presentation.map(quote).join("\n") || "(the student did not present)"}\n</presentation_transcript>`,
  ];
  if (includeQa) {
    const qa = t.qa.map((q, i) => `Examiner Q${i + 1}: ${q.question}\nStudent: ${q.answer ? quote(q.answer) : "(no answer)"}`).join("\n\n");
    blocks.push(`<examiner_qa>\n${qa || "(no questions)"}\n</examiner_qa>`);
  }
  return blocks.join("\n\n");
}

export function questionerPrompt(input: ExaminerInput): string {
  return [
    caseBlock(input.content),
    rubricBlock(input.rubric),
    disclosureBlock(input.content, input.disclosedFactIds),
    transcriptBlocks(input.transcripts, false),
    `Write your follow-up questions for this student now.`,
  ].join("\n\n");
}

export function assessorPrompt(input: ExaminerInput): string {
  return [
    caseBlock(input.content),
    rubricBlock(input.rubric),
    disclosureBlock(input.content, input.disclosedFactIds),
    transcriptBlocks(input.transcripts, true),
    `Mark this station now: judge every rubric item, choose the global rating, and write the feedback.`,
  ].join("\n\n");
}
