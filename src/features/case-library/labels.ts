import { stationXp, totalXp } from "@/server/gamification/xp";

// Display helpers shared by the hub's recommended case and the case library.

export const PERSONA_LABEL: Record<string, string> = {
  cooperative: "Cooperative",
  reserved: "Reserved",
  anxious: "Anxious",
  angry: "Frustrated",
  distracted: "Distracted",
  embarrassed: "Embarrassed",
};

/** Completion + a perfect score, before streak/first-of-day bonuses. */
export function maxStationXp(difficulty: number) {
  const d = Math.min(5, Math.max(1, difficulty)) as 1 | 2 | 3 | 4 | 5;
  return totalXp(stationXp({ difficulty: d, overallPct: 100, previousBestPct: null, isFirstStationToday: false, streak: 0 }));
}
