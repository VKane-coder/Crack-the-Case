import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export function StreakFlame({ days, activeToday }: { days: number; activeToday: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid size-14 place-items-center rounded-2xl",
          activeToday ? "bg-streak/15 text-streak" : days > 0 ? "bg-streak/10 text-streak/50" : "bg-muted text-muted-foreground",
        )}
      >
        <Flame className={cn("size-8", activeToday && "animate-pulse")} fill="currentColor" />
      </div>
      <div>
        <div className="text-2xl leading-none font-black tabular-nums">{days}</div>
        <div className="text-muted-foreground text-sm">day streak</div>
      </div>
    </div>
  );
}
