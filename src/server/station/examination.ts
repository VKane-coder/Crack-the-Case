import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExaminerInput, ExaminerRubric } from "@/server/agents/examiner/context";
import type { ExaminerCall, ExaminerLlm } from "@/server/agents/examiner/llm";
import { EXAMINER_PROMPT_VERSION } from "@/server/agents/examiner/prompts";
import { costUsd, MODELS } from "@/server/agents/shared/models";
import { scoreAssessment } from "@/server/assessment/scoring";
import { stationXp } from "@/server/gamification/xp";
import { examinerLlm } from "./llm";
import {
  caseVersion,
  clockExpired,
  endHistory,
  insertMessage,
  loadOwned,
  MAX_UTTERANCE_CHARS,
  phaseMessages,
  signedMediaUrl,
  StationError,
  transition,
  type ConsultationStatus,
  type Db,
} from "./orchestrator";

// Presentation → examiner questions → assessment (docs/architecture.md §2.3, §3.3, §6). All of it
// runs on the station clock that started with the patient; when it runs out, finishStation moves
// the station straight to marking from wherever the student was.

export const MAX_ASSESSMENT_ATTEMPTS = 3;
const MAX_SEGMENTS = 40;

async function loadRubric(db: Db, rubricVersionId: string) {
  const [{ data: version, error }, { data: items, error: itemsError }] = await Promise.all([
    db
      .from("rubric_versions")
      .select("domain_weights, global_rating_descriptors, examiner_question_bank, pass_mark")
      .eq("id", rubricVersionId)
      .single(),
    db
      .from("rubric_items")
      .select("id, key, domain, label, description, max_points, linked_fact_ids, is_critical")
      .eq("rubric_version_id", rubricVersionId)
      .order("sort_order"),
  ]);
  if (error) throw error;
  if (itemsError) throw itemsError;
  const rubric: ExaminerRubric & { domain_weights: Record<string, number>; pass_mark: number; ids: Map<string, string> } = {
    items: items.map((i) => ({ ...i, max_points: Number(i.max_points) })),
    question_bank: version.examiner_question_bank,
    global_rating_descriptors: version.global_rating_descriptors,
    domain_weights: version.domain_weights,
    pass_mark: Number(version.pass_mark),
    ids: new Map(items.map((i) => [i.key, i.id])),
  };
  return rubric;
}

async function examinerInput(db: Db, station: { id: string; case_version_id: string; disclosed_fact_ids: string[] }) {
  const [{ content, rubricVersionId }, history, presentation, qa] = await Promise.all([
    caseVersion(db, station.case_version_id),
    phaseMessages(db, station.id, "history"),
    phaseMessages(db, station.id, "presentation"),
    db.from("examiner_questions").select("ord, question, answer_transcript").eq("consultation_id", station.id).order("ord"),
  ]);
  const rubric = await loadRubric(db, rubricVersionId);
  const input: ExaminerInput = {
    content,
    rubric,
    disclosedFactIds: station.disclosed_fact_ids,
    transcripts: {
      history: history.map((m) => ({ role: m.role, content: m.content })),
      presentation: presentation.map((m) => m.content),
      qa: (qa.data ?? []).map((q) => ({ question: q.question, answer: q.answer_transcript })),
    },
  };
  return { input, rubric, rubricVersionId };
}

async function logCall(db: Db, userId: string, id: string, agent: "examiner_q" | "examiner_assess", c: ExaminerCall) {
  const { error } = await db.from("ai_calls").insert({
    consultation_id: id,
    user_id: userId,
    agent,
    model: c.model,
    prompt_version: EXAMINER_PROMPT_VERSION,
    input_tokens: c.usage.inputTokens,
    output_tokens: c.usage.outputTokens,
    cache_read_tokens: c.usage.cacheReadTokens,
    cache_write_tokens: c.usage.cacheWriteTokens,
    latency_ms: c.latencyMs,
    cost_usd: costUsd(c.model, c.usage),
    status: c.status,
    error: c.error ?? null,
  });
  if (error) console.error("ai_calls insert failed", { code: error.code });
}

function failure(err: unknown, model: string): ExaminerCall {
  const attached = (err as { call?: ExaminerCall }).call;
  const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
  return attached ? { ...attached, error: message } : { model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, latencyMs: 0, status: "error", error: message };
}

// Presentation ---------------------------------------------------------------------------------

