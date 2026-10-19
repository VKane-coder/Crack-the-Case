import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { PATIENT_PROMPT_VERSION, type ChatTurn, type Emotion, type PatientEvent } from "@/server/agents/patient";
import { costUsd } from "@/server/agents/shared/models";
import { leakTerms, type PatientView } from "@/server/cases/projector";
import { DEFAULT_STATION, type CaseContent } from "@/server/cases/schema";
import { sttUsdPerMinute, ttsAvailable, ttsUsdPer1kChars, voiceFake } from "@/server/voice/config";
import { elevenLabsSynthesize, fakeSynthesize, resolveVoiceId } from "@/server/voice/elevenlabs";
import { TtsPipeline, type AudioEvent, type Synthesize } from "@/server/voice/tts-pipeline";
import { patientLlm } from "./llm";
import { runPatientTurn } from "./patient-turn";

// The server owns the station (docs/architecture.md §1, §2.3). Every state change is a guarded
// transition_consultation() call, and every write uses the service role: students can read their
// own station rows but never write them.

export const GRACE_SECONDS = 5;
export const MAX_UTTERANCE_CHARS = 500;
export const MAX_TURNS_PER_PHASE = 60;

const LIVE = ["created", "briefing", "history", "history_ended", "presentation", "examiner_questions"] as const;

export type ConsultationStatus =
  | (typeof LIVE)[number]
  | "assessing"
  | "completed"
  | "assessment_failed"
  | "abandoned";

