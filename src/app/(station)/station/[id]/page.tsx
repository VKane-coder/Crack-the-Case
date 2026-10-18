import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileWithProgress } from "@/server/auth/session";
import { loadStation } from "@/server/station/orchestrator";
import { sttAvailable, ttsAvailable } from "@/server/voice/config";
import { StationClient } from "./station-client";

export const metadata: Metadata = { title: "Station" };

// The live station is deliberately calm: no XP, streaks or confetti until it's over.
export default async function StationPage({ params }: PageProps<"/station/[id]">) {
  const { id } = await params;
  const { profile } = await getProfileWithProgress(`/station/${id}`);
  if (!profile.onboarding_completed_at) redirect("/onboarding");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const station = await loadStation(profile.id, id, await createClient());
  if (!station) notFound();

  // Previews say which voice keys are missing, so a Vercel env-var mistake is visible at a glance.
  const missing = [!sttAvailable() && "DEEPGRAM_API_KEY", !ttsAvailable() && "ELEVENLABS_API_KEY"].filter(Boolean);
  const setupNote = process.env.VERCEL_ENV === "preview" && missing.length ? `Preview setup: ${missing.join(" and ")} not found, so voice is off.` : null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <span className="truncate font-extrabold">{station.title}</span>
          <Link href="/hub" className="shrink-0 text-sm font-bold text-muted-foreground hover:text-foreground">
            Exit station
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">
        {setupNote && <p className="mb-4 rounded-xl bg-muted p-3 text-center text-sm text-muted-foreground">{setupNote}</p>}
        <StationClient station={station} voice={{ input: sttAvailable(), output: ttsAvailable() }} />
      </main>
    </div>
  );
}
