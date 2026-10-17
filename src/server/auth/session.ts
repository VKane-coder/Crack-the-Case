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
        "id, display_name, role, exam_type, exam_date, target_specialties, daily_goal_cases, weekly_goal_cases, timezone, onboarding_completed_at, avatar:avatars(id, slug, name, emoji)",
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
