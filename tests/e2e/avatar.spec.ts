import { expect, test } from "@playwright/test";
import { admin, createOnboardedUser, deleteTestUsers } from "./helpers";

// The animated face is off in e2e runs (VOICE_PROVIDERS=fake), so these cover its station plumbing
// with a stand-in session rather than a real LemonSlice one.

test.afterEach(deleteTestUsers);

const STAND_IN = { avatar: { sessionId: "e2e-not-a-real-session", websocketAddress: "wss://example.invalid/e2e", room: "station-e2e" } };

test("closing the station page ends the patient's face, and only the student's own", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const user = await createOnboardedUser();
  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await page.getByRole("button", { name: "Start case" }).click();
  await expect(page).toHaveURL(/\/station\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split("/").pop()!;
  const db = admin();
  const meta = async () => (await db.from("consultations").select("client_meta").eq("id", id).single()).data!.client_meta;

  // With the face off, asking for it is a quiet "no face" and the station carries on.
  const ask = await page.request.post(`/api/consultations/${id}/avatar`, { data: {} });
  expect(await ask.json()).toEqual({ data: null });

  await db.from("consultations").update({ client_meta: STAND_IN }).eq("id", id);

  // Signed out, or another student: refused, and the face is left alone.
  const anon = await browser.newContext();
  expect((await anon.request.delete(`/api/consultations/${id}/avatar`, { data: {} })).status()).toBe(401);
  await anon.close();
  const other = await createOnboardedUser();
  const otherPage = await browser.newPage();
  await otherPage.goto(`/auth/confirm?token_hash=${other.tokenHash}&type=email&next=/hub`);
  await expect(otherPage).toHaveURL(/\/hub$/);
  expect((await otherPage.request.delete(`/api/consultations/${id}/avatar`, { data: {} })).status()).toBe(404);
  await otherPage.close();
  expect(await meta()).toEqual(STAND_IN);

  // The student's own page closing (the request the page sends on pagehide): the face is ended and forgotten.
  const end = await page.request.delete(`/api/consultations/${id}/avatar`, { data: {} });
  expect(end.status()).toBe(200);
  expect(await meta()).toEqual({});
});
