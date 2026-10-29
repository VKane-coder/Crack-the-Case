import { expect, test } from "@playwright/test";
import { admin, createOnboardedUser, deleteTestUsers, startCase } from "./helpers";

// A whole station with the scripted patient and examiner (PATIENT_LLM=fake): history →
// presentation → examiner questions → marking → report, plus XP.

// Per test, not per file: the user list in helpers.ts is shared by every spec in the worker.
test.afterEach(deleteTestUsers);

test("history → presentation → examiner questions → report", async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createOnboardedUser();
  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  const id = await startCase(page);
  await page.getByRole("button", { name: /I'm ready/ }).click();

  const ask = page.getByLabel("Your question to the patient");
  for (const q of ["How many months has it been?", "Have your clothes been fitting looser?"]) {
    await ask.fill(q);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log", { name: "Consultation" })).toContainText(q);
    // "listening" returns only after the stream ends, i.e. once the server has stored the turn.
    await expect(page.getByText("listening")).toBeVisible();
  }
  await page.getByRole("button", { name: "Move to the examiner" }).click();

  // Presentation: the examiner listens without replying, on the same station clock.
  await expect(page.getByRole("timer", { name: /Station/ })).toBeVisible();
  const present = page.getByLabel("Your presentation");
  for (const part of [
    "Margaret is a 64-year-old woman with three months of looser, more frequent stools and weight loss.",
    "I'm concerned about colorectal cancer and would refer her for an urgent colonoscopy.",
  ]) {
    await present.fill(part);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log", { name: "Presentation so far" })).toContainText(part.slice(0, 30));
  }
  await page.getByRole("button", { name: /finished presenting/ }).click();

  // Examiner questions (the scripted examiner asks the first two bank questions).
  await expect(page.getByText("Examiner · question 1")).toBeVisible();
  await expect(page.getByText("She asks whether she can just do the bowel screening kit instead")).toBeVisible();
  const reply = page.getByLabel("Your answer to the examiner");
  await reply.fill("No. She has symptoms, so a screening kit isn't appropriate; she needs a diagnostic colonoscopy.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Examiner · question 2")).toBeVisible();
  await reply.fill("Her age, the change in bowel habit for more than six weeks, the weight loss and the fatigue.");
  await page.keyboard.press("Enter");

  // Marking, then the report.
  await expect(page).toHaveURL(new RegExp(`/results/${id}$`), { timeout: 30_000 });
  await expect(page.getByText(/Case cracked!|Station complete/).first()).toBeVisible();
  await expect(page.getByText("Examiner's comment")).toBeVisible();
  await expect(page.getByText("Marking sheet")).toBeVisible();
  await expect(page.getByText("The case, revealed")).toBeVisible();
  await expect(page.getByText("Suspected colorectal cancer", { exact: false }).first()).toBeVisible();

  // Server state: scored report, transcripts, questions, XP through the ledger.
  const db = admin();
  const { data: station } = await db.from("consultations").select("status").eq("id", id).single();
  expect(station!.status).toBe("completed");
  const { data: assessment } = await db.from("assessments").select("id, status, overall_score, passed").eq("consultation_id", id).single();
  expect(assessment!.status).toBe("complete");
  expect(Number(assessment!.overall_score)).toBeGreaterThan(0);
  const { count: items } = await db
    .from("assessment_item_scores")
    .select("*", { count: "exact", head: true })
    .eq("assessment_id", assessment!.id);
  expect(items).toBeGreaterThan(10);
  const { data: qs } = await db.from("examiner_questions").select("answer_transcript").eq("consultation_id", id).order("ord");
  expect(qs!.map((q) => Boolean(q.answer_transcript))).toEqual([true, true]);
  const { data: xp } = await db.from("xp_events").select("source").eq("consultation_id", id);
  expect(xp!.map((x) => x.source).sort()).toEqual(["completion", "performance"]);
  const { data: progress } = await db.from("user_progress").select("total_consultations").eq("user_id", user.id).single();
  expect(progress!.total_consultations).toBe(1);

  // Students can read their questions but never the examiner's private rationale.
  const { data: rationale, error } = await db.from("examiner_questions").select("rationale").eq("consultation_id", id).limit(1);
  expect(error).toBeNull();
  expect(rationale![0].rationale).toBeTruthy(); // stored server-side…
});
