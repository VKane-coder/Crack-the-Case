import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { findLeaks, leakTerms, toPatientView, type PatientView } from "./projector";
import { caseFileSchema, rubricTemplateSchema, type CaseContent, type RubricItem, type RubricTemplate } from "./schema";

// Loads and compiles the git-authored case library (content/). Used by the seed builder and tests.

export type CompiledRubric = {
  name: string;
  station_type: RubricTemplate["station_type"];
  pass_mark: number;
  domain_weights: RubricTemplate["domain_weights"];
  global_rating_descriptors: Record<string, string>;
  examiner_question_bank: { question: string; targets: string[] }[];
  items: RubricItem[];
};

export type CompiledCase = {
  content: CaseContent;
  patientView: PatientView;
  rubric: CompiledRubric;
  contentHash: string;
  rubricHash: string;
};

export const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function jsonFiles(dir: string) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadCaseLibrary(contentDir: string): CompiledCase[] {
  const templates = new Map<string, RubricTemplate>();
  for (const file of jsonFiles(path.join(contentDir, "rubrics"))) {
    const t = rubricTemplateSchema.parse(readJson(file));
    templates.set(t.slug, t);
  }

  const seen = new Set<string>();
  return jsonFiles(path.join(contentDir, "cases")).map((file) => {
    const where = path.basename(file);
    const parsed = caseFileSchema.safeParse(readJson(file));
    if (!parsed.success) throw new Error(`${where}: ${parsed.error.message}`);
    const { case: content, rubric } = parsed.data;

    if (`${content.meta.slug}.json` !== where) throw new Error(`${where}: file name must match meta.slug`);
    if (seen.has(content.meta.slug)) throw new Error(`${where}: duplicate slug`);
    seen.add(content.meta.slug);

    const template = templates.get(rubric.extends);
    if (!template) throw new Error(`${where}: unknown rubric template "${rubric.extends}"`);

    // Case items override template items with the same key; template order first, then new items.
    const overrides = new Map(rubric.items.map((i) => [i.key, i]));
    const items = [
      ...template.items.map((i) => overrides.get(i.key) ?? i),
      ...rubric.items.filter((i) => !template.items.some((t) => t.key === i.key)),
    ];

    const weightSum = Object.values(template.domain_weights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1) > 1e-6) throw new Error(`${where}: domain weights sum to ${weightSum}, expected 1`);
    for (const [domain, weight] of Object.entries(template.domain_weights)) {
      if (weight > 0 && !items.some((i) => i.domain === domain)) {
        throw new Error(`${where}: domain "${domain}" has weight but no rubric items`);
      }
    }
    const keys = new Set(items.map((i) => i.key));
    for (const q of rubric.examiner_question_bank)
      for (const t of q.targets)
        if (!keys.has(t)) throw new Error(`${where}: examiner question targets unknown item "${t}"`);

    const patientView = toPatientView(content);
    const leaks = findLeaks(patientView, leakTerms(content));
    if (leaks.length) throw new Error(`${where}: patient view leaks diagnosis terms: ${leaks.join(", ")}`);

    const compiled: CompiledRubric = {
      name: `${content.meta.title} (${content.meta.slug})`,
      station_type: template.station_type,
      pass_mark: rubric.pass_mark ?? template.pass_mark,
      domain_weights: template.domain_weights,
      global_rating_descriptors: template.global_rating_descriptors,
      examiner_question_bank: rubric.examiner_question_bank,
      items,
    };

    // The name lives on rubrics, not rubric_versions, so renaming a case must not mint a new rubric version.
    const versioned = { ...compiled, name: undefined };
    return { content, patientView, rubric: compiled, contentHash: sha256(content), rubricHash: sha256(versioned) };
  });
}
