import { cn } from "@/lib/utils";

export function formatClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Large, calm countdown. Turns coral when time is nearly up; the server deadline is the real limit. */
export function PhaseTimer({ remainingMs, label, warnAtMs = 60_000 }: { remainingMs: number; label: string; warnAtMs?: number }) {
  const low = remainingMs <= warnAtMs;
  return (
    <div
      role="timer"
      aria-label={`${label}: ${formatClock(remainingMs)} remaining`}
      className={cn(
        "rounded-2xl border px-4 py-2 text-center tabular-nums",
        low ? "border-brand-coral/40 bg-brand-coral/10 text-brand-coral" : "bg-card",
      )}
    >
      <div className="text-[0.7rem] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-3xl font-black">{formatClock(remainingMs)}</div>
    </div>
  );
}
