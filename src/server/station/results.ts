import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { caseVersion, loadOwned, phaseMessages } from "./orchestrator";

// The post-station report. Clinical details (diagnosis, differentials, model plan) are revealed
// only once the station is completed, and only for the student's own station.

export async function loadResult(userId: string, id: string) {
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  const { data: assessment } = await db
    .from("assessments")
    .select(
      "id, status, overall_score, global_rating, passed, strengths, improvements, missed_questions, missed_red_flags, revision_topics, examiner_comment, completed_at",
    )
    .eq("consultation_id", id)
    .maybeSingle();

  const { content } = await caseVersion(db, station.case_version_id);
  const base = { id, status: station.status, title: content.meta.title, patientName: content.patient.name };
  if (station.status !== "completed" || assessment?.status !== "complete") return { ...base, report: null };

  const [domains, items, xp, history, presentation, qa] = await Promise.all([
    db.from("assessment_domain_scores").select("domain, score, max, pct").eq("assessment_id", assessment.id),
    db
      .from("assessment_item_scores")
      .select("outcome, points, evidence_quote, rubric_items(key, domain, label, max_points, is_critical, sort_order)")
      .eq("assessment_id", assessment.id),
    db.from("xp_events").select("source, amount").eq("consultation_id", id),
    phaseMessages(db, id, "history"),
    phaseMessages(db, id, "presentation"),
    db.from("examiner_questions").select("ord, question, answer_transcript").eq("consultation_id", id).order("ord"),
  ]);

  type ItemRow = {
    outcome: "met" | "partial" | "not_met";
    points: number;
    evidence_quote: string | null;
    rubric_items: { key: string; domain: string; label: string; max_points: number; is_critical: boolean; sort_order: number };
  };
  const factById = new Map(content.patient.facts.map((f) => [f.id, f.content]));

  return {
    ...base,
    report: {
      overall: Number(assessment.overall_score),
      rating: assessment.global_rating as string,
      passed: Boolean(assessment.passed),
      strengths: assessment.strengths as string[],
      improvements: assessment.improvements as string[],
      missedQuestions: assessment.missed_questions as string[],
      missedRedFlags: assessment.missed_red_flags as string[],
      revisionTopics: assessment.revision_topics as string[],
      comment: assessment.examiner_comment as string,
      domains: (domains.data ?? []).map((d) => ({
        domain: d.domain as string,
        score: Number(d.score),
        max: Number(d.max),
        pct: Number(d.pct),
      })),
      items: ((items.data ?? []) as unknown as ItemRow[])
        .sort((a, b) => a.rubric_items.sort_order - b.rubric_items.sort_order)
        .map((i) => ({
          key: i.rubric_items.key,
          domain: i.rubric_items.domain,
          label: i.rubric_items.label,
          critical: i.rubric_items.is_critical,
          outcome: i.outcome,
          points: Number(i.points),
          max: Number(i.rubric_items.max_points),
          evidence: i.evidence_quote,
        })),
      xp: (xp.data ?? []).map((x) => ({ source: x.source as string, amount: x.amount as number })),
      transcript: {
        history: history.map((m) => ({ role: m.role, content: m.content })),
        presentation: presentation.map((m) => m.content),
        qa: (qa.data ?? []).map((q) => ({ question: q.question as string, answer: q.answer_transcript as string | null })),
      },
      reveal: {
        diagnosis: content.clinical.diagnosis,
        differentials: content.clinical.differentials,
        redFlags: content.clinical.red_flags.map((r) => ({ fact: factById.get(r.fact_id) ?? r.fact_id, why: r.why })),
        investigations: content.clinical.expected_investigations,
        management: content.clinical.expected_management,
        safetyNetting: content.clinical.safety_netting,
        objectives: content.meta.learning_objectives,
        references: content.meta.references,
        pendingReview: content.meta.review_status !== "clinician_reviewed",
      },
    },
  };
}

export type StationResult = Awaited<ReturnType<typeof loadResult>>;
export type Report = NonNullable<StationResult["report"]>;
