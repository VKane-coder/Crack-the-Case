import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { LENGTHS, PAGE_SIZE, toPrefixTsquery, type CaseFilters } from "@/features/case-library/filters";

// The case library (docs/architecture.md §2.1, GET /api/cases). Cases come from v_case_catalog as the
// signed-in student, so RLS decides what they can see and the diagnosis never leaves the server.

export type CatalogCase = {
  id: string;
  slug: string;
  title: string;
  difficulty: number;
  persona: string | null;
  specialty_slug: string;
  specialty_name: string;
  station_seconds: number;
  candidate_brief: string | null;
};

/** The student's history with a case: completed stations and their best score. */
export type CaseProgress = { completed: number; bestScore: number | null };

export type CatalogPage = {
  cases: (CatalogCase & { progress: CaseProgress })[];
  total: number;
  page: number;
  pageCount: number;
  specialties: { slug: string; name: string }[];
};

const COLUMNS = "id, slug, title, difficulty, persona, specialty_slug, specialty_name, station_seconds, candidate_brief";

export async function listCases(db: SupabaseClient, userId: string, f: CaseFilters): Promise<CatalogPage> {
  let query = db.from("v_case_catalog").select(COLUMNS, { count: "exact" });
  if (f.specialty) query = query.eq("specialty_slug", f.specialty);
  if (f.difficulty) query = query.eq("difficulty", f.difficulty);
  if (f.length) {
    const { min, max } = LENGTHS[f.length];
    query = query.gte("station_seconds", min);
    if (max !== null) query = query.lte("station_seconds", max);
  }
  if (f.q) query = query.textSearch("search", toPrefixTsquery(f.q), { config: "english" });

  const from = (f.page - 1) * PAGE_SIZE;
  const [page, specialties] = await Promise.all([
    query.order("difficulty").order("title").range(from, from + PAGE_SIZE - 1),
    db.from("v_case_catalog").select("specialty_slug, specialty_name").order("specialty_name"),
  ]);
  // Asking for a page past the end is a PostgREST range error; treat it as an empty page.
  if (page.error && page.error.code !== "PGRST103") throw page.error;
  if (specialties.error) throw specialties.error;

  const cases = (page.data ?? []) as CatalogCase[];
  const progress = await caseProgress(userId, cases.map((c) => c.id));
  const total = page.count ?? 0;
  const seen = new Map<string, string>();
  for (const s of specialties.data ?? []) seen.set(s.specialty_slug, s.specialty_name);

  return {
    cases: cases.map((c) => ({ ...c, progress: progress.get(c.id) ?? { completed: 0, bestScore: null } })),
    total,
    page: f.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    specialties: [...seen].map(([slug, name]) => ({ slug, name })),
  };
}

/**
 * Completed stations per case for one student. Uses the service role because students can't read
 * case_versions (the only link from a station to its case); every query is filtered to this student.
 */
async function caseProgress(userId: string, caseIds: string[]): Promise<Map<string, CaseProgress>> {
  const out = new Map<string, CaseProgress>();
  if (!caseIds.length) return out;
  const { data, error } = await createAdminClient()
    .from("consultations")
    .select("case_versions!inner(case_id), assessments(status, overall_score)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .in("case_versions.case_id", caseIds);
  if (error) throw error;

  type Row = {
    case_versions: { case_id: string } | { case_id: string }[];
    assessments: { status: string; overall_score: number | null } | { status: string; overall_score: number | null }[] | null;
  };
  for (const row of (data ?? []) as Row[]) {
    const caseId = (Array.isArray(row.case_versions) ? row.case_versions[0] : row.case_versions)?.case_id;
    if (!caseId) continue;
    const assessment = Array.isArray(row.assessments) ? row.assessments[0] : row.assessments;
    const score = assessment?.status === "complete" && assessment.overall_score !== null ? Number(assessment.overall_score) : null;
    const p = out.get(caseId) ?? { completed: 0, bestScore: null };
    p.completed += 1;
    if (score !== null && (p.bestScore === null || score > p.bestScore)) p.bestScore = score;
    out.set(caseId, p);
  }
  return out;
}
