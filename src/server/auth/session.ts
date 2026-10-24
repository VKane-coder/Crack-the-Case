import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// getUser() verifies the session with Supabase Auth (cookies alone are not trusted).
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

/**
 * The signed-in user's id, checked on this server from the session token's signature (the project's
 * ES256 signing keys) instead of asking Supabase Auth over the network. For the station's API calls,
 * where every round trip delays the patient's reply; pages keep the full getUser() check.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return data.claims.sub;
});

export async function requireUser(next?: string) {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

export type ProfileWithProgress = Awaited<ReturnType<typeof loadProfile>>;

async function loadProfile(userId: string) {
  const supabase = await createClient();
  const [profile, progress] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, display_name, role, exam_type, exam_date, target_specialties, daily_goal_cases, weekly_goal_cases, timezone, onboarding_completed_at, avatar:avatars!profiles_avatar_id_fkey(id, slug, name, emoji)",
      )
      .eq("id", userId)
      .single(),
    supabase
      .from("user_progress")
      .select("total_xp, level, current_streak, longest_streak, last_active_date, total_consultations")
      .eq("user_id", userId)
      .single(),
  ]);
  if (profile.error) throw profile.error;
  if (progress.error) throw progress.error;
  // A to-one embed comes back as an object; normalise for callers.
  const avatar = Array.isArray(profile.data.avatar) ? profile.data.avatar[0] : profile.data.avatar;
  return { profile: { ...profile.data, avatar: avatar ?? null }, progress: progress.data };
}

export const getProfileWithProgress = cache(async (next?: string) => {
  const user = await requireUser(next);
  return loadProfile(user.id);
});
