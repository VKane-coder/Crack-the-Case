import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Flame, Sparkles } from "lucide-react";
import { UserMenu } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";
import { getProfileWithProgress } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, progress } = await getProfileWithProgress();
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="min-h-dvh [background:var(--hub-gradient)]">
      <header className="bg-background/70 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/hub" className="text-lg font-black">
            Crack the <span className="text-brand-purple">Case</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/cases"
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold"
            >
              <BookOpen className="size-4" /> <span className="max-sm:sr-only">Cases</span>
            </Link>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-black tabular-nums",
                progress.current_streak > 0 ? "bg-streak/15 text-streak" : "bg-muted text-muted-foreground",
              )}
              title="Day streak"
            >
              <Flame className="size-4" fill="currentColor" /> {progress.current_streak}
            </span>
            <span
              className="bg-xp/15 text-xp flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-black tabular-nums"
              title="Level"
            >
              <Sparkles className="size-4" /> Lv {progress.level}
            </span>
            <UserMenu name={profile.display_name ?? "You"} emoji={profile.avatar?.emoji ?? "🙂"} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