/** history_ended → presentation: the presentation clock starts. Idempotent. */
export async function beginPresentation(userId: string, id: string) {
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status === "presentation") return { deadline: station.phase_deadline_at };
  if (station.status !== "history_ended") throw new StationError("wrong_phase", "The history isn't finished yet.");
  const moved = await transition(db, id, "history_ended", "presentation");
  return { deadline: moved.phase_deadline_at };
}

/** Stores one spoken or typed part of the presentation. No AI reply: the examiner just listens. */
export async function addPresentationSegment(userId: string, id: string, input: { text: string; clientSeq: number }) {
  const text = input.text.trim();
  if (!text || text.length > MAX_UTTERANCE_CHARS || !Number.isInteger(input.clientSeq) || input.clientSeq < 0) {
    throw new StationError("invalid_input", `Say something between 1 and ${MAX_UTTERANCE_CHARS} characters.`);
  }
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status !== "presentation") throw new StationError("wrong_phase", "The presentation isn't running.");
  if (clockExpired(station)) throw new StationError("phase_over", "Time's up.");
  const existing = await phaseMessages(db, id, "presentation");
  if (existing.some((m) => m.client_seq === input.clientSeq)) return { stored: false };
  if (existing.length >= MAX_SEGMENTS) throw new StationError("invalid_input", "That's a long presentation! Time to wrap up.");
  try {
    await insertMessage(db, id, { role: "student", content: text, clientSeq: input.clientSeq, phase: "presentation" });
  } catch (e) {
    if (e instanceof StationError && e.code === "turn_in_progress") return { stored: false };
    throw e;
  }
  return { stored: true };
}

// Examiner questions -----------------------------------------------------------------------------

type Question = { ord: number; question: string; answered: boolean; mediaPath: string | null; itemKey: string | null };

async function questions(db: Db, id: string): Promise<Question[]> {
  const { data, error } = await db
    .from("examiner_questions")
    .select("ord, question, answered_at, media_path, item_key")
    .eq("consultation_id", id)
    .order("ord");
  if (error) throw error;
  return data.map((q) => ({ ord: q.ord, question: q.question, answered: q.answered_at !== null, mediaPath: q.media_path, itemKey: q.item_key }));
}

export type QuestionMedia = { url: string; alt: string; caption: string | null };

/** The image for an author-written question, signed only once that question is being asked. */
export async function questionMedia(db: Db, caseVersionId: string, q: { mediaPath: string | null; itemKey: string | null }): Promise<QuestionMedia | null> {
  if (!q.mediaPath) return null;
  const [url, { content }] = await Promise.all([signedMediaUrl(db, q.mediaPath), caseVersion(db, caseVersionId)]);
  if (!url) return null;
  const item = content.examiner_items?.find((i) => i.key === q.itemKey);
  return { url, alt: item?.media?.alt ?? "Image for this question", caption: item?.media?.caption ?? null };
}

async function nextQuestion(db: Db, caseVersionId: string, qs: Question[]) {
  const next = qs.find((q) => !q.answered);
  const media = next ? await questionMedia(db, caseVersionId, next) : null;
  return { question: next ? { ord: next.ord, text: next.question, media } : null, total: qs.length };
}

/**
 * presentation → examiner_questions. Compiles the presentation transcript, then sets the questions:
 * the case author's examiner items when the case has them, otherwise 1–3 from the questioner
 * (falling back to the case's question bank if the model fails). Idempotent.
 */
