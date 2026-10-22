import { expect, test, type Page } from "@playwright/test";
import { admin, createOnboardedUser, deleteTestUsers, startCase } from "./helpers";

// Per test, not per file: the user list in helpers.ts is shared by every spec in the worker.
test.afterEach(deleteTestUsers);

const GP_CASE = "Something's not right down there"; // gp-change-in-bowel-habit, difficulty 2
const HEADACHE_CASE = "Worst headache of my life"; // ed-thunderclap-headache, emergency, difficulty 4

const card = (page: Page, title: string) => page.getByRole("article", { name: title });

/** A finished, marked station on a seed case, written with the service role. */
async function completeStation(userId: string, slug: string, score: number) {
  const db = admin();
  const { data: c } = await db.from("cases").select("current_version_id").eq("slug", slug).single();
  const { data: version } = await db.from("case_versions").select("rubric_version_id").eq("id", c!.current_version_id).single();
  const { data: station, error } = await db
    .from("consultations")
    .insert({ user_id: userId, case_version_id: c!.current_version_id, status: "completed", completed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  const { error: aError } = await db.from("assessments").insert({
    consultation_id: station.id,
    user_id: userId,
    rubric_version_id: version!.rubric_version_id,
    status: "complete",
    overall_score: score,
  });
  if (aError) throw aError;
}

test("browse, filter and search the case library, then start a case from it", async ({ page }) => {
  const user = await createOnboardedUser();
  await completeStation(user.id, "gp-change-in-bowel-habit", 82);

  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await expect(page).toHaveURL(/\/hub$/);
  await page.getByRole("link", { name: "Browse all cases" }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByRole("heading", { name: "Case library" })).toBeVisible();

  // Every published case is listed, with the student's progress on each.
  await expect(card(page, GP_CASE)).toBeVisible();
  await expect(card(page, HEADACHE_CASE)).toBeVisible();
  await expect(card(page, GP_CASE).getByText("Done · best 82%")).toBeVisible();
  await expect(card(page, GP_CASE).getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(card(page, HEADACHE_CASE).getByText("New", { exact: true })).toBeVisible();

  // Filters live in the URL and narrow the list.
  await page.getByLabel("Specialty").selectOption("emergency");
  await expect(page).toHaveURL(/specialty=emergency/);
  await expect(card(page, GP_CASE)).toBeHidden();
  await expect(card(page, HEADACHE_CASE)).toBeVisible();

  await page.getByLabel("Difficulty").selectOption("4");
  await expect(page).toHaveURL(/specialty=emergency&difficulty=4/);
  await expect(page.getByRole("article")).toHaveCount(1);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(card(page, GP_CASE)).toBeVisible();

  // Search matches partly typed words.
  await page.getByLabel("Search cases").fill("headach");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=headach/);
  await expect(card(page, HEADACHE_CASE)).toBeVisible();
  await expect(card(page, GP_CASE)).toBeHidden();

  await page.getByLabel("Search cases").fill("zzzznothing");
  await page.keyboard.press("Enter");
  await expect(page.getByText("No cases match those filters.")).toBeVisible();

  // The filters survive a reload, and a case starts straight from its card.
  await page.goto("/cases?specialty=general-practice&difficulty=2");
  await expect(page.getByLabel("Specialty")).toHaveValue("general-practice");
  await startCase(page, card(page, GP_CASE).getByRole("button", { name: "Try again" }));
});

test("GET /api/cases filters for signed-in students and refuses everyone else", async ({ page, request }) => {
  const anon = await request.get("/api/cases");
  expect(anon.status()).toBe(401);

  const user = await createOnboardedUser();
  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await expect(page).toHaveURL(/\/hub$/);

  const res = await page.request.get("/api/cases?specialty=emergency&length=standard&page=1&difficulty=nonsense");
  expect(res.status()).toBe(200);
  const { data } = await res.json();
  expect(data.cases.length).toBeGreaterThan(0);
  for (const c of data.cases) {
    expect(c.specialty_slug).toBe("emergency");
    expect(c.station_seconds).toBeGreaterThanOrEqual(480);
    expect(c.station_seconds).toBeLessThan(540);
    // Students only ever get the catalogue view: no diagnosis or case content.
    expect(Object.keys(c).sort()).toEqual(
      ["candidate_brief", "difficulty", "id", "persona", "progress", "slug", "specialty_name", "specialty_slug", "station_seconds", "title"].sort(),
    );
  }
  expect(data.specialties.map((s: { slug: string }) => s.slug)).toContain("general-practice");
});
