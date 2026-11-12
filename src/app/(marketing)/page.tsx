import Link from "next/link";
import { Mic, Stethoscope, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  { icon: Mic, title: "Talk to real-feeling patients", body: "Voice consultations with AI patients who have moods, worries and secrets." },
  { icon: Stethoscope, title: "Present to an examiner", body: "Pitch your differentials and plan, then handle the follow-up questions." },
  { icon: Trophy, title: "Level up every day", body: "XP, streaks and badges that turn OSCE prep into a habit." },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh [background:var(--hub-gradient)]">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-20 pb-12 text-center sm:pt-28">
        <span className="bg-brand-teal/15 text-brand-teal rounded-full px-3 py-1 text-sm font-bold">
          OSCE practice for Aussie med students
        </span>
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          Crack the{" "}
          <span className="from-brand-blue via-brand-purple to-brand-coral bg-gradient-to-r bg-clip-text text-transparent">Case</span>
        </h1>
        <p className="text-muted-foreground max-w-xl text-lg">
          Take a history, present to the examiner, get rubric-based feedback in minutes. Then come back tomorrow and keep your streak alive.
        </p>
        <Button size="lg" variant="reward" asChild>
          <Link href="/hub">Meet your first patient</Link>
        </Button>
      </section>
      <section className="mx-auto grid max-w-4xl gap-4 px-4 pb-20 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-card/80 rounded-2xl border p-5 backdrop-blur">
            <Icon className="text-brand-purple mb-3 size-7" />
            <h2 className="font-extrabold">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
