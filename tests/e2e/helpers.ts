import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const created: string[] = [];

/** Creates a confirmed user and returns sign-in credentials without sending any email. */
export async function createTestUser() {
  const email = `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@crackthecase.test`;
  const supabase = admin();
  const { data: user, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  created.push(user.user.id);
  // The seed cases are test fixtures that only members of the e2e-fixtures organization can see.
  const { data: org } = await supabase.from("organizations").select("id").eq("slug", "e2e-fixtures").single();
  const { error: orgError } = await supabase.from("profiles").update({ organization_id: org!.id }).eq("id", user.user.id);
  if (orgError) throw orgError;
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  return { id: user.user.id, email, tokenHash: link.properties.hashed_token, otp: link.properties.email_otp };
}

export async function deleteTestUsers() {
  // E2E_KEEP_USERS=1 leaves test users (and their stations) in place for debugging a failure.
  if (process.env.E2E_KEEP_USERS) return void created.splice(0);
  const supabase = admin();
  await Promise.all(created.splice(0).map((id) => supabase.auth.admin.deleteUser(id)));
}

/** A confirmed user who has already finished onboarding (written with the service role). */
export async function createOnboardedUser(specialties = ["general-practice"]) {
  const user = await createTestUser();
  const db = admin();
  const { data: avatar } = await db.from("avatars").select("id").eq("slug", "koala-clerk").single();
  const { error } = await db
    .from("profiles")
    .update({
      display_name: "Station Tester",
      avatar_id: avatar!.id,
      exam_type: "school_osce",
      target_specialties: specialties,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) throw error;
  return user;
}

/**
 * Starts a case and waits for its station page, returning the station id. Creating the station and
 * loading its page take about ten Supabase round trips, which from CI (far from the project) can
 * exceed the default 10 s, so this allows 30 s.
 */
export async function startCase(page: Page, button: Locator = page.getByRole("button", { name: "Start case" })) {
  await button.click();
  await expect(page).toHaveURL(/\/station\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}
