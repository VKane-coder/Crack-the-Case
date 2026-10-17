import type { Metadata } from "next";
import { Award, Brain, Clock, HeartHandshake, Search, ShieldAlert, Target } from "lucide-react";
import { BadgeMedal } from "@/components/game/badge-medal";
import { StreakFlame } from "@/components/game/streak-flame";
import { XpBar } from "@/components/game/xp-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { levelProgress } from "@/server/gamification/levels";

export const metadata: Metadata = { title: "Hub" };

// M0 design preview. Replaced by GET /api/me/dashboard once auth and data land in M1/M6.
const preview = {
  name: "Alex",
  totalXp: 1340,
  streak: 5,
  activeToday: false,
  dailyGoal: { done: 0, target: 1 },
  recommended: {
    title: "Chest pain in the arvo",
    specialty: "Emergency",
    difficulty: 3,
    minutes: 8,
    persona: "Anxious",
    xp: 175,
  },
};

export default function HubPage() {
  const progress = levelProgress(preview.totalXp);
  const goalPct = Math.round((preview.dailyGoal.done / preview.dailyGoal.target) * 100);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">G&apos;day, {preview.name}! 👋</h1>
          <p className="text-muted-foreground">Your next patient is in the waiting room.</p>
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">Design preview</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <StreakFlame days={preview.streak} activeToday={preview.activeToday} />
          <p className="text-sm text-muted-foreground">
            {preview.activeToday ? "Streak safe for today. Legend!" : "Finish one case today to keep the flame alive."}
          </p>
        </Card>

        <Card className="md:col-span-2">
          <XpBar progress={progress} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 overflow-hidden border-brand-purple/30 bg-gradient-to-br from-card to-brand-purple/5">
          <CardHeader>
            <span className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-brand-purple uppercase">
              <Target className="size-3.5" /> Recommended next challenge
            </span>
            <CardTitle className="text-xl">{preview.recommended.title}</CardTitle>
            <CardDescription>Picked to work on your weakest skill: red flag screening.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="teal">{preview.recommended.specialty}</Badge>
            <Badge variant="purple">Difficulty {preview.recommended.difficulty}/5</Badge>
            <Badge variant="coral">{preview.recommended.persona} patient</Badge>
            <Badge variant="outline">
              <Clock /> {preview.recommended.minutes} min
            </Badge>
          </CardContent>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-xp">Up to +{preview.recommended.xp} XP</span>
            <Button variant="reward" size="lg" disabled title="Stations arrive in M2">
              Start station
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s goal</CardTitle>
            <CardDescription>
              {preview.dailyGoal.done} of {preview.dailyGoal.target} case{preview.dailyGoal.target > 1 && "s"} done
            </CardDescription>
          </CardHeader>
          <Progress value={goalPct} indicatorClassName="bg-brand-teal" aria-label="Daily goal progress" />
          <p className="text-sm text-muted-foreground">Smash it for +30 bonus XP.</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trophy cabinet</CardTitle>
          <CardDescription>2 badges collected. Red Flag Hunter is next: catch every red flag in 5 stations.</CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <BadgeMedal name="First History" tier="bronze" icon={Search} />
          <BadgeMedal name="Rapport Builder" tier="silver" icon={HeartHandshake} />
          <BadgeMedal name="Red Flag Hunter" tier="gold" icon={ShieldAlert} locked />
          <BadgeMedal name="Diagnostic Detective" tier="emerald" icon={Brain} locked />
          <BadgeMedal name="7 Day Hero" tier="gold" icon={Award} locked />
        </div>
      </Card>
    </div>
  );
}