export async function endPresentation(userId: string, id: string, llm: ExaminerLlm = examinerLlm()) {
  const db = createAdminClient();
  let station = await loadOwned(db, userId, id);
  if (station.status === "presentation") {
    station = await transition(db, id, "presentation", "examiner_questions").catch((e) => {
      if (e instanceof StationError) return loadOwned(db, userId, id);
      throw e;
    });
  }
  if (station.status !== "examiner_questions") throw new StationError("wrong_phase", "The presentation isn't running.");

  const existing = await questions(db, id);
  if (existing.length) return nextQuestion(db, station.case_version_id, existing);

  const { input, rubric } = await examinerInput(db, station);
  const text = input.transcripts.presentation.join("\n");
  await db
    .from("transcripts")
    .upsert(
      { consultation_id: id, kind: "presentation", text, word_count: text.split(/\s+/).filter(Boolean).length, compiled_at: new Date().toISOString() },
      { onConflict: "consultation_id,kind" },
    );

  const authored = input.content.examiner_items ?? [];
  if (authored.length) {
    const { error } = await db.from("examiner_questions").insert(
      authored.map((item, i) => ({
        consultation_id: id,
        ord: i + 1,
        question: item.prompt,
        rationale: "case author's examiner item",
        item_key: item.key,
        media_path: item.media?.path ?? null,
        targeted_rubric_item_ids: rubric.ids.has(item.key) ? [rubric.ids.get(item.key)!] : [],
      })),
    );
    if (error && error.code !== "23505") throw error;
    return nextQuestion(db, station.case_version_id, await questions(db, id));
  }

  let generated: { question: string; rationale: string; targets: string[] }[];
  try {
    const { output, call } = await llm.questions(input, AbortSignal.timeout(45_000));
    await logCall(db, userId, id, "examiner_q", call);
    generated = output.questions.filter((q) => q.question.trim()).slice(0, 3);
  } catch (err) {
    await logCall(db, userId, id, "examiner_q", failure(err, MODELS.questioner));
    generated = [];
  }
  if (!generated.length) {
    generated = input.rubric.question_bank.slice(0, 2).map((q) => ({ question: q.question, rationale: "question bank fallback", targets: q.targets }));
  }

  const keys = new Set(rubric.items.map((i) => i.key));
  const { error } = await db.from("examiner_questions").insert(
    generated.map((q, i) => ({
      consultation_id: id,
      ord: i + 1,
      question: q.question.trim(),
      rationale: q.rationale,
      targeted_rubric_item_ids: q.targets.filter((t) => keys.has(t)).map((t) => rubric.ids.get(t)!),
    })),
  );
  // A concurrent request may have inserted them first; either way, read back what's stored.
  if (error && error.code !== "23505") throw error;
  return nextQuestion(db, station.case_version_id, await questions(db, id));
}

/** Stores the answer to one question and returns the next, or null when they're all answered. */
export async function answerQuestion(userId: string, id: string, input: { ord: number; answer: string }) {
  const answer = input.answer.trim();
  if (!answer || answer.length > MAX_UTTERANCE_CHARS * 3) throw new StationError("invalid_input", "Give an answer of up to a few sentences.");
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status !== "examiner_questions") throw new StationError("wrong_phase", "The examiner isn't asking questions right now.");
  if (clockExpired(station)) throw new StationError("phase_over", "Time's up.");
  const { error } = await db
    .from("examiner_questions")
    .update({ answer_transcript: answer, answered_at: new Date().toISOString() })
    .eq("consultation_id", id)
    .eq("ord", input.ord)
    .is("answered_at", null);
  if (error) throw error;
  return nextQuestion(db, station.case_version_id, await questions(db, id));
}

// Assessment ---------------------------------------------------------------------------------

const MARKABLE: ConsultationStatus[] = ["history", "history_ended", "presentation", "examiner_questions"];

/**
 * → assessing, after the last examiner question or when the station clock runs out (from whichever
 * stage the student was in; the stages they didn't reach simply earn no marks). Before the clock runs
 * out, only a finished examiner stage can be marked. Call runAssessment afterwards. Idempotent.
 */
export async function finishStation(userId: string, id: string) {
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (MARKABLE.includes(station.status)) {
    if (station.status !== "examiner_questions" && !clockExpired(station, Date.now() + 5_000)) {
      throw new StationError("wrong_phase", "There's still time on the clock.");
    }
    // The history transcript is compiled when the history ends; do that first if time ran out mid-history.
    if (station.status === "history") await endHistory(userId, id).catch(() => {});
    const current = await loadOwned(db, userId, id);
    if (MARKABLE.includes(current.status)) {
      await transition(db, id, current.status, "assessing").catch((e) => {
        if (!(e instanceof StationError)) throw e;
      });
    }
  } else if (!["assessing", "completed"].includes(station.status)) {
    throw new StationError("wrong_phase", "There's nothing to assess yet.");
  }
  const { rubricVersionId } = await caseVersion(db, station.case_version_id);
  await db
    .from("assessments")
    .upsert({ consultation_id: id, user_id: userId, rubric_version_id: rubricVersionId, status: "pending" }, { onConflict: "consultation_id", ignoreDuplicates: true });
  return { status: "assessing" as const };
}

/** assessment_failed → assessing, for the student's "try again" button. */
export async function retryAssessment(userId: string, id: string) {
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status !== "assessment_failed") throw new StationError("wrong_phase", "This station isn't waiting for a retry.");
  await transition(db, id, "assessment_failed", "assessing");
  await db.from("assessments").update({ status: "pending", attempts: 0, error: null }).eq("consultation_id", id);
  return { status: "assessing" as const };
}

/**
 * Marks the station: up to MAX_ASSESSMENT_ATTEMPTS assessor calls, server-side scoring, storing
 * the report, the completion transition and XP. Safe to call twice: only the first run that finds
 * the assessment pending does the work.
 */
