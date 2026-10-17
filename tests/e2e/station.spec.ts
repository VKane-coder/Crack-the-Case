import { expect, test } from "@playwright/test";
import { admin, createOnboardedUser, deleteTestUsers } from "./helpers";

// Per test, not per file: the user list in helpers.ts is shared by every spec in the worker.
test.afterEach(deleteTestUsers);

test("hub → reading time → history with the patient → end", async ({ page }) => {
  const user = await createOnboardedUser();
  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await expect(page).toHaveURL(/\/hub$/);

  await page.getByRole("button", { name: "Start case" }).click();
  await expect(page).toHaveURL(/\/station\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Your candidate brief" })).toBeVisible();
  await expect(page.getByText("Margaret Kelly, 64")).toBeVisible();
  await expect(page.getByRole("timer", { name: /Reading/ })).toBeVisible();

  await page.getByRole("button", { name: /I'm ready/ }).click();
  const log = page.getByRole("log", { name: "Consultation" });
  await expect(log).toContainText("it's probably nothing really");
  await expect(page.getByRole("timer", { name: /History/ })).toBeVisible();

  await page.getByLabel("Your question to the patient").fill("How many months has it been?");
  await page.keyboard.press("Enter");
  await expect(log).toContainText("It's been about three months now");
  // "listening" returns only after the stream ends, i.e. once the server has stored the turn.
  await expect(page.getByText("listening")).toBeVisible();

  // Server state: the reply, the disclosed fact and the AI call were recorded.
  const db = admin();
  const { data: station } = await db.from("consultations").select("status, disclosed_fact_ids").eq("id", id).single();
  expect(station).toEqual({ status: "history", disclosed_fact_ids: ["duration_3_months"] });
  const { count: calls } = await db.from("ai_calls").select("*", { count: "exact", head: true }).eq("consultation_id", id);
  expect(calls).toBe(1);

  // Resending the same turn (e.g. after a dropped connection) replays the stored reply.
  const replay = await page.request.post(`/api/consultations/${id}/patient-turn`, {
    data: { utterance: "How many months has it been?", clientSeq: 0 },
  });
  expect(await replay.text()).toContain("three months");
  const { count: messages } = await db.from("messages").select("*", { count: "exact", head: true }).eq("consultation_id", id);
  expect(messages).toBe(3);

  await page.getByRole("button", { name: "End history and move on" }).click();
  await expect(page.getByText("History complete")).toBeVisible();
  const { data: transcript } = await db.from("transcripts").select("text").eq("consultation_id", id).eq("kind", "history").single();
  expect(transcript!.text).toContain("Student: How many months has it been?");

  // The patient stops taking questions once the phase is over.
  const late = await page.request.post(`/api/consultations/${id}/patient-turn`, { data: { utterance: "One more thing?", clientSeq: 1 } });
  expect(await late.text()).toContain('"code":"wrong_phase"');

  // Starting another case abandons this one (one live station per student).
  await page.goto("/hub");
  await page.getByRole("button", { name: "Start case" }).click();
  await expect(page).toHaveURL(/\/station\//);
  const { data: old } = await db.from("consultations").select("status").eq("id", id).single();
  expect(old!.status).toBe("abandoned");
});

test("station API refuses signed-out and cross-site requests", async ({ request }) => {
  const anon = await request.post("/api/consultations", { data: { caseSlug: "gp-change-in-bowel-habit" } });
  expect(anon.status()).toBe(401);
  const form = await request.post("/api/consultations", { form: { caseSlug: "gp-change-in-bowel-habit" } });
  expect(form.status()).toBe(415);
});
