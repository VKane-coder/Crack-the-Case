import { describe, expect, it } from "vitest";
import { checkAgainstDisclosures, pointsFor, scoreAssessment, type ScoringRubric } from "./scoring";

const rubric: ScoringRubric = {
  pass_mark: 55,
  domain_weights: { history: 0.5, communication: 0.5, management: 0 },
  items: [
    {
      key: "red_flags",
      domain: "history",
      label: "Elicits red flags",
      max_points: 4,
      linked_fact_ids: ["bleed", "weight"],
      is_critical: true,
    },
    { key: "duration", domain: "history", label: "Duration", max_points: 2, linked_fact_ids: ["duration"], is_critical: false },
    { key: "empathy", domain: "communication", label: "Empathy", max_points: 2, linked_fact_ids: [], is_critical: false },
    { key: "plan", domain: "management", label: "Plan", max_points: 2, linked_fact_ids: [], is_critical: false },
  ],
};

describe("checkAgainstDisclosures", () => {
  const item = rubric.items[0];
  it("needs every linked fact for met, any for partial", () => {
    expect(checkAgainstDisclosures(item, "met", new Set(["bleed", "weight"]))).toEqual({ outcome: "met" });
    expect(checkAgainstDisclosures(item, "met", new Set(["bleed"])).outcome).toBe("partial");
    expect(checkAgainstDisclosures(item, "partial", new Set()).outcome).toBe("not_met");
    expect(checkAgainstDisclosures(rubric.items[2], "met", new Set())).toEqual({ outcome: "met" });
  });
});

describe("scoreAssessment", () => {
  it("computes points, domains and the weighted overall itself", () => {
    const s = scoreAssessment(
      rubric,
      [
        { key: "red_flags", outcome: "met", evidence: "Any blood?" },
        { key: "duration", outcome: "partial", evidence: "How long?" },
        { key: "empathy", outcome: "met", evidence: "That sounds hard." },
        { key: "plan", outcome: "not_met", evidence: "" },
      ],
      ["bleed", "weight", "duration"],
    );
    expect(s.items.map((i) => i.points)).toEqual([4, 1, 2, 0]);
    expect(s.domains).toEqual([
      { domain: "history", score: 5, max: 6, pct: 83.33 },
      { domain: "communication", score: 2, max: 2, pct: 100 },
      { domain: "management", score: 0, max: 2, pct: 0 },
    ]);
    // Zero-weight domains don't count: (0.5 × 83.33 + 0.5 × 100) / 1
    expect(s.overallPct).toBe(91.67);
    expect(s.passed).toBe(true);
  });

  it("fails on a missed critical item even with a high score, and treats unassessed items as not met", () => {
    const s = scoreAssessment(
      rubric,
      [
        { key: "red_flags", outcome: "met", evidence: "" },
        { key: "duration", outcome: "met", evidence: "" },
        { key: "empathy", outcome: "met", evidence: "" },
      ],
      ["duration"], // the red flags were never actually disclosed
    );
    expect(s.items[0]).toMatchObject({ outcome: "not_met", points: 0, adjustment: expect.any(String) });
    expect(s.items[3]).toMatchObject({ outcome: "not_met", adjustment: "Not assessed." });
    expect(s.criticalMissed).toEqual(["red_flags"]);
    expect(s.passed).toBe(false);
  });
});

describe("partial points and points-only rubrics", () => {
  const items = [
    { key: "hpc", domain: "history", label: "HPC", max_points: 5, linked_fact_ids: [], is_critical: false },
    { key: "ddx", domain: "differentials", label: "Differentials", max_points: 3, linked_fact_ids: [], is_critical: false },
  ];

  it("uses the assessor's partial points, rounded to half marks and kept inside the outcome", () => {
    expect(pointsFor(5, "partial", 3.2)).toBe(3);
    expect(pointsFor(5, "partial", 5)).toBe(4.5);
    expect(pointsFor(5, "partial", 0)).toBe(0.5);
    expect(pointsFor(5, "partial", undefined)).toBe(2.5);
    expect(pointsFor(5, "met", 1)).toBe(5);
    expect(pointsFor(5, "not_met", 4)).toBe(0);
  });

  it("scores total marks over total available when the rubric has no domain weights", () => {
    const s = scoreAssessment(
      { items, domain_weights: {}, pass_mark: 50 },
      [
        { key: "hpc", outcome: "partial", points: 3, evidence: "" },
        { key: "ddx", outcome: "met", evidence: "" },
      ],
      [],
    );
    expect(s.overallPct).toBe(75); // (3 + 3) / 8
    expect(s.passed).toBe(true);
  });
});
