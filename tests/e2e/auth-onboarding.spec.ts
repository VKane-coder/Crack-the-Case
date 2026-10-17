import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUsers } from "./helpers";

// Per test, not per file: the user list in helpers.ts is shared by every spec in the worker.
test.afterEach(deleteTestUsers);

test("signed-out visitors are sent to login with a safe next", async ({ page }) => {
  await page.goto("/hub");
  await expect(page).toHaveURL(/\/login\?next=%2Fhub$/);
  await expect(page.getByRole("heading", { name: "Ready to crack some cases?" })).toBeVisible();
});

test("magic link → onboarding → hub → sign out", async ({ page }) => {
  const user = await createTestUser();

  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await expect(page).toHaveURL(/\/onboarding$/);

  // 1. Avatar + name
  await page.getByLabel("What should we call you?").fill("Test Student");
  await page.getByRole("radio", { name: "Kookaburra" }).click();
  await expect(page.getByRole("radio", { name: /Roo Registrar \(locked/ })).toBeDisabled();
  await page.getByRole("button", { name: "Continue" }).click();

  // 2. Goals
  await page.getByRole("radio", { name: /Serious/ }).click();
  await expect(page.getByText("15", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. Exam
  await page.getByRole("radio", { name: /AMC Clinical Exam/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. Specialties
  const finish = page.getByRole("button", { name: "Finish setup" });
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "General Practice" }).click();
  await page.getByRole("button", { name: "Emergency" }).click();
  await finish.click();

  await expect(page.getByRole("heading", { name: "You're all set, Test Student!" })).toBeVisible();
  await expect(page.getByText("+50 XP")).toBeVisible();
  await page.getByRole("button", { name: "Take me to my hub" }).click();

  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByRole("heading", { name: /G'day, Test Student!/ })).toBeVisible();
  await expect(page.getByText("50 / 100 XP")).toBeVisible();
  await expect(page.getByText("Something's not right down there")).toBeVisible(); // easiest GP/ED case
  await expect(page.getByText("0 of 3 cases done")).toBeVisible();

  // Database reflects onboarding, written under the student's own RLS-limited session
  const db = admin();
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
  expect(profile).toMatchObject({
    display_name: "Test Student",
    daily_goal_cases: 3,
    weekly_goal_cases: 15,
    exam_type: "amc_clinical",
    role: "student",
  });
  expect(profile!.target_specialties.sort()).toEqual(["emergency", "general-practice"]);
  expect(profile!.onboarding_completed_at).not.toBeNull();

  // Revisiting onboarding doesn't repeat it or award XP twice
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/hub$/);
  const { count } = await db.from("xp_events").select("*", { count: "exact", head: true }).eq("user_id", user.id);
  expect(count).toBe(1);

  // Signed-in users skip login, and an off-site next is ignored
  await page.goto("/login?next=//evil.example");
  await expect(page).toHaveURL(/\/hub$/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/hub");
  await expect(page).toHaveURL(/\/login/);
});

test("6-digit code sign-in", async ({ page }) => {
  const user = await createTestUser();
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "I already have a code" }).click();
  await page.getByLabel("6-digit code").fill(user.otp);
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("a wrong code shows a friendly error", async ({ page }) => {
  const user = await createTestUser();
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "I already have a code" }).click();
  await page.getByLabel("6-digit code").fill(user.otp === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("That code didn't work");
});

test("expired links land on login with a supportive message", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=email&next=/hub");
  await expect(page).toHaveURL(/\/login\?error=link_expired/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("gone a bit stale");
});

test("Google sign-in starts an OAuth redirect", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED !== "true", "Google provider not enabled");
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/accounts\.google\.com|\/auth\/v1\/authorize/);
});
