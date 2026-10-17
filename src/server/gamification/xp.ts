// Pure XP rules for a completed station. Each line becomes one row in the xp_events ledger.

export type XpSource = "completion" | "performance" | "improvement" | "first_of_day" | "streak_bonus";

export type StationXpInput = {
  difficulty: 1 | 2 | 3 | 4 | 5;
  overallPct: number;
  previousBestPct: number | null;
  isFirstStationToday: boolean;
  /** Streak length after this station counted. */
  streak: number;
};

export type XpLine = { source: XpSource; amount: number };

const DIFFICULTY_MULTIPLIER = { 1: 1, 2: 1.25, 3: 1.5, 4: 1.75, 5: 2 } as const;

export function stationXp(input: StationXpInput): XpLine[] {
  const pct = Math.max(0, Math.min(100, input.overallPct));
  const lines: XpLine[] = [
    { source: "completion", amount: Math.round(50 * DIFFICULTY_MULTIPLIER[input.difficulty]) },
    { source: "performance", amount: Math.round(pct) },
  ];
  if (input.previousBestPct !== null && pct - input.previousBestPct >= 10) {
    lines.push({ source: "improvement", amount: 25 });
  }
  if (input.isFirstStationToday) lines.push({ source: "first_of_day", amount: 20 });
  if (input.streak > 0) lines.push({ source: "streak_bonus", amount: 5 * Math.min(input.streak, 10) });
  return lines;
}

export const totalXp = (lines: XpLine[]) => lines.reduce((sum, l) => sum + l.amount, 0);