export class StationError extends Error {
  constructor(
    readonly code: "not_found" | "wrong_phase" | "phase_over" | "turn_in_progress" | "invalid_input" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export type Consultation = {
  id: string;
  user_id: string;
  case_version_id: string;
  status: ConsultationStatus;
  /** history_/presentation_seconds: stations created before the single station clock. */
  station_config: { reading_seconds?: number; station_seconds?: number; history_seconds?: number; presentation_seconds?: number };
  history_started_at: string | null;
  phase_deadline_at: string | null;
  station_deadline_at: string | null;
  disclosed_fact_ids: string[];
};

/** Station clock length; mirrors public.station_seconds() in the database. */
export function stationSeconds(config: Consultation["station_config"]) {
  return config.station_seconds ?? (config.history_seconds ?? 300) + (config.presentation_seconds ?? 180);
}

/** True once the station clock (plus a little grace for in-flight requests) has run out. */
export function clockExpired(station: Pick<Consultation, "station_deadline_at" | "phase_deadline_at">, now = Date.now()) {
  const deadline = station.station_deadline_at ?? station.phase_deadline_at;
  return deadline !== null && now > Date.parse(deadline) + GRACE_SECONDS * 1000;
}

export type Db = SupabaseClient;

export async function loadOwned(db: Db, userId: string, id: string): Promise<Consultation> {
  const { data, error } = await db
    .from("consultations")
    .select("id, user_id, case_version_id, status, station_config, history_started_at, phase_deadline_at, station_deadline_at, disclosed_fact_ids")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new StationError("not_found", "Station not found.");
  return data as Consultation;
}

export async function transition(db: Db, id: string, from: ConsultationStatus, to: ConsultationStatus): Promise<Consultation> {
  const { data, error } = await db.rpc("transition_consultation", { p_id: id, p_from: from, p_to: to });
  if (error) {
    // 55000: the row had already moved on (a concurrent request won the race).
    if (error.code === "55000") throw new StationError("wrong_phase", `Station is no longer in ${from}.`);
    throw error;
  }
  return data as Consultation;
}

export async function caseVersion(db: Db, caseVersionId: string) {
  const { data, error } = await db
    .from("case_versions")
    .select("content, patient_view, rubric_version_id, cases!case_versions_case_id_fkey(voice_id, avatar_path)")
    .eq("id", caseVersionId)
    .single();
  if (error) throw error;
  const extras = data.cases as unknown as { voice_id: string | null; avatar_path: string | null } | null;
  return {
    content: data.content as CaseContent,
    patientView: data.patient_view as PatientView,
    rubricVersionId: data.rubric_version_id as string,
    /** The case's own ElevenLabs voice, when the author set one. */
    voiceId: extras?.voice_id ?? null,
    avatarPath: extras?.avatar_path ?? null,
  };
}

// Images ---------------------------------------------------------------------------------------

const MEDIA_BUCKET = "case-media";
const MEDIA_URL_SECONDS = 15 * 60;

/** A short-lived link to a private case image, or null if it's missing (the station carries on without it). */
export async function signedMediaUrl(db: Db, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, MEDIA_URL_SECONDS);
  if (error) console.warn("case image unavailable", { path, message: error.message });
  return data?.signedUrl ?? null;
}

/** avatar_path is "<bucket>/<path>": a public bucket gives a plain URL, a private one a signed link. */
export async function avatarUrl(db: Db, avatarPath: string | null): Promise<string | null> {
  if (!avatarPath) return null;
  const slash = avatarPath.indexOf("/");
  if (slash < 1) return null;
  const bucket = avatarPath.slice(0, slash);
  const path = avatarPath.slice(slash + 1);
  const signed = await db.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (signed.data?.signedUrl) return signed.data.signedUrl;
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Abandons any live station, then creates a new one for the case's current published version. */
export async function startConsultation(userId: string, caseSlug: string): Promise<string> {
  const db = createAdminClient();
  const { data: c, error } = await db
    .from("cases")
    .select("id, organization_id, status, current_version_id, case_versions!cases_current_version_fk(content, published_at)")
    .eq("slug", caseSlug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  const version = c?.case_versions as unknown as { content: CaseContent; published_at: string | null } | null;
  if (!c?.current_version_id || !version?.published_at) throw new StationError("not_found", "That case isn't available.");

  const { data: profile } = await db.from("profiles").select("organization_id").eq("id", userId).single();
  if (c.organization_id && c.organization_id !== profile?.organization_id) throw new StationError("not_found", "That case isn't available.");

  const { data: live } = await db.from("consultations").select("id, status").eq("user_id", userId).in("status", LIVE);
  for (const s of live ?? []) {
    await transition(db, s.id, s.status, "abandoned").catch((e) => {
      if (!(e instanceof StationError)) throw e;
    });
  }

  const station = { ...DEFAULT_STATION, ...version.content.meta.station };
  const { data: created, error: insertError } = await db
    .from("consultations")
    .insert({
      user_id: userId,
      organization_id: profile?.organization_id ?? null,
      case_version_id: c.current_version_id,
      station_config: { reading_seconds: station.reading_seconds, station_seconds: station.station_seconds },
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  await transition(db, created.id, "created", "briefing");
  return created.id;
}

/** Throws unless the station is in a phase where the student speaks (voice tokens are only for those). */
export async function requireSpeakingPhase(userId: string, id: string) {
  const station = await loadOwned(createAdminClient(), userId, id);
  if (!["history", "presentation", "examiner_questions"].includes(station.status)) {
    throw new StationError("wrong_phase", "The station isn't listening right now.");
  }
}

/** Reading time is over: the clock starts and the patient says their opening line. */
export async function beginHistory(userId: string, id: string) {
  const db = createAdminClient();
  const current = await loadOwned(db, userId, id);
  if (current.status === "history") return { deadline: current.phase_deadline_at, opening: null };
  const moved = await transition(db, id, "briefing", "history");
  const { patientView } = await caseVersion(db, moved.case_version_id);
  await insertMessage(db, id, { role: "patient", content: patientView.opening_statement, emotion: "neutral" });
  return { deadline: moved.phase_deadline_at, opening: patientView.opening_statement };
}

/** Ends the history phase (student pressed End, or time ran out) and compiles its transcript. Idempotent. */
export async function endHistory(userId: string, id: string) {
  const db = createAdminClient();
  const current = await loadOwned(db, userId, id);
  if (current.status === "history") {
    await transition(db, id, "history", "history_ended").catch((e) => {
      if (!(e instanceof StationError)) throw e;
    });
  } else if (current.status !== "history_ended") {
    throw new StationError("wrong_phase", "The history phase isn't running.");
  }
  await compileTranscript(db, id);
  return { status: "history_ended" as const };
}

async function compileTranscript(db: Db, id: string) {
  const messages = await historyMessages(db, id);
  const text = messages.map((m) => `${m.role === "student" ? "Student" : "Patient"}: ${m.content}`).join("\n");
  const { error } = await db
    .from("transcripts")
    .upsert(
      { consultation_id: id, kind: "history", text, word_count: text.split(/\s+/).filter(Boolean).length, compiled_at: new Date().toISOString() },
      { onConflict: "consultation_id,kind" },
    );
  if (error) throw error;
}

export type Phase = "history" | "presentation" | "examiner_qa";
type Row = { seq: number; role: "student" | "patient"; content: string; emotion: string | null; client_seq: number | null };

export async function phaseMessages(db: Db, id: string, phase: Phase): Promise<Row[]> {
  const { data, error } = await db
    .from("messages")
    .select("seq, role, content, emotion, client_seq")
    .eq("consultation_id", id)
    .eq("phase", phase)
    .order("seq");
  if (error) throw error;
  return data as Row[];
}

const historyMessages = (db: Db, id: string) => phaseMessages(db, id, "history");

export async function insertMessage(
  db: Db,
  id: string,
  m: { role: "student" | "patient"; content: string; emotion?: string; clientSeq?: number; phase?: Phase },
): Promise<number> {
  // seq is unique per consultation; on a collision with a concurrent insert, take the next one.
  for (let tries = 0; tries < 5; tries++) {
    const { data: last } = await db.from("messages").select("seq").eq("consultation_id", id).order("seq", { ascending: false }).limit(1).maybeSingle();
    const seq = (last?.seq ?? -1) + 1;
    const { error } = await db.from("messages").insert({
      consultation_id: id,
      seq,
      phase: m.phase ?? "history",
      role: m.role,
      content: m.content,
      emotion: m.emotion ?? null,
      client_seq: m.clientSeq ?? null,
    });
    if (!error) return seq;
    if (error.code !== "23505") throw error;
    if (error.message.includes("messages_student_idempotency")) throw new StationError("turn_in_progress", "That message was already sent.");
  }
  throw new StationError("turn_in_progress", "Too many concurrent messages.");
}

/** Everything the station page needs, read with the student's own RLS-limited session where possible. */
export async function loadStation(userId: string, id: string, userDb: Db) {
  const { data: station, error } = await userDb
    .from("consultations")
    .select("id, status, case_version_id, station_config, started_at, history_started_at, history_ended_at, phase_deadline_at, station_deadline_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!station) return null;
  const [{ data: messages }, { data: presentation }, { data: questions }] = await Promise.all([
    userDb.from("messages").select("seq, role, content, emotion, client_seq").eq("consultation_id", id).eq("phase", "history").order("seq"),
    userDb.from("messages").select("content").eq("consultation_id", id).eq("phase", "presentation").order("seq"),
    // Students can read the question and their answer, never the examiner's rationale.
    userDb.from("examiner_questions").select("ord, question, answered_at").eq("consultation_id", id).order("ord"),
  ]);
  // Students can't read case_versions (it holds the diagnosis); pick out only pre-station fields.
  const admin = createAdminClient();
  const { content, patientView, avatarPath } = await caseVersion(admin, station.case_version_id);
  const config = station.station_config as Consultation["station_config"];
  const reading = content.reading ?? { tasks: [], media: [] };
  const [readingMedia, avatar] = await Promise.all([
    Promise.all(reading.media.map(async (m) => ({ url: await signedMediaUrl(admin, m.path), alt: m.alt, caption: m.caption ?? null }))),
    avatarUrl(admin, avatarPath),
  ]);
  // The image for the question being asked now, if any (a reload mid-question still shows it).
  const current = (questions ?? []).find((q) => q.answered_at === null);
  let currentMedia: { ord: number; url: string; alt: string; caption: string | null } | null = null;
  if (current && station.status === "examiner_questions") {
    const { data: row } = await admin
      .from("examiner_questions")
      .select("media_path, item_key")
      .eq("consultation_id", id)
      .eq("ord", current.ord)
      .maybeSingle();
    const url = row?.media_path ? await signedMediaUrl(admin, row.media_path) : null;
    const item = content.examiner_items?.find((i) => i.key === row?.item_key);
    if (url) currentMedia = { ord: current.ord, url, alt: item?.media?.alt ?? "Image for this question", caption: item?.media?.caption ?? null };
  }
  const media = currentMedia as { ord: number; url: string; alt: string; caption: string | null } | null;
  const startedAt = station.started_at as string | null;
  const readingSeconds = config.reading_seconds ?? DEFAULT_STATION.reading_seconds;
  return {
    id: station.id as string,
    status: station.status as ConsultationStatus,
    /** The station clock: set when the patient stage starts, unchanged through the examiner stages. */
    deadline: (station.station_deadline_at ?? station.phase_deadline_at) as string | null,
    /** When reading time ends (counted from when the station was opened). */
    readingEndsAt: startedAt ? new Date(Date.parse(startedAt) + readingSeconds * 1000).toISOString() : null,
    readingSeconds,
    stationSeconds: stationSeconds(config),
    historyStartedAt: station.history_started_at as string | null,
    historyEndedAt: station.history_ended_at as string | null,
    title: content.meta.title,
    brief: content.candidate_brief,
    task: content.assessment_task,
    tasks: reading.tasks,
    readingMedia: readingMedia.filter((m) => m.url) as { url: string; alt: string; caption: string | null }[],
    patient: { name: patientView.name, age: patientView.age, avatarUrl: avatar },
    messages: (messages ?? []) as Row[],
    presentation: (presentation ?? []).map((m) => m.content as string),
    questions: (questions ?? []).map((q) => ({
      ord: q.ord as number,
      text: q.question as string,
      answered: q.answered_at !== null,
      media: media && media.ord === q.ord ? { url: media.url, alt: media.alt, caption: media.caption } : null,
    })),
  };
}

export type StationData = NonNullable<Awaited<ReturnType<typeof loadStation>>>;

/** Milliseconds from the start of the turn's server work, sent once with the first audio (for latency tuning). */
export type TurnTiming = { type: "timing"; readyMs: number; firstTextMs: number | null; firstAudioMs: number; region: string | null };

/** "done" means the turn is saved and the next one may start; audio and logging can still follow. */
export type TurnEvent = PatientEvent | AudioEvent | TurnTiming | { type: "voice_error"; code: string } | { type: "done" };

/** Longest speech-to-text duration we'll log for one utterance (the value is client-reported). */
const MAX_STT_SECONDS = 120;

/**
 * Handles one student utterance: validates phase and clock, stores it, streams the patient's reply
 * through `emit`, then stores the reply, the facts it disclosed and the AI cost. Replaying the same
 * clientSeq returns the stored reply instead of generating a new one.
 */
export async function patientTurn(
  userId: string,
  id: string,
  input: { utterance: string; clientSeq: number; voice?: boolean; sttSeconds?: number },
  emit: (e: TurnEvent) => void,
  signal: AbortSignal,
) {
  const startedAt = Date.now();
  const utterance = input.utterance.trim();
  if (!utterance || utterance.length > MAX_UTTERANCE_CHARS || !Number.isInteger(input.clientSeq) || input.clientSeq < 0) {
    throw new StationError("invalid_input", `Say something between 1 and ${MAX_UTTERANCE_CHARS} characters.`);
  }

  const db = createAdminClient();
  const station = await loadOwned(db, userId, id);
  if (station.status !== "history") throw new StationError("wrong_phase", "The patient isn't taking questions right now.");
  const now = Date.now();
  // Out of time: the browser then finishes the station, which goes straight to marking.
  if (clockExpired(station, now)) throw new StationError("phase_over", "Time's up.");

  // Independent reads in parallel: every round trip here delays the patient's first word.
  const [before, { content, patientView, voiceId: caseVoiceId }] = await Promise.all([
    historyMessages(db, id),
    caseVersion(db, station.case_version_id),
  ]);
  const readyMs = Date.now() - startedAt;
  const replayIdx = before.findIndex((m) => m.role === "student" && m.client_seq === input.clientSeq);
  if (replayIdx >= 0) {
    const reply = before.slice(replayIdx + 1).find((m) => m.role === "patient");
    if (!reply) throw new StationError("turn_in_progress", "The patient is still answering that.");
    emit({ type: "emotion", emotion: (reply.emotion ?? "neutral") as never });
    emit({ type: "sentence", text: reply.content });
    emit({ type: "done" });
    return { replayed: true };
  }
  if (before.filter((m) => m.role === "student").length >= MAX_TURNS_PER_PHASE) {
    throw new StationError("invalid_input", "That's a lot of questions! Time to wrap up the history.");
  }

  // Saved while the patient starts answering; awaited before the reply is stored, which keeps seq order.
  const studentSaved = insertMessage(db, id, { role: "student", content: utterance, clientSeq: input.clientSeq });
  studentSaved.catch(() => {}); // handled where it's awaited below
  // Everything after the opening statement (seq 0), oldest first, ending with this utterance.
  const history: ChatTurn[] = [
    ...before.slice(1).map((m) => ({ role: m.role, content: m.content })),
    { role: "student" as const, content: utterance },
  ];
  const limit = stationSeconds(station.station_config);
  const elapsed = station.history_started_at ? (now - Date.parse(station.history_started_at)) / 1000 : 0;

  // Voice out: each sentence that passes the guardrail is synthesised while the next is generated.
  // The voice lookup (first turn on a fresh server only) runs alongside generation, not before it.
  const voiceId =
    input.voice && ttsAvailable() && !voiceFake()
      ? caseVoiceId
        ? Promise.resolve(caseVoiceId)
        : resolveVoiceId(content.patient.voice_profile)
      : null;
  voiceId?.catch(() => {}); // a failed lookup surfaces through the first sentence's synthesis
  const synthesize: Synthesize | null = voiceFake()
    ? input.voice ? fakeSynthesize() : null
    : voiceId &&
      (async (text, opts, sig) => {
        const id = await voiceId;
        if (!id) throw Object.assign(new Error("no ElevenLabs voice available"), { voiceCode: "elevenlabs_no_voice" });
        return elevenLabsSynthesize(id)(text, opts, sig);
      });
  let firstTextMs: number | null = null;
  let timed = false;
  // Timing goes out just before the first audio: the browser starts playing as soon as audio arrives.
  const emitAudio = (e: AudioEvent) => {
    if (!timed) {
      timed = true;
      emit({ type: "timing", readyMs, firstTextMs, firstAudioMs: Date.now() - startedAt, region: process.env.VERCEL_REGION ?? null });
    }
    emit(e);
  };
  const tts = synthesize ? new TtsPipeline(synthesize, emitAudio, (code) => emit({ type: "voice_error", code })) : null;
  let emotion: Emotion = "neutral";
  const turnEmit = (e: PatientEvent) => {
    if (e.type === "sentence" && firstTextMs === null) firstTextMs = Date.now() - startedAt;
    emit(e);
    if (e.type === "emotion") emotion = e.emotion;
    else if (e.type === "sentence") tts?.push(e.text, emotion);
    else if (e.type === "reset") tts?.reset();
  };

  const result = await runPatientTurn({
    view: patientView,
    leakTerms: leakTerms(content),
    history,
    state: { elapsedSeconds: elapsed, limitSeconds: limit, disclosedFactIds: station.disclosed_fact_ids },
    llm: patientLlm(),
    emit: turnEmit,
    signal,
  });

  await studentSaved;
  await insertMessage(db, id, { role: "patient", content: result.text, emotion: result.emotion });

  const disclosed = [...new Set([...station.disclosed_fact_ids, ...result.factIds])];
  if (disclosed.length !== station.disclosed_fact_ids.length) {
    await db.from("consultations").update({ disclosed_fact_ids: disclosed }).eq("id", id);
  }
  // Everything the next turn reads is stored, so the student can talk again while the rest of
  // this turn's audio plays and its cost is logged.
  emit({ type: "done" });

  if (result.calls.length) {
    const { error } = await db.from("ai_calls").insert(
      result.calls.map((c) => ({
        consultation_id: id,
        user_id: userId,
        agent: "patient",
        model: c.model,
        prompt_version: PATIENT_PROMPT_VERSION,
        input_tokens: c.usage.inputTokens,
        output_tokens: c.usage.outputTokens,
        cache_read_tokens: c.usage.cacheReadTokens,
        cache_write_tokens: c.usage.cacheWriteTokens,
        latency_ms: c.latencyMs,
        cost_usd: costUsd(c.model, c.usage),
        status: c.status,
        error: [c.error, result.guardrail && `guardrail:${result.guardrail.reason}`].filter(Boolean).join("; ") || null,
      })),
    );
    if (error) console.error("ai_calls insert failed", { code: error.code });
  }
  if (result.outcome !== "ok") console.warn("patient turn", { consultation: id, outcome: result.outcome, guardrail: result.guardrail?.reason });

  await tts?.finish();
  const usage = [];
  const sttSeconds = Math.min(MAX_STT_SECONDS, Math.max(0, Number(input.sttSeconds) || 0));
  if (sttSeconds > 0 && !voiceFake()) {
    usage.push({ provider: "deepgram", units: sttSeconds, unit: "seconds", cost_usd: round6((sttSeconds / 60) * sttUsdPerMinute()) });
  }
  if (tts && tts.characters > 0 && !voiceFake()) {
    usage.push({ provider: "elevenlabs", units: tts.characters, unit: "characters", cost_usd: round6((tts.characters / 1000) * ttsUsdPer1kChars()) });
  }
  if (usage.length) {
    const { error } = await db.from("voice_usage").insert(usage.map((u) => ({ ...u, consultation_id: id, user_id: userId })));
    if (error) console.error("voice_usage insert failed", { code: error.code });
  }
  return { replayed: false, ttsFailures: tts?.failures ?? 0 };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
