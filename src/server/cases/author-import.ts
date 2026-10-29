import { findLeaks, leakTerms, toPatientView } from "./projector";
import { caseContentSchema, FACT_CATEGORIES, type CaseContent, type RubricItem } from "./schema";

// Converts a case written by the content author into the app's case format. Authors write cases in
// the Supabase "Patients" table as free-form JSON (question/answer pairs for the patient, marked
// sections for the rubric, task_2+ sections for the examiner). Layouts vary from case to case, so
// this reads them by shape rather than by fixed keys, and reports what it couldn't find or had to
// assume instead of guessing silently.

export type AuthorRow = {
  id: number | string;
  title: string;
  "patient.name": string | null;
  "patient.profile": unknown;
  "Voice ID": string | null;
  "Pre Reading Material": unknown;
  "Assessment Instructions": unknown;
  "Marking Rubric": unknown;
  Avatar: string | null;
};

export type ImportedCase = {
  slug: string;
  title: string;
  specialty: string;
  difficulty: number;
  voiceId: string | null;
  /** "<bucket>/<path>" in Supabase Storage. */
  avatarPath: string | null;
  content: CaseContent | null;
  rubricItems: RubricItem[];
  /** Blocking: the case can't be published until these are fixed in the Patients table. */
  gaps: string[];
  /** Not blocking: defaults the importer chose, worth checking. */
  assumptions: string[];
};

export const AVATAR_BUCKET = "OSCE-ASSETS";

const MARK_KEYS = ["marks", "mark_allocation"];
/** Keys on an examiner section that set how it's asked, not what the answer is. */
const ASKING_KEYS = ["question", "prompt", "image", "image_path", "image_alt", "image_caption"];
const CRITERIA_KEYS = ["marking_criteria", "marking_scheme", "description"];
const WRAPPERS = new Set(["marking_rubric", "patient_details", "questions", "questions_and_answers", "answers"]);

type QA = { path: string[]; question: string; answer: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const keyify = (s: string) => slugify(s).replace(/-/g, "_") || "item";

const humanize = (s: string) => {
  const t = s
    .replace(/^\d+_marks?$/, (m) => m.replace("_", " "))
    .replace(/_/g, " ")
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Any value as plain text: lists become "a; b", objects "key: value" lines. */
function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join("; ");
  if (isObj(v)) {
    return Object.entries(v)
      .map(([k, x]) => `${humanize(k)}: ${text(x)}`)
      .join("; ");
  }
  return "";
}

/** Every question/answer pair under a node, with the keys on the way to it. */
function collectQa(node: unknown, path: string[] = []): QA[] {
  if (Array.isArray(node)) return node.flatMap((n) => collectQa(n, path));
  if (!isObj(node)) return [];
  if (typeof node.question === "string" && "answer" in node) {
    const answer = text(node.answer);
    return answer ? [{ path, question: node.question.trim(), answer }] : [];
  }
  return Object.entries(node).flatMap(([k, v]) => (MARK_KEYS.includes(k) || CRITERIA_KEYS.includes(k) ? [] : collectQa(v, [...path, k])));
}

// Patient script -------------------------------------------------------------------------------

const CATEGORY_RULES: [RegExp, (typeof FACT_CATEGORIES)[number]][] = [
  [/allerg/, "Allergy"],
  [/medication|drug_history/, "DH"],
  [/family/, "FH"],
  [/social|sexual|introduction|identif/, "SH"],
  [/past_medical|birth|vaccin|immunis|growth|development|menstrual|obstetric|paediatric_history/, "PMH"],
  [/presenting|opening|feeding|hydration|context|time_course|severity|characteristic/, "HPC"],
  [/idea|concern|expectation/, "ICE"],
];

function categoryFor(path: string[]): (typeof FACT_CATEGORIES)[number] {
  const p = path.join("/").toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(p)) return cat;
  return "ROS";
}

