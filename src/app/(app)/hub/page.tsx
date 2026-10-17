import type { Metadata } from "next";
import { Award, Clock, Target, icons, type LucideIcon } from "lucide-react";
import { BadgeMedal, type BadgeTier } from "@/components/game/badge-medal";
import { StreakFlame } from "@/components/game/streak-flame";
import { XpBar } from "@/components/game/xp-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithProgress } from "@/server/auth/session";
import { levelProgress } from "@/server/gamification/levels";
import { stationXp, totalXp } from "@/server/gamification/xp";

export const metadata: Metadata = { title: "Hub" };

const PERSONA_LABEL: Record<string, string> = {
  cooperative: "Cooperative",
  reserved: "Reserved",
  anxious: "Anxious",
  angry: "Frustrated",
  distracted: "Distracted",
  embarrassed: "Embarrassed",
};

function iconFor(name: string): LucideIcon {
  const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase()) as keyof typeof icons;
  return icons[pascal] ?? Award;
}

/** Completion + a perfect score, before streak/first-of-day bonuses. */
function maxStationXp(difficulty: number) {
  const d = Math.min(5, Math.max(1, difficulty)) as 1 | 2 | 3 | 4 | 5;
  return totalXp(stationXp({ difficulty: d, overallPct: 100, previousBestPct: null, isFirstStationToday: false, streak: 0 }));
}

/** YYYY-MM-DD for "now" in the student's timezone (streak days follow local time). */
function localDate(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export default async function HubPage() {
  const { profile, progress } = await getProfileWithProgress("/hub");
  const supabase = await createClient();
  const today = localDate(profile.timezone);

  const [activity, preferred, anyCase, badges, earned] = await Promise.all([
    supabase.from("daily_activity").select("consultations").eq("user_id", profile.id).eq("activity_date", today).maybeSingle(),
    profile.target_specialties.length
      ? supabase
          .from("v_case_catalog")
          .select("slug, title, difficulty, persona, specialty_name, history_seconds, presentation_seconds")
          .in("specialty_slug", profile.target_specialties)
          .order("difficulty")
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("v_case_catalog")
      .select("slug, title, difficulty, persona, specialty_name, history_seconds, presentation_seconds")
      .order("difficulty")
      .limit(1)
      .maybeSingle(),
    supabase.from("badges").select("id, slug, name, tier, icon, description").order("sort_order"),
    supabase.from("user_badges").select("badge_id").eq("user_id", profile.id),
  ]);

  const name = profile.display_name ?? "there";
  const xp = levelProgress(progress.total_xp);
  const doneToday = activity.data?.consultations ?? 0;
  const target = profile.daily_goal_cases;
  const goalPct = Math.min(100, Math.round((doneToday / target) * 100));
  const activeToday = progress.last_active_date === today;
  const recommended = preferred.data ?? anyCase.data;
  const earnedIds = new Set((earned.data ?? []).map((b) => b.badge_id));
  const allBadges = badges.data ?? [];
  const shelf = [...allBadges.filter((b) => earnedIds.has(b.id)), ...allBadges.filter((b) => !earnedIds.has(b.id))].slice(0, 6);
  const nextBadge = allBadges.find((b) => !earnedIds.has(b.id));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl">G&apos;day, {name}! 👋</h1>
        <p className="text-muted-foreground">
          {progress.total_consultations === 0
            ? "Your first patient is in the waiting room."
            : "Ready for your next patient?"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <StreakFlame days={progress.current_streak} activeToday={activeToday} />
          <p className="text-sm text-muted-foreground">
            {activeToday
              ? "Streak safe for today. Legend!"
              : progress.current_streak > 0
                ? "Finish one case today to keep the flame alive."
                : "Crack a case today to light your first flame."}
          </p>
        </Card>
        <Card className="md:col-span-2">
          <XpBar progress={xp} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {recommended && (
          <Card className="overflow-hidden border-brand-purple/30 bg-gradient-to-br from-card to-brand-purple/5 md:col-span-2">
            <CardHeader>
              <span className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-brand-purple uppercase">
                <Target className="size-3.5" /> Recommended next challenge
              </span>
              <CardTitle className="text-xl">{recommended.title}</CardTitle>
              <CardDescription>
                {progress.total_consultations === 0
                  ? "A great first case from your chosen specialties."
                  : "Picked from your chosen specialties."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="teal">{recommended.specialty_name}</Badge>
              <Badge variant="purple">Difficulty {recommended.difficulty}/5</Badge>
              {recommended.persona && <Badge variant="coral">{PERSONA_LABEL[recommended.persona] ?? recommended.persona} patient</Badge>}
              <Badge variant="outline">
                <Clock /> {Math.round((recommended.history_seconds + recommended.presentation_seconds) / 60)} min
              </Badge>
            </CardContent>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-xp">Up to +{maxStationXp(recommended.difficulty)} XP</span>
              <Button variant="reward" size="lg" disabled title="Stations arrive in the next milestone">
                Stations coming soon
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s goal</CardTitle>
            <CardDescription>
              {Math.min(doneToday, target)} of {target} case{target > 1 && "s"} done
            </CardDescription>
          </CardHeader>
          <Progress value={goalPct} indicatorClassName="bg-brand-teal" aria-label="Daily goal progress" />
          <p className="text-sm text-muted-foreground">
            {goalPct >= 100 ? "Goal smashed! Bonus XP banked. 🎯" : "Smash it for +30 bonus XP."}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trophy cabinet</CardTitle>
          <CardDescription>
            {earnedIds.size === 0
              ? "Your first badge is one patient away."
              : `${earnedIds.size} badge${earnedIds.size === 1 ? "" : "s"} collected.`}
            {nextBadge && earnedIds.size > 0 && ` Next up: ${nextBadge.name}.`}
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          {shelf.map((b) => (
            <BadgeMedal
              key={b.id}
              name={b.name}
              tier={b.tier as BadgeTier}
              icon={iconFor(b.icon)}
              locked={!earnedIds.has(b.id)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
