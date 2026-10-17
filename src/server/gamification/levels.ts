// Pure level maths. The `levels` table is seeded from these values so client and DB agree.

export const LEVEL_TITLES = [
  { from: 1, title: "Curious Clerk" },
  { from: 3, title: "History Hound" },
  { from: 6, title: "Clinical Communicator" },
  { from: 10, title: "Diagnostic Detective" },
  { from: 15, title: "Ward Round Wizard" },
  { from: 21, title: "Intern Ready" },
  { from: 28, title: "RMO Rockstar" },
  { from: 36, title: "OSCE Legend" },
] as const;

/** Cumulative XP needed to reach `level`. Level 1 starts at 0 XP. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.6));
}

export function levelFromXp(totalXp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  return level;
}

export function levelTitle(level: number): string {
  let title: string = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.from) title = t.title;
  return title;
}

export type LevelProgress = {
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNext: number;
  pct: number;
};

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelFromXp(totalXp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const xpIntoLevel = totalXp - floor;
  const xpForNext = next - floor;
  return { level, title: levelTitle(level), xpIntoLevel, xpForNext, pct: Math.round((xpIntoLevel / xpForNext) * 100) };
}
