import { CheckCircle2, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERSONA_LABEL, maxStationXp } from "@/features/case-library/labels";
import type { CaseProgress, CatalogCase } from "@/server/cases/catalog";
import { StartCaseButton } from "./start-case-button";

/** New, or done with the student's best score. */
export function CaseProgressBadge({ progress }: { progress: CaseProgress }) {
  if (!progress.completed) {
    return (
      <Badge variant="default">
        <Sparkles /> New
      </Badge>
    );
  }
  return (
    <Badge variant="teal" title={`Completed ${progress.completed} time${progress.completed === 1 ? "" : "s"}`}>
      <CheckCircle2 /> Done{progress.bestScore !== null && ` · best ${Math.round(progress.bestScore)}%`}
    </Badge>
  );
}

export function CaseCard({ c, canStart }: { c: CatalogCase & { progress: CaseProgress }; canStart: boolean }) {
  return (
    <Card role="article" aria-label={c.title} className="justify-between">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{c.title}</CardTitle>
          <CaseProgressBadge progress={c.progress} />
        </div>
        {c.candidate_brief && <CardDescription className="line-clamp-3">{c.candidate_brief}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="teal">{c.specialty_name}</Badge>
        <Badge variant="purple">Difficulty {c.difficulty}/5</Badge>
        {c.persona && <Badge variant="coral">{PERSONA_LABEL[c.persona] ?? c.persona} patient</Badge>}
        <Badge variant="outline">
          <Clock /> {Math.round(c.station_seconds / 60)} min
        </Badge>
      </CardContent>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-xp">Up to +{maxStationXp(c.difficulty)} XP</span>
        {canStart ? (
          <StartCaseButton caseSlug={c.slug} label={c.progress.completed ? "Try again" : "Start case"} />
        ) : (
          <Button variant="reward" disabled title="The AI patient isn't configured on this server yet">
            Patients unavailable
          </Button>
        )}
      </div>
    </Card>
  );
}
