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
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  return { id: user.user.id, email, tokenHash: link.properties.hashed_token, otp: link.properties.email_otp };
}

export async function deleteTestUsers() {
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
