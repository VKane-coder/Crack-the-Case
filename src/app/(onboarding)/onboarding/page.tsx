import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithProgress } from "@/server/auth/session";
import { OnboardingWizard, type AvatarOption, type SpecialtyOption } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const { profile } = await getProfileWithProgress("/onboarding");
  if (profile.onboarding_completed_at) redirect("/hub");

  const supabase = await createClient();
  const [avatars, owned, specialties] = await Promise.all([
    supabase.from("avatars").select("id, slug, name, emoji, rarity, unlock_rule, is_default").order("sort_order"),
    supabase.from("user_avatars").select("avatar_id").eq("user_id", profile.id),
    supabase.from("specialties").select("slug, name, icon, colour_token").order("sort_order"),
  ]);
  if (avatars.error || owned.error || specialties.error) throw avatars.error ?? owned.error ?? specialties.error;

  const ownedIds = new Set(owned.data.map((o) => o.avatar_id));
  const avatarOptions: AvatarOption[] = avatars.data.map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji ?? "🙂",
    rarity: a.rarity,
    locked: !(a.is_default || a.unlock_rule === null || ownedIds.has(a.id)),
    unlockHint: unlockHint(a.unlock_rule as { type?: string; gte?: number } | null),
  }));

  // Resume where the student left off. The exam step is the last one with no default value,
  // so a saved exam_type means only specialties remain.
  const initialStep = profile.exam_type && profile.target_specialties.length === 0 ? 3 : 0;

  return (
    <OnboardingWizard
      initialStep={initialStep}
      avatars={avatarOptions}
      specialties={specialties.data as SpecialtyOption[]}
      initial={{
        display_name: profile.display_name ?? "",
        avatar_id: profile.avatar?.id ?? avatarOptions.find((a) => !a.locked)?.id ?? "",
        daily_goal_cases: profile.daily_goal_cases,
        weekly_goal_cases: profile.weekly_goal_cases,
        exam_type: (profile.exam_type as "school_osce" | "amc_clinical" | "other" | null) ?? null,
        exam_date: profile.exam_date,
        target_specialties: profile.target_specialties,
      }}
    />
  );
}

function unlockHint(rule: { type?: string; gte?: number } | null): string | undefined {
  if (!rule) return undefined;
  if (rule.type === "level" && rule.gte) return `Unlocks at level ${rule.gte}`;
  if (rule.type === "badge") return "Unlocks with a badge";
  return "Unlock later";
}
