import { describe, expect, it } from "vitest";
import { avatarStepSchema, daysUntil, examStepSchema, goalsStepSchema, isValidTimeZone, specialtiesStepSchema } from "./schema";

describe("onboarding schemas", () => {
  it("trims and bounds display names", () => {
    const ok = avatarStepSchema.parse({ display_name: "  Priya  ", avatar_id: "8f14e45f-ceea-4e7a-9d6b-3b1c2a4d5e6f" });
    expect(ok.display_name).toBe("Priya");
    expect(avatarStepSchema.safeParse({ display_name: "   ", avatar_id: "8f14e45f-ceea-4e7a-9d6b-3b1c2a4d5e6f" }).success).toBe(false);
    expect(avatarStepSchema.safeParse({ display_name: "x".repeat(41), avatar_id: "8f14e45f-ceea-4e7a-9d6b-3b1c2a4d5e6f" }).success).toBe(false);
  });

  it("requires weekly goal >= daily goal", () => {
    expect(goalsStepSchema.safeParse({ daily_goal_cases: 3, weekly_goal_cases: 15 }).success).toBe(true);
    expect(goalsStepSchema.safeParse({ daily_goal_cases: 3, weekly_goal_cases: 2 }).success).toBe(false);
    expect(goalsStepSchema.safeParse({ daily_goal_cases: 11, weekly_goal_cases: 20 }).success).toBe(false);
  });

  it("accepts an optional ISO exam date", () => {
    expect(examStepSchema.safeParse({ exam_type: "amc_clinical", exam_date: null }).success).toBe(true);
    expect(examStepSchema.safeParse({ exam_type: "school_osce", exam_date: "2027-06-14" }).success).toBe(true);
    expect(examStepSchema.safeParse({ exam_type: "school_osce", exam_date: "14/06/2027" }).success).toBe(false);
    expect(examStepSchema.safeParse({ exam_type: "usmle", exam_date: null }).success).toBe(false);
  });

  it("needs at least one well-formed specialty", () => {
    expect(specialtiesStepSchema.safeParse({ target_specialties: [] }).success).toBe(false);
    expect(specialtiesStepSchema.safeParse({ target_specialties: ["emergency", "general-practice"] }).success).toBe(true);
    expect(specialtiesStepSchema.safeParse({ target_specialties: ["DROP TABLE"] }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("counts whole days to the exam", () => {
    const today = new Date(2026, 9, 17);
    expect(daysUntil("2026-10-17", today)).toBe(0);
    expect(daysUntil("2026-10-24", today)).toBe(7);
    expect(daysUntil("2026-10-10", today)).toBe(-7);
  });

  it("validates IANA timezones", () => {
    expect(isValidTimeZone("Australia/Brisbane")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
