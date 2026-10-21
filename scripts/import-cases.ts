/**
 * Imports author-written cases from the Supabase "Patients" table into the app's case tables.
 *
 *   npm run cases:import            dry run: convert every case and print what's ready and what's missing
 *   npm run cases:import -- --apply  also publish the ready cases (new versions only when something changed)
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Cases with gaps are never written;
 * fix them in the Patients table and run it again. Published versions are immutable, so a changed
 * case gets a new version and past results keep the version they were marked against.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { convertAuthorCase, type AuthorRow, type ImportedCase } from "../src/server/cases/author-import";
import { toPatientView } from "../src/server/cases/projector";
import { rubricTemplateSchema } from "../src/server/cases/schema";

const ROOT = path.resolve(__dirname, "..");
const SOURCE_TABLE = "Patients";
const PASS_MARK = 50;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

// Same scheme as scripts/build-seed.ts: ids derived from content, so re-running is idempotent.
function uuid(name: string): string {
  const h = createHash("sha1").update(`crack-the-case:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const sha256 = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const descriptors = rubricTemplateSchema.parse(JSON.parse(readFileSync(path.join(ROOT, "content/rubrics/history-station.json"), "utf8"))).global_rating_descriptors;

async function publish(c: ImportedCase, specialtyIds: Map<string, string>) {
  const content = c.content!;
  const rubricId = uuid(`author-rubric:${c.slug}`);
  const rubric = { domain_weights: {}, global_rating_descriptors: descriptors, examiner_question_bank: [], pass_mark: PASS_MARK, items: c.rubricItems };
  const rubricVersionId = uuid(`author-rubric-version:${c.slug}:${sha256(rubric)}`);

  await must(db.from("rubrics").upsert({ id: rubricId, name: `${c.title} (${c.slug})`, station_type: "history" }), "rubric");
  const existingRv = await must(db.from("rubric_versions").select("id").eq("id", rubricVersionId).maybeSingle(), "rubric version lookup");
  if (!existingRv) {
    const last = await must(db.from("rubric_versions").select("version").eq("rubric_id", rubricId).order("version", { ascending: false }).limit(1).maybeSingle(), "rubric versions");
    await must(
      db.from("rubric_versions").insert({
        id: rubricVersionId,
        rubric_id: rubricId,
        version: (last?.version ?? 0) + 1,
        domain_weights: rubric.domain_weights,
        global_rating_descriptors: rubric.global_rating_descriptors,
        examiner_question_bank: rubric.examiner_question_bank,
        pass_mark: rubric.pass_mark,
      }),
      "rubric version",
    );
    await must(
      db.from("rubric_items").insert(
        c.rubricItems.map((i, n) => ({
          id: uuid(`${rubricVersionId}:${i.key}`),
          rubric_version_id: rubricVersionId,
          key: i.key,
          domain: i.domain,
          label: i.label,
          description: i.description ?? null,
          max_points: i.max_points,
          linked_fact_ids: i.linked_fact_ids,
          is_critical: i.is_critical,
          sort_order: n + 1,
        })),
      ),
      "rubric items",
    );
  }
  await must(db.from("rubrics").update({ current_version_id: rubricVersionId }).eq("id", rubricId), "rubric current version");

  const caseId = uuid(`author-case:${c.slug}`);
  const existingCase = await must(db.from("cases").select("id").eq("slug", c.slug).maybeSingle(), "case lookup");
  const caseRowId = existingCase?.id ?? caseId;
  await must(
    db.from("cases").upsert(
      {
        id: caseRowId,
        slug: c.slug,
        title: c.title,
        specialty_id: specialtyIds.get(c.specialty),
        difficulty: c.difficulty,
        voice_id: c.voiceId,
        avatar_path: c.avatarPath,
      },
      { onConflict: "slug" },
    ),
    "case",
  );

  const contentHash = sha256(content);
  const versionId = uuid(`author-case-version:${c.slug}:${contentHash}:${rubricVersionId}`);
  const existingVersion = await must(db.from("case_versions").select("id").eq("id", versionId).maybeSingle(), "case version lookup");
  let created = false;
  if (!existingVersion) {
    const last = await must(db.from("case_versions").select("version").eq("case_id", caseRowId).order("version", { ascending: false }).limit(1).maybeSingle(), "case versions");
    await must(
      db.from("case_versions").insert({
        id: versionId,
        case_id: caseRowId,
        version: (last?.version ?? 0) + 1,
        content,
        patient_view: toPatientView(content),
        rubric_version_id: rubricVersionId,
        content_hash: contentHash,
        published_at: new Date().toISOString(),
      }),
      "case version",
    );
    created = true;
  }
  await must(db.from("cases").update({ current_version_id: versionId, status: "published" }).eq("id", caseRowId), "publish");
  return created ? "published a new version" : "unchanged (already published)";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const specialties = await must(db.from("specialties").select("id, slug"), "specialties");
  const specialtyIds = new Map((specialties ?? []).map((s) => [s.slug as string, s.id as string]));
  const rows = (await must(db.from(SOURCE_TABLE).select("*").order("id"), `read ${SOURCE_TABLE}`)) as AuthorRow[];

  let ready = 0;
  for (const row of rows) {
    const c = convertAuthorCase(row, new Set(specialtyIds.keys()));
    const ok = c.content !== null;
    if (ok) ready++;
    console.log(`\n${ok ? "✓ READY" : "✗ NEEDS WORK"}  ${c.title}  (row ${row.id} → ${c.slug})`);
    for (const g of c.gaps) console.log(`   ✗ ${g}`);
    for (const a of c.assumptions) console.log(`   · ${a}`);
    if (ok) {
      const marks = c.rubricItems.reduce((n, i) => n + i.max_points, 0);
      console.log(`   = ${c.content!.patient.facts.length} patient facts, ${c.rubricItems.length} marked sections (${marks} marks), ${c.content!.examiner_items.length} examiner questions`);
      if (apply) console.log(`   → ${await publish(c, specialtyIds)}`);
    }
  }
  console.log(`\n${ready} of ${rows.length} cases ready.${apply ? "" : " Dry run: nothing written. Add --apply to publish the ready ones."}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