export async function runAssessment(userId: string, id: string, llm: ExaminerLlm = examinerLlm()) {
  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status !== "assessing") return;
  const { data: claimed } = await db
    .from("assessments")
    .update({ status: "pending", attempts: 1 })
    .eq("consultation_id", id)
    .eq("status", "pending")
    .eq("attempts", 0)
    .select("id")
    .maybeSingle();
  if (!claimed) return; // another run has it

  const { input, rubric } = await examinerInput(db, station);
  const text = input.transcripts.qa.map((q, i) => `Examiner Q${i + 1}: ${q.question}\nStudent: ${q.answer ?? "(no answer)"}`).join("\n\n");
  await db
    .from("transcripts")
    .upsert(
      { consultation_id: id, kind: "examiner_qa", text, word_count: text.split(/\s+/).filter(Boolean).length, compiled_at: new Date().toISOString() },
      { onConflict: "consultation_id,kind" },
    );

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ASSESSMENT_ATTEMPTS; attempt++) {
    if (attempt > 1) await db.from("assessments").update({ attempts: attempt }).eq("id", claimed.id);
    try {
      const { output, call } = await llm.assess(input, AbortSignal.timeout(240_000));
      await logCall(db, userId, id, "examiner_assess", call);
      const scored = scoreAssessment(rubric, output.items, station.disclosed_fact_ids);

      await db.from("assessment_item_scores").delete().eq("assessment_id", claimed.id);
      await db.from("assessment_domain_scores").delete().eq("assessment_id", claimed.id);
      const [items, domains] = await Promise.all([
        db.from("assessment_item_scores").insert(
          scored.items.map((i) => ({
            assessment_id: claimed.id,
            rubric_item_id: rubric.ids.get(i.key)!,
            outcome: i.outcome,
            points: i.points,
            evidence_quote: i.evidence || null,
          })),
        ),
        db.from("assessment_domain_scores").insert(scored.domains.map((d) => ({ assessment_id: claimed.id, domain: d.domain, score: d.score, max: d.max }))),
      ]);
      if (items.error) throw items.error;
      if (domains.error) throw domains.error;

      const { error } = await db
        .from("assessments")
        .update({
          status: "complete",
          overall_score: scored.overallPct,
          global_rating: output.global_rating,
          passed: scored.passed,
          strengths: output.strengths,
          improvements: output.improvements,
          missed_questions: output.missed_questions,
          missed_red_flags: output.missed_red_flags,
          revision_topics: output.revision_topics,
          examiner_comment: output.examiner_comment,
          model: call.model,
          prompt_version: EXAMINER_PROMPT_VERSION,
          raw_output: { output, adjustments: scored.items.filter((i) => i.adjustment).map((i) => ({ key: i.key, why: i.adjustment })) },
          completed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", claimed.id);
      if (error) throw error;

      // The guarded transition runs once, so progress counters and XP can't be applied twice.
      const done = await transition(db, id, "assessing", "completed").catch((e) => (e instanceof StationError ? null : Promise.reject(e)));
      if (done) await rewardCompletion(db, userId, id, input.content.meta.difficulty, scored.overallPct);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await logCall(db, userId, id, "examiner_assess", failure(err, MODELS.assessor));
      console.warn("assessment attempt failed", { consultation: id, attempt, error: lastError });
    }
  }

  await db.from("assessments").update({ status: "failed", error: lastError.slice(0, 500) }).eq("id", claimed.id);
  await transition(db, id, "assessing", "assessment_failed").catch(() => {});
}

/** Completion and performance XP. Streaks, first-of-day, goals and badges arrive with M5. */
async function rewardCompletion(db: Db, userId: string, id: string, difficulty: number, overallPct: number) {
  const d = Math.min(5, Math.max(1, difficulty)) as 1 | 2 | 3 | 4 | 5;
  const lines = stationXp({ difficulty: d, overallPct, previousBestPct: null, isFirstStationToday: false, streak: 0 });
  for (const line of lines) {
    const { error } = await db.rpc("grant_xp", {
      p_user: userId,
      p_source: line.source,
      p_amount: line.amount,
      p_key: `${id}:${line.source}`,
      p_consultation: id,
      p_meta: { overall_pct: overallPct },
    });
    if (error) console.error("grant_xp failed", { code: error.code, source: line.source });
  }
  const { data: progress } = await db.from("user_progress").select("total_consultations").eq("user_id", userId).single();
  await db.from("user_progress").update({ total_consultations: (progress?.total_consultations ?? 0) + 1 }).eq("user_id", userId);
}
