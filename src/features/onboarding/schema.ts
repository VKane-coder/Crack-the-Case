import { z } from "zod";

// Shared by the onboarding wizard (client) and its server actions.

export const ONBOARDING_STEPS = ["avatar", "goals", "exam", "specialties"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const DAILY_GOAL_OPTIONS = [
  { value: 1, label: "Casual", blurb: "1 case a day", emoji: "🌱" },
  { value: 2, label: "Regular", blurb: "2 cases a day", emoji: "🔥" },
  { value: 3, label: "Serious", blurb: "3 cases a day", emoji: "💪" },
  { value: 5, label: "Intense", blurb: "5 cases a day", emoji: "🚀" },
] as const;

export const EXAM_TYPES = [
  { value: "school_osce", label: "My med school OSCE", emoji: "🎓" },
  { value: "amc_clinical", label: "AMC Clinical Exam", emoji: "🇦🇺" },
  { value: "other", label: "Something else", emoji: "📅" },
] as const;

export const avatarStepSchema = z.object({
  display_name: z.string().trim().min(1, "Tell us what to call you").max(40, "Keep it under 40 characters"),
  avatar_id: z.uuid("Pick an avatar"),
});

export const goalsStepSchema = z
  .object({
    daily_goal_cases: z.number().int().min(1).max(10),
    weekly_goal_cases: z.number().int().min(1).max(50),
  })
  .refine((v) => v.weekly_goal_cases >= v.daily_goal_cases, {
    message: "Your weekly goal should be at least your daily goal",
    path: ["weekly_goal_cases"],
  });

export const examStepSchema = z.object({
  exam_type: z.enum(["school_osce", "amc_clinical", "other"]),
  exam_date: z.iso.date().nullable(),
});

export const specialtiesStepSchema = z.object({
  target_specialties: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(1, "Pick at least one specialty")
    .max(8),
});

export const stepSchemas = {
  avatar: avatarStepSchema,
  goals: goalsStepSchema,
  exam: examStepSchema,
  specialties: specialtiesStepSchema,
} as const;

export type StepData = {
  avatar: z.infer<typeof avatarStepSchema>;
  goals: z.infer<typeof goalsStepSchema>;
  exam: z.infer<typeof examStepSchema>;
  specialties: z.infer<typeof specialtiesStepSchema>;
};

/** Whole days from `today` to an ISO date (YYYY-MM-DD); negative if in the past. */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86_400_000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
