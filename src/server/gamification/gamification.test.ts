import { describe, expect, it } from "vitest";
import { levelFromXp, levelProgress, levelTitle, xpForLevel } from "./levels";
import { stationXp, totalXp } from "./xp";

describe("levels", () => {
  it("starts at level 1 with 0 XP", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(xpForLevel(1)).toBe(0);
  });

  it("is monotonic and consistent with thresholds", () => {
    for (let lvl = 1; lvl < 50; lvl++) {
      expect(xpForLevel(lvl + 1)).toBeGreaterThan(xpForLevel(lvl));
      expect(levelFromXp(xpForLevel(lvl))).toBe(lvl);
      expect(levelFromXp(xpForLevel(lvl + 1) - 1)).toBe(lvl);
    }
  });

  it("names tiers", () => {
    expect(levelTitle(1)).toBe("Curious Clerk");
    expect(levelTitle(6)).toBe("Clinical Communicator");
    expect(levelTitle(99)).toBe("OSCE Legend");
  });

  it("reports progress within a level", () => {
    const p = levelProgress(xpForLevel(4) + 10);
    expect(p.level).toBe(4);
    expect(p.xpIntoLevel).toBe(10);
    expect(p.pct).toBeGreaterThanOrEqual(0);
    expect(p.pct).toBeLessThan(100);
  });
});

describe("stationXp", () => {
  const base = { difficulty: 1 as const, overallPct: 70, previousBestPct: null, isFirstStationToday: false, streak: 0 };

  it("awards completion and performance", () => {
    expect(totalXp(stationXp(base))).toBe(50 + 70);
  });

  it("scales completion by difficulty", () => {
    expect(stationXp({ ...base, difficulty: 5 })[0].amount).toBe(100);
  });

  it("awards improvement only for a 10+ point gain", () => {
    expect(stationXp({ ...base, previousBestPct: 61 }).some((l) => l.source === "improvement")).toBe(false);
    expect(stationXp({ ...base, previousBestPct: 60 }).some((l) => l.source === "improvement")).toBe(true);
  });

  it("caps the streak bonus at 10 days", () => {
    const bonus = (streak: number) => stationXp({ ...base, streak }).find((l) => l.source === "streak_bonus")?.amount;
    expect(bonus(3)).toBe(15);
    expect(bonus(40)).toBe(50);
  });

  it("clamps out-of-range scores", () => {
    expect(stationXp({ ...base, overallPct: 140 })[1].amount).toBe(100);
  });
});
