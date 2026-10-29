import { Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { LevelProgress } from "@/server/gamification/levels";

export function XpBar({ progress }: { progress: LevelProgress }) {
  const toGo = progress.xpForNext - progress.xpIntoLevel;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-xp flex items-center gap-1.5 font-extrabold">
          <Sparkles className="size-4" /> Level {progress.level} · {progress.title}
        </span>
        <span className="text-muted-foreground font-semibold tabular-nums">
          {progress.xpIntoLevel} / {progress.xpForNext} XP
        </span>
      </div>
      <Progress
        value={progress.pct}
        aria-label="Progress to next level"
        className="h-4"
        indicatorClassName="bg-gradient-to-r from-brand-purple via-brand-blue to-brand-teal"
      />
      <p className="text-muted-foreground text-xs">{toGo} XP to your next level. One more case could do it!</p>
    </div>
  );
}
