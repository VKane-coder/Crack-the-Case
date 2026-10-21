import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, BookMarked, Check, CircleDashed, Lightbulb, Quote, ThumbsUp, X } from "lucide-react";
import { Celebration } from "@/components/game/celebration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getProfileWithProgress } from "@/server/auth/session";
import { loadResult, type Report } from "@/server/station/results";

export const metadata: Metadata = { title: "Your report" };

const DOMAIN_LABEL: Record<string, string> = {
  history: "History taking",
  communication: "Communication",
  differentials: "Differential diagnosis",
  investigations: "Investigations",
  management: "Management",
  clinical_reasoning: "Clinical reasoning",
  patient_safety: "Patient safety",
};

const RATING: Record<string, { label: string; variant: "teal" | "purple" | "coral" | "default" }> = {
  excellent: { label: "Excellent", variant: "teal" },
  good: { label: "Good", variant: "teal" },
  pass: { label: "Pass", variant: "purple" },
  borderline: { label: "Borderline", variant: "coral" },
  fail: { label: "Not yet", variant: "coral" },
};

export default async function ResultsPage({ params }: PageProps<"/results/[id]">) {
  const { id } = await params;
  const { profile } = await getProfileWithProgress(`/results/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await loadResult(profile.id, id).catch(() => null);
  if (!result) notFound();
  if (!result.report) redirect(`/station/${id}`);
  const r = result.report;
  const xp = r.xp.reduce((n, x) => n + x.amount, 0);
  const rating = RATING[r.rating] ?? RATING.pass;

  return (
    <div className="flex flex-col gap-5">
      <Celebration
        xp={xp}
        title={r.passed ? "Case cracked!" : "Station complete"}
        subtitle={`${result.title} · ${result.patientName}`}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-4xl font-black tabular-nums">{Math.round(r.overall)}%</span>
          <Badge variant={rating.variant}>{rating.label}</Badge>
          <Badge variant={r.passed ? "teal" : "coral"}>{r.passed ? "Passed" : "Not passed yet"}</Badge>
        </div>
      </Celebration>

      <Card>
        <CardTitle className="flex items-center gap-2">
          <Quote className="size-5 text-brand-purple" /> Examiner&apos;s comment
        </CardTitle>
        <p className="text-lg leading-relaxed">{r.comment}</p>
      </Card>

      <Card>
        <CardTitle>How you scored</CardTitle>
        <div className="space-y-3">
          {r.domains.map((d) => (
            <div key={d.domain}>
              <div className="mb-1 flex justify-between text-sm font-bold">
                <span>{DOMAIN_LABEL[d.domain] ?? d.domain}</span>
                <span className="tabular-nums">
                  {d.score} / {d.max}
                </span>
              </div>
              <Progress
                value={d.pct}
                aria-label={`${DOMAIN_LABEL[d.domain] ?? d.domain}: ${Math.round(d.pct)}%`}
                indicatorClassName={d.pct >= 70 ? "bg-brand-teal" : d.pct >= 50 ? "bg-brand-purple" : "bg-brand-coral"}
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ListCard title="What went well" icon={<ThumbsUp className="size-5 text-brand-teal" />} items={r.strengths} />
        <ListCard title="Next time" icon={<Lightbulb className="size-5 text-brand-purple" />} items={r.improvements} />
        <ListCard title="Red flags you missed" icon={<AlertTriangle className="size-5 text-brand-coral" />} items={r.missedRedFlags} empty="None. Nice work." />
        <ListCard title="Questions to add" icon={<CircleDashed className="size-5 text-muted-foreground" />} items={r.missedQuestions} empty="Nothing major missed." />
      </div>

      {r.revisionTopics.length > 0 && (
        <Card>
          <CardTitle className="flex items-center gap-2">
            <BookMarked className="size-5 text-brand-blue" /> Revise
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {r.revisionTopics.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Marking sheet</CardTitle>
          <CardDescription>Every item on the rubric, with what you said that earned it.</CardDescription>
        </CardHeader>
        <ul className="divide-y">
          {r.items.map((i) => (
            <ItemRow key={i.key} item={i} />
          ))}
        </ul>
      </Card>

      <Reveal reveal={r.reveal} />

      <Card>
        <details>
          <summary className="cursor-pointer font-extrabold">Full transcript</summary>
          <div className="mt-3 space-y-2 text-sm">
            <h3 className="font-bold">History</h3>
            {r.transcript.history.map((m, i) => (
              <p key={i}>
                <span className="font-bold">{m.role === "student" ? "You" : result.patientName.split(" ")[0]}:</span> {m.content}
              </p>
            ))}
            <h3 className="pt-2 font-bold">Presentation</h3>
            <p>{r.transcript.presentation.join(" ") || "(no presentation)"}</p>
            <h3 className="pt-2 font-bold">Examiner questions</h3>
            {r.transcript.qa.map((q, i) => (
              <div key={i}>
                <p className="font-semibold">{q.question}</p>
                <p className="text-muted-foreground">{q.answer ?? "(no answer)"}</p>
              </div>
            ))}
          </div>
        </details>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="reward" size="lg">
          <Link href="/hub">Back to the hub</Link>
        </Button>
      </div>
    </div>
  );
}

function ListCard({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: string[]; empty?: string }) {
  return (
    <Card>
      <CardTitle className="flex items-center gap-2">
        {icon} {title}
      </CardTitle>
      {items.length ? (
        <ul className="list-disc space-y-1.5 pl-5">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty ?? "Nothing to add."}</p>
      )}
    </Card>
  );
}

function ItemRow({ item }: { item: Report["items"][number] }) {
  const Icon = item.outcome === "met" ? Check : item.outcome === "partial" ? CircleDashed : X;
  const label = item.outcome === "met" ? "Met" : item.outcome === "partial" ? "Partly met" : "Not met";
  return (
    <li className="flex gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
          item.outcome === "met" ? "bg-brand-teal/15 text-brand-teal" : item.outcome === "partial" ? "bg-brand-purple/15 text-brand-purple" : "bg-brand-coral/15 text-brand-coral",
        )}
        title={label}
      >
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">
            {item.label}
            {item.critical && (
              <Badge variant="coral" className="ml-2 align-middle">
                Critical
              </Badge>
            )}
          </span>
          <span className="text-sm font-bold tabular-nums">
            {item.points} / {item.max}
          </span>
        </div>
        {item.evidence && <p className="mt-1 text-sm text-muted-foreground italic">&ldquo;{item.evidence}&rdquo;</p>}
      </div>
    </li>
  );
}

function Reveal({ reveal }: { reveal: Report["reveal"] }) {
  return (
    <Card className="border-brand-teal/30">
      <CardHeader>
        <CardTitle className="text-xl">The case, revealed</CardTitle>
        <CardDescription>{reveal.diagnosis}</CardDescription>
      </CardHeader>
      <Section title="Differentials">
        {reveal.differentials.map((d) => (
          <li key={d.dx}>
            <span className="font-semibold">{d.dx}</span> <span className="text-muted-foreground">({d.likelihood.replace("_", " ")})</span>: {d.discriminating_features}
          </li>
        ))}
      </Section>
      <Section title="Red flags">
        {reveal.redFlags.map((f, i) => (
          <li key={i}>
            <span className="italic">&ldquo;{f.fact}&rdquo;</span>: {f.why}
          </li>
        ))}
      </Section>
      <Section title="Investigations">{reveal.investigations.map((t) => <li key={t}>{t}</li>)}</Section>
      <Section title="Management">{reveal.management.map((t) => <li key={t}>{t}</li>)}</Section>
      {reveal.safetyNetting.length > 0 && <Section title="Safety-netting">{reveal.safetyNetting.map((t) => <li key={t}>{t}</li>)}</Section>}
      <Section title="Learning objectives">{reveal.objectives.map((t) => <li key={t}>{t}</li>)}</Section>
      <p className="text-xs text-muted-foreground">
        References: {reveal.references.join("; ")}.
        {reveal.pendingReview && " This case is awaiting review by an Australian clinician."}
      </p>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 font-extrabold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
    </div>
  );
}
