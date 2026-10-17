"use server";

import {
  isValidTimeZone,
  stepSchemas,
  type OnboardingStep,
  type StepData,
} from "@/features/onboarding/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export type StepResult = { ok: true } | { ok: false; error: string };
export type CompleteResult =
  | { ok: true; xpAwarded: number; totalXp: number; level: number }
  | { ok: false; error: string };

// "use server" modules may only export async functions.
const ONBOARDING_XP = 50;

// Writes go through the user's own session, so RLS and the profile column grants decide what's allowed.
export async function saveOnboardingStep<S extends OnboardingStep>(step: S, data: StepData[S]): Promise<StepResult> {
  const user = await requireUser("/onboarding");
  const parsed = stepSchemas[step].safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your answers." };

  const supabase = await createClient();

  if (step === "specialties") {
    const wanted = (parsed.data as StepData["specialties"]).target_specialties;
    const { data: known, error } = await supabase.from("specialties").select("slug").in("slug", wanted);
    if (error) return { ok: false, error: "Couldn't load specialties. Please try again." };
    if (known.length !== new Set(wanted).size) return { ok: false, error: "One of those specialties doesn't exist." };
  }

  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  if (error) {
    if (error.code === "42501") return { ok: false, error: "That avatar is still locked. Pick another for now!" };
    console.error("onboarding step save failed", { step, code: error.code });
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
  return { ok: true };
}

export async function completeOnboarding(input: { timezone: string }): Promise<CompleteResult> {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();

  const { data: profile, error: loadError } = await supabase
    .from("profiles")
    .select("display_name, avatar_id, exam_type, target_specialties, onboarding_completed_at")
    .eq("id", user.id)
    .single();
  if (loadError) return { ok: false, error: "Couldn't load your profile. Please try again." };
  if (!profile.display_name || !profile.avatar_id || !profile.exam_type || profile.target_specialties.length === 0) {
    return { ok: false, error: "A few steps still need answers." };
  }

  if (!profile.onboarding_completed_at) {
    const timezone = isValidTimeZone(input.timezone) ? input.timezone : "Australia/Sydney";
    const { error } = await supabase
      .from("profiles")
      .update({ timezone, onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("onboarding_completed_at", null);
    if (error) {
      console.error("onboarding completion failed", { code: error.code });
      return { ok: false, error: "Couldn't finish setting up. Please try again." };
    }
  }

  // XP is a privileged write: service role, idempotent per user.
  const { data, error } = await createAdminClient()
    .rpc("grant_xp", {
      p_user: user.id,
      p_source: "onboarding",
      p_amount: ONBOARDING_XP,
      p_key: `${user.id}:onboarding`,
    })
    .single<{ awarded: boolean; total_xp: number; level: number }>();
  if (error) {
    // Onboarding is complete either way; the welcome XP can be granted again safely later.
    console.error("grant_xp failed", { code: error.code });
    return { ok: true, xpAwarded: 0, totalXp: 0, level: 1 };
  }
  return { ok: true, xpAwarded: data.awarded ? ONBOARDING_XP : 0, totalXp: data.total_xp, level: data.level };
}
