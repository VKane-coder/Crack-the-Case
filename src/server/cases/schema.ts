import { z } from "zod";

// Case content model. Stored in case_versions.content; see docs/architecture.md §4.

export const PERSONALITIES = ["cooperative", "reserved", "anxious", "angry", "distracted", "embarrassed"] as const;
export const DISCLOSURE_TIERS = ["volunteered", "on_open_question", "on_direct_question", "on_rapport"] as const;
export const FACT_CATEGORIES = ["HPC", "PMH", "DH", "Allergy", "SH", "FH", "ROS", "ICE"] as const;
export const RUBRIC_DOMAINS = [
  "history",
  "communication",
  "differentials",
  "investigations",
  "management",
  "clinical_reasoning",
  "patient_safety",
] as const;

const slug = z.string().regex(/^[a-z0-9-]+$/);
const key = z.string().regex(/^[a-z0-9_]+$/);

export const factSchema = z.object({
  id: key,
  category: z.enum(FACT_CATEGORIES),
  /** First person, lay language, as the patient would say it. */
  content: z.string().min(3),
  disclosure: z.enum(DISCLOSURE_TIERS),
  is_red_flag: z.boolean().default(false),
  /** A question the student might ask that this fact answers (author-supplied cases have one per fact). */
  prompt: z.string().optional(),
});

/** An image in the private case-media bucket, shown at a set point in the station. */
export const mediaSchema = z.object({
  path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._()\/-]*\.(png|jpe?g|webp|gif)$/i),
  alt: z.string().min(3),
  caption: z.string().optional(),
});

/**
 * Something the examiner asks after the presentation: a question, optionally about an image, with
 * the answer the author expects. Marked by the rubric item with the same key.
 */
export const examinerItemSchema = z.object({
  key,
  prompt: z.string().min(5),
  media: mediaSchema.optional(),
  model_answer: z.array(z.string().min(1)).min(1),
});

export const DEFAULT_STATION = { reading_seconds: 120, station_seconds: 480 } as const;

export const caseContentSchema = z
  .object({
    meta: z.object({
      slug,
      title: z.string().min(3),
      specialty: slug,
      difficulty: z.number().int().min(1).max(5),
      /** Reading time, then one station clock across the patient and examiner stages. */
      station: z
        .object({
          reading_seconds: z.number().int().min(30).max(600).default(DEFAULT_STATION.reading_seconds),
          station_seconds: z.number().int().min(120).max(1800).default(DEFAULT_STATION.station_seconds),
        })
        .default({ ...DEFAULT_STATION }),
      learning_objectives: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      references: z.array(z.string()).default([]),
      review_status: z.enum(["draft", "pending_clinician_review", "clinician_reviewed"]),
    }),
    /** Shown to the student during reading time. */
    candidate_brief: z.string().min(20),
    assessment_task: z.string().min(10),
    /** The task list and any images shown during reading time. */
    reading: z
      .object({ tasks: z.array(z.string().min(3)).default([]), media: z.array(mediaSchema).default([]) })
      .default({ tasks: [], media: [] }),
    /** Author-written examiner questions. Without any, the examiner writes its own after the presentation. */
    examiner_items: z.array(examinerItemSchema).max(10).default([]),
    patient: z.object({
      name: z.string(),
      age: z.number().int().min(0).max(110),
      sex: z.enum(["female", "male", "intersex"]),
      pronouns: z.string().optional(),
      occupation: z.string(),
      background: z.string().optional(),
      /** Describes the voice for auto-picking one; cases.voice_id (set per case) takes precedence. */
      voice_profile: z.string().default(""),
      persona: z.enum(PERSONALITIES),
      persona_notes: z.string(),
      opening_statement: z.string(),
      presenting_complaint: z.record(z.string(), z.string()).default({}),
      facts: z.array(factSchema).min(5),
      ice: z
        .object({ ideas: z.string(), concerns: z.string(), expectations: z.string() })
        .default({ ideas: "Not stated.", concerns: "Not stated.", expectations: "Not stated." }),
      behaviour_rules: z.array(z.string()).default([]),
    }),
    /** Examiner-only. Never reaches the patient agent or the browser before completion. */
    clinical: z.object({
      diagnosis: z.string(),
      diagnosis_synonyms: z.array(z.string()).default([]),
      differentials: z
        .array(
          z.object({
            dx: z.string(),
            likelihood: z.enum(["leading", "likely", "possible", "must_not_miss"]),
            discriminating_features: z.string(),
          }),
        )
        .min(1),
      red_flags: z.array(z.object({ fact_id: key, why: z.string() })).default([]),
      expected_investigations: z.array(z.string()).default([]),
      expected_management: z.array(z.string()).default([]),
      safety_netting: z.array(z.string()).default([]),
    }),
  })
  .superRefine((c, ctx) => {
    const ids = c.patient.facts.map((f) => f.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) ctx.addIssue({ code: "custom", path: ["patient", "facts"], message: `duplicate fact ids: ${dupes}` });

    const flagged = new Set(c.patient.facts.filter((f) => f.is_red_flag).map((f) => f.id));
    const listed = new Set(c.clinical.red_flags.map((r) => r.fact_id));
    for (const id of listed)
      if (!ids.includes(id))
        ctx.addIssue({ code: "custom", path: ["clinical", "red_flags"], message: `unknown fact id: ${id}` });
    for (const id of flagged)
      if (!listed.has(id))
        ctx.addIssue({ code: "custom", path: ["clinical", "red_flags"], message: `red-flag fact ${id} not explained` });
    for (const id of listed)
      if (!flagged.has(id))
        ctx.addIssue({ code: "custom", path: ["patient", "facts"], message: `fact ${id} must set is_red_flag` });
  });

export const rubricItemSchema = z.object({
  key,
  domain: z.enum(RUBRIC_DOMAINS),
  label: z.string(),
  description: z.string().optional(),
  max_points: z.number().positive(),
  linked_fact_ids: z.array(key).default([]),
  is_critical: z.boolean().default(false),
});

export const rubricTemplateSchema = z.object({
  slug,
  name: z.string(),
  station_type: z.enum(["history", "explanation", "counselling", "data_interpretation"]),
  pass_mark: z.number().min(0).max(100),
  domain_weights: z.record(z.enum(RUBRIC_DOMAINS), z.number().min(0).max(1)),
  global_rating_descriptors: z.record(z.string(), z.string()),
  items: z.array(rubricItemSchema),
});

export const caseRubricSchema = z.object({
  extends: slug,
  pass_mark: z.number().min(0).max(100).optional(),
  examiner_question_bank: z.array(z.object({ question: z.string(), targets: z.array(key).default([]) })).min(1),
  items: z.array(rubricItemSchema).min(1),
});

export const caseFileSchema = z
  .object({ case: caseContentSchema, rubric: caseRubricSchema })
  .superRefine((f, ctx) => {
    const ids = new Set(f.case.patient.facts.map((x) => x.id));
    for (const item of f.rubric.items)
      for (const id of item.linked_fact_ids)
        if (!ids.has(id))
          ctx.addIssue({ code: "custom", path: ["rubric", "items"], message: `${item.key}: unknown fact ${id}` });
  });

export type CaseContent = z.infer<typeof caseContentSchema>;
export type CaseFile = z.infer<typeof caseFileSchema>;
export type RubricTemplate = z.infer<typeof rubricTemplateSchema>;
export type RubricItem = z.infer<typeof rubricItemSchema>;
