import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeTier = "bronze" | "silver" | "gold" | "emerald";

const tierRing: Record<BadgeTier, string> = {
  bronze: "from-tier-bronze/90 to-tier-bronze/50",
  silver: "from-tier-silver to-tier-silver/50",
  gold: "from-tier-gold to-tier-gold/50",
  emerald: "from-tier-emerald to-tier-emerald/50",
};

export function BadgeMedal({
  name,
  tier,
  icon: Icon,
  locked = false,
}: {
  name: string;
  tier: BadgeTier;
  icon: LucideIcon;
  locked?: boolean;
}) {
  return (
    <div className="flex w-20 flex-col items-center gap-1.5 text-center">
      <div
        className={cn(
          "grid size-16 place-items-center rounded-full bg-gradient-to-br p-1 shadow-md",
          locked ? "from-muted to-muted grayscale" : tierRing[tier],
        )}
      >
        <div className="grid size-full place-items-center rounded-full bg-card">
          <Icon className={cn("size-7", locked ? "text-muted-foreground" : "text-foreground")} />
        </div>
      </div>
      <span className={cn("text-xs leading-tight font-bold", locked && "text-muted-foreground")}>{name}</span>
    </div>
  );
}