function factsFrom(profile: unknown) {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const facts: CaseContent["patient"]["facts"] = [];
  for (const qa of collectQa(profile)) {
    const dedupe = `${qa.question.toLowerCase()}|${qa.answer.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const category = categoryFor(qa.path);
    const base = keyify(
      qa.path
        .filter((p) => !WRAPPERS.has(p))
        .slice(-2)
        .join("_") || category,
    ).slice(0, 40);
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
    ids.add(id);
    const opening = qa.path.some((p) => p.includes("opening"));
    facts.push({
      id,
      category,
      content: qa.answer.length < 3 ? `${qa.answer}.` : qa.answer,
      prompt: qa.question,
      disclosure: opening ? "volunteered" : category === "HPC" ? "on_open_question" : "on_direct_question",
      is_red_flag: false,
    });
  }
  return facts;
}

// Reading and tasks ----------------------------------------------------------------------------

function readingText(pre: unknown): string {
  if (typeof pre === "string") return pre.trim();
  if (!isObj(pre)) return "";
  for (const k of ["scenario", "prereading", "pre_reading", "brief", "candidate_brief"]) {
    if (typeof pre[k] === "string") return (pre[k] as string).trim();
  }
  const structured = (pre.pre_reading_material ?? pre) as Record<string, unknown>;
  if (!isObj(structured)) return text(pre);
  const p = isObj(structured.patient) ? structured.patient : {};
  const parts: string[] = [];
  if (structured.clinician_role || structured.setting) {
    parts.push(
      `You are ${structured.clinician_role ? `a${/^[aeiou]/i.test(String(structured.clinician_role)) ? "n" : ""} ${String(structured.clinician_role).toLowerCase()}` : "a doctor"}${structured.setting ? ` in a ${String(structured.setting).toLowerCase()}` : ""}.`,
    );
  }
  if (p.name) {
    const who = [p.age ? `${p.age}-year-old` : "", p.gender ? String(p.gender).toLowerCase() : ""].filter(Boolean).join(" ");
    parts.push(
      `${p.name}${who ? `, a ${who},` : ""} presents to you${structured.presenting_complaint ? ` saying: "${structured.presenting_complaint}"` : ""}.`,
    );
  }
  const rest = Object.entries(structured).filter(([k]) => !["clinician_role", "setting", "patient", "presenting_complaint"].includes(k));
  for (const [k, v] of rest) parts.push(`${humanize(k)}: ${text(v)}`);
  return parts.join(" ");
}

function tasksFrom(instructions: unknown): { lead: string; tasks: string[]; minutes: number | null } {
  let lead = "";
  let tasks: string[] = [];
  let minutes: number | null = null;
  const fromString = (s: string) => {
    const lines = s.split("\n").map((l) => l.trim());
    const numbered = lines.map((l) => /^\d+[.)]\s*(.+)$/.exec(l)?.[1]).filter((x): x is string => Boolean(x));
    if (numbered.length) {
      tasks = numbered;
      lead = lines.filter((l) => l && !/^\d+[.)]/.test(l)).join(" ");
    } else lead = s.trim();
  };
  const taskLine = (t: unknown) =>
    isObj(t)
      ? `${text(t.task ?? t.description ?? t)}${t.duration_minutes ? ` (${t.duration_minutes} minute${t.duration_minutes === 1 ? "" : "s"})` : ""}`
      : text(t);

  const v = parse(instructions);
  if (typeof v === "string") fromString(v);
  else if (isObj(v)) {
    const inner = v.assessment_task;
    if (typeof inner === "string") fromString(inner);
    if (Array.isArray(v.tasks)) tasks = v.tasks.map(taskLine);
    if (isObj(inner)) {
      if (Array.isArray(inner.tasks)) tasks = inner.tasks.map(taskLine);
      if (typeof inner.duration_minutes === "number") minutes = inner.duration_minutes;
    }
  }
  const all = [lead, ...tasks].join(" ");
  minutes ??= Number(/(\d+)\s*minutes?\s+to\s+perform/i.exec(all)?.[1]) || null;
  if (!lead) lead = minutes ? `You will have ${minutes} minutes to perform the following:` : "Perform the following:";
  return { lead, tasks, minutes };
}

function demographics(brief: string, pre: unknown) {
  const structured =
    isObj(pre) && isObj(pre.pre_reading_material) && isObj(pre.pre_reading_material.patient) ? pre.pre_reading_material.patient : null;
  const age = Number(structured?.age ?? /(\d{1,3})[- ]year[- ]old/i.exec(brief)?.[1]) || null;
  const g = String(structured?.gender ?? "").toLowerCase();
  const sexText = `${g} ${brief}`.toLowerCase();
  const sex: "female" | "male" | null = /\b(female|woman|she\/her|mother|girl)\b/.test(sexText)
    ? "female"
    : /\b(male|man|he\/him|father|boy)\b/.test(sexText)
      ? "male"
      : null;
  const occupation = /\d+-year-old (?:\w+ )?(\w+) who/i.exec(brief)?.[1] ?? null;
  return { age, sex, occupation: occupation && !/^(woman|man|male|female)$/i.test(occupation) ? occupation : null };
}

// Rubric ---------------------------------------------------------------------------------------

type Section = { path: string[]; node: Record<string, unknown>; marks: number; task: number };

function sectionsIn(node: unknown, path: string[] = [], task = 1): Section[] {
  if (!isObj(node)) return [];
  const markKey = MARK_KEYS.find((k) => typeof node[k] === "number");
  if (markKey && path.length) return [{ path, node, marks: node[markKey] as number, task }];
  return Object.entries(node).flatMap(([k, v]) => {
    const t = /^task_(\d+)$/.exec(k);
    return sectionsIn(v, [...path, k], t ? Number(t[1]) : task);
  });
}

function criteriaText(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of CRITERIA_KEYS) {
    const c = node[k];
    if (typeof c === "string") out.push(c);
    else if (isObj(c)) {
      for (const [ck, cv] of Object.entries(c)) {
        if (typeof cv === "number") out.push(`${humanize(ck)}: ${cv} mark${cv === 1 ? "" : "s"}`);
        else out.push(`${humanize(ck)}: ${text(cv)}`);
      }
    }
  }
  return out;
}

const DOMAIN_RULES: [RegExp, RubricItem["domain"]][] = [
  [/differential|diagnos/, "differentials"],
  [/investigat|interpret|ecg|imaging|bloods/, "investigations"],
  [/manage|plan|follow|treat/, "management"],
  [/introduc|rapport|communicat|empath|consent/, "communication"],
  [/safety|red_flag/, "patient_safety"],
];

function domainFor(path: string[], examiner: boolean): RubricItem["domain"] {
  const p = path.join("/").toLowerCase();
  for (const [re, d] of DOMAIN_RULES) if (re.test(p)) return d;
  return examiner ? "clinical_reasoning" : "history";
}

function examinerPrompt(key: string, node: Record<string, unknown>): string {
  for (const k of ["question", "prompt"])
    if (typeof node[k] === "string" && (node[k] as string).trim().length >= 5) return (node[k] as string).trim();
  const answers = Array.isArray(node.answers) ? node.answers.length : 0;
  if (/differential/.test(key))
    return answers ? `What are your top ${answers} differential diagnoses, and why?` : "What are your differential diagnoses, and why?";
  if (/provisional|diagnos/.test(key)) return "What is your provisional diagnosis, and why?";
  if (/investigat/.test(key)) return "What investigations would you order, and why?";
  if (/manage|plan|follow/.test(key)) return "How would you manage this patient, and what follow-up would you arrange?";
  return `Tell me about: ${humanize(key).toLowerCase()}.`;
}

/** Model-answer lines for an examiner section: each answer or group on its own line. */
function modelAnswer(node: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (MARK_KEYS.includes(k) || CRITERIA_KEYS.includes(k) || ASKING_KEYS.includes(k)) continue;
    if (Array.isArray(v)) {
      for (const a of v) {
        if (isObj(a) && (a.diagnosis || a.system)) {
          const head = text(a.diagnosis ?? a.system);
          const rest = Object.entries(a).filter(([ak]) => ak !== "diagnosis" && ak !== "system");
          lines.push(
            `${WRAPPERS.has(k) ? "" : `${humanize(k)}: `}${head}${rest.length ? ` (${rest.map(([, rv]) => text(rv)).join("; ")})` : ""}`,
          );
        } else lines.push(`${WRAPPERS.has(k) ? "" : `${humanize(k)}: `}${text(a)}`);
      }
    } else if (text(v)) lines.push(`${humanize(k)}: ${text(v)}`);
  }
  return lines.filter(Boolean);
}

const MAX_LISTED_QUESTIONS = 30;

// Specialty and the case ---------------------------------------------------------------------------

function specialtyFor(title: string, brief: string, known: Set<string>): string | null {
  const t = `${title} ${brief}`.toLowerCase();
  const pick = (slug: string) => (known.has(slug) ? slug : null);
  if (/paediatric|week-old|month-old|baby|infant|child/.test(t)) return pick("paediatrics");
  if (/postcoital|post-coital|vaginal|cervical|pregnan|menstrual/.test(t)) return pick("obstetrics-gynaecology");
  if (/emergency department|\bed\b/.test(t)) return pick("emergency");
  if (/general practi|\bgp\b/.test(t)) return pick("general-practice");
  return null;
}

export function convertAuthorCase(row: AuthorRow, specialties: Set<string>): ImportedCase {
  const gaps: string[] = [];
  const assumptions: string[] = [];
  const title = row.title.trim();
  const slug = slugify(title);
  const profile = parse(row["patient.profile"]);
  const pre = parse(row["Pre Reading Material"]);
  const rubricJson = parse(row["Marking Rubric"]);

  const brief = readingText(pre);
  if (brief.length < 20) gaps.push("Pre Reading Material: no scenario text found for the candidate brief.");
  const { lead, tasks, minutes } = tasksFrom(row["Assessment Instructions"]);
  if (!tasks.length) assumptions.push("Assessment Instructions: no numbered tasks found; the whole text is shown as the task.");
  const stationSeconds = (minutes ?? 8) * 60;
  if (!minutes) assumptions.push("Station length not stated; using 8 minutes.");

  // Patient
  const facts = factsFrom(profile);
  if (facts.length < 5) gaps.push(`patient.profile: only ${facts.length} question/answer pairs found (need at least 5).`);
  const rubricQa = collectQa(rubricJson);
  const openingQa =
    collectQa(profile).find((q) => q.path.some((p) => p.includes("opening"))) ??
    rubricQa.find((q) => q.path.some((p) => p.includes("opening")));
  if (!openingQa) gaps.push("No opening statement (an opening_statement question/answer) for the patient.");
  const who = demographics(brief, pre);
  who.occupation ??= collectQa(profile).find((q) => q.path.some((p) => /occupation|job|work/.test(p)))?.answer ?? null;
  if (!who.age) gaps.push('Patient age not found in the pre-reading (e.g. "a 63-year-old man").');
  if (!who.sex) gaps.push("Patient sex not found in the pre-reading.");
  const name = (row["patient.name"] ?? "").trim();
  if (!name) gaps.push("patient.name is empty.");

  // Rubric: task 1 sections mark the history; later tasks are the examiner's questions.
  const sections = sectionsIn(rubricJson);
  const usedKeys = new Set<string>();
  const rubricItems: RubricItem[] = [];
  const examinerItems: CaseContent["examiner_items"] = [];
  let differentials: { dx: string; why: string }[] = [];
  let investigations: string[] = [];
  for (const s of sections) {
    if (s.marks <= 0) continue;
    const meaningful = s.path.filter((p) => !WRAPPERS.has(p) && !/^task_\d+$/.test(p));
    let key = keyify(meaningful.slice(-1).join("_"));
    if (usedKeys.has(key)) key = keyify(meaningful.slice(-2).join("_"));
    for (let n = 2; usedKeys.has(key); n++) key = `${keyify(meaningful.slice(-1).join("_"))}_${n}`;
    usedKeys.add(key);
    const label = meaningful.map(humanize).join(": ");
    const examiner = s.task >= 2;
    const criteria = criteriaText(s.node);
    if (examiner) {
      const answer = modelAnswer(s.node);
      if (!answer.length) gaps.push(`Rubric ${s.path.join(" → ")}: examiner task has marks but no model answer.`);
      const image = [s.node.image, s.node.image_path].find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim();
      examinerItems.push({
        key,
        prompt: examinerPrompt(key, s.node),
        model_answer: answer.length ? answer : ["(no model answer)"],
        ...(image
          ? {
              media: {
                path: image,
                alt: typeof s.node.image_alt === "string" ? s.node.image_alt : `Image for: ${label}`,
                caption: typeof s.node.image_caption === "string" ? s.node.image_caption : undefined,
              },
            }
          : {}),
      });
      rubricItems.push({
        key,
        domain: domainFor(s.path, true),
        label,
        description: [`Model answer: ${answer.join(" | ")}`, ...criteria].join(". "),
        max_points: s.marks,
        linked_fact_ids: [],
        is_critical: false,
      });
      if (/differential/.test(key) && Array.isArray(s.node.answers)) {
        differentials = s.node.answers
          .filter(isObj)
          .map((a) => ({ dx: text(a.diagnosis), why: text(a.rationale) }))
          .filter((d) => d.dx);
      }
      if (/investigat/.test(key)) investigations = answer;
    } else {
      const asks = collectQa(s.node).map((q) => q.question);
      const extras = Object.entries(s.node)
        .filter(([k, v]) => typeof v === "string" && !["question", "answer"].includes(k) && !CRITERIA_KEYS.includes(k))
        .map(([k]) => humanize(k).toLowerCase());
      const listed = asks.slice(0, MAX_LISTED_QUESTIONS);
      // A section with an answer but no question marks eliciting that detail (e.g. confirming the name).
      const expected = typeof s.node.question !== "string" && "answer" in s.node ? `Elicits: ${text(s.node.answer)}` : "";
      const description = [
        expected,
        ...criteria,
        listed.length
          ? `Expected questions: ${listed.join(" / ")}${asks.length > listed.length ? ` (and ${asks.length - listed.length} more)` : ""}`
          : "",
        extras.length ? `Also covers: ${extras.join(", ")}` : "",
      ].filter(Boolean);
      rubricItems.push({
        key,
        domain: domainFor(s.path, false),
        label,
        description: description.join(". ") || undefined,
        max_points: s.marks,
        linked_fact_ids: [],
        is_critical: false,
      });
    }
  }
  if (!rubricItems.length) gaps.push("Marking Rubric: no sections with marks found.");

  // Tasks beyond the history need examiner questions with model answers.
  const examinerTasks = tasks.filter((t) => !/history/i.test(t));
  if (examinerTasks.length && !examinerItems.length) {
    gaps.push(
      `Examiner stage: the tasks include "${examinerTasks.join('", "')}", but the rubric has no task_2+ sections with the questions, model answers and marks.`,
    );
  }

  // Clinical answers: an explicit "diagnosis" in the rubric, else the leading differential.
  const stated = isObj(rubricJson)
    ? [rubricJson, ...Object.values(rubricJson).filter(isObj)]
        .map((o) => o.diagnosis ?? o.final_diagnosis)
        .find((d): d is string => typeof d === "string" && d.trim() !== "")
    : undefined;
  if (stated)
    differentials = [
      { dx: stated.trim(), why: "Stated diagnosis." },
      ...differentials.filter((d) => d.dx.toLowerCase() !== stated.trim().toLowerCase()),
    ];
  if (!differentials.length)
    gaps.push(
      'No diagnosis: add "diagnosis": "…" to the Marking Rubric, or a task_2 top_differentials section with answers, so the examiner knows the answer and the patient can be checked for leaks.',
    );
  else if (!stated) assumptions.push(`Diagnosis taken as the first differential: "${differentials[0].dx}".`);

  const known = specialtyFor(title, brief, specialties);
  const specialty = known ?? "general-practice";
  if (!known) assumptions.push("Specialty not recognised; using General Practice.");
  else assumptions.push(`Specialty set to "${specialty}" from the title and scenario.`);
  assumptions.push("Difficulty not stated; using 3 of 5.", "Patient manner not stated; using cooperative.");

  const voiceId = row["Voice ID"]?.trim() || null;
  if (!voiceId) assumptions.push("No Voice ID; the app will pick a voice automatically.");
  else if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) gaps.push(`Voice ID "${voiceId}" doesn't look like an ElevenLabs voice id.`);
  const avatar = row.Avatar?.trim() || null;
  const avatarPath = avatar ? `${AVATAR_BUCKET}/${avatar}` : null;

  let content: CaseContent | null = null;
  if (!gaps.length) {
    const draft = {
      meta: {
        slug,
        title,
        specialty,
        difficulty: 3,
        station: { reading_seconds: 120, station_seconds: stationSeconds },
        learning_objectives: [],
        tags: [],
        references: [],
        review_status: "pending_clinician_review",
      },
      candidate_brief: brief,
      assessment_task: [lead, ...tasks.map((t, i) => `${i + 1}. ${t}`)].join("\n"),
      reading: { tasks, media: [] },
      examiner_items: examinerItems,
      patient: {
        name,
        age: who.age!,
        sex: who.sex!,
        occupation: who.occupation ?? "Not stated",
        voice_profile: "",
        persona: "cooperative",
        persona_notes: "Answers what is asked, in everyday language. Doesn't volunteer details unless asked.",
        opening_statement: openingQa!.answer,
        presenting_complaint: { "in their words": openingQa!.answer },
        facts,
        behaviour_rules: [
          "Only give the answers in your script. If asked something your script doesn't cover, say you're not sure or that it's not something you've noticed.",
        ],
      },
      clinical: {
        diagnosis: differentials[0].dx,
        diagnosis_synonyms: [],
        differentials: differentials.map((d, i) => ({
          dx: d.dx,
          likelihood: i === 0 ? "leading" : "likely",
          discriminating_features: d.why || "See model answer.",
        })),
        red_flags: [],
        expected_investigations: investigations,
        expected_management: [],
      },
    };
    const parsed = caseContentSchema.safeParse(draft);
    if (!parsed.success)
      gaps.push(`Case format check failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    else {
      const leaks = findLeaks(toPatientView(parsed.data), leakTerms(parsed.data));
      if (leaks.length)
        gaps.push(`The patient's answers mention the diagnosis (${leaks.join(", ")}); reword them so the patient can't give it away.`);
      else content = parsed.data;
    }
  }

  return { slug, title, specialty, difficulty: 3, voiceId, avatarPath, content, rubricItems, gaps, assumptions };
}
