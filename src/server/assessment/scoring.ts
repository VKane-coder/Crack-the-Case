// Turns the assessor's judgements into scores (docs/architecture.md §3.3). The model decides
// met / partial / not met for each rubric item; every number is computed here, never by the model.
// A deterministic check against the patient's disclosure log stops an item being credited for
// facts the student never actually elicited.

export const OUTCOMES = ["met", "partial", "not_met"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const GLOBAL_RATINGS = ["fail", "borderline", "pass", "good", "excellent"] as const;
export type GlobalRating = (typeof GLOBAL_RATINGS)[number];

export type ScoringItem = {
  key: string;
  domain: string;
  label: string;
  max_points: number;
  linked_fact_ids: string[];
  is_critical: boolean;
};

export type ScoringRubric = {
  items: ScoringItem[];
  domain_weights: Record<string, number>;
  pass_mark: number;
};

/** points: what the assessor would award; only used for partial outcomes, and always clamped. */
export type Judgement = { key: string; outcome: Outcome; evidence: string; points?: number };

export type ItemScore = {
  key: string;
  domain: string;
  label: string;
  outcome: Outcome;
  points: number;
  max: number;
  evidence: string;
  is_critical: boolean;
  /** Why the server changed the assessor's outcome, if it did. */
  adjustment?: string;
};

export type DomainScore = { domain: string; score: number; max: number; pct: number };

export type Scored = {
  items: ItemScore[];
  domains: DomainScore[];
  overallPct: number;
  passed: boolean;
  criticalMissed: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const POINTS: Record<Outcome, number> = { met: 1, partial: 0.5, not_met: 0 };

/**
 * Points for one item. Met and not met are all or nothing. Partial uses the assessor's points,
 * rounded to the nearest half mark and kept strictly between 0 and the maximum (so it can't
 * contradict the outcome); without a usable number it's half marks.
 */
export function pointsFor(max: number, outcome: Outcome, suggested?: number): number {
  if (outcome !== "partial") return round2(max * POINTS[outcome]);
  if (suggested === undefined || !Number.isFinite(suggested) || max <= 1) return round2(max * POINTS.partial);
  const halves = Math.round(suggested * 2) / 2;
  return round2(Math.min(max - 0.5, Math.max(0.5, halves)));
}

/**
 * Applies the disclosure check to one judgement. "Met" needs every linked fact disclosed; with only
 * some disclosed it becomes "partial"; with none it becomes "not met". Items without linked facts
 * (communication, reasoning) are left to the assessor's judgement.
 */
export function checkAgainstDisclosures(
  item: ScoringItem,
  outcome: Outcome,
  disclosed: Set<string>,
): { outcome: Outcome; adjustment?: string } {
  if (!item.linked_fact_ids.length || outcome === "not_met") return { outcome };
  const found = item.linked_fact_ids.filter((id) => disclosed.has(id)).length;
  if (found === 0) return { outcome: "not_met", adjustment: "The patient never revealed the information this item needs." };
  if (found < item.linked_fact_ids.length && outcome === "met") {
    return { outcome: "partial", adjustment: "Only part of the information this item needs was elicited." };
  }
  return { outcome };
}

export function scoreAssessment(rubric: ScoringRubric, judgements: Judgement[], disclosedFactIds: string[]): Scored {
  const byKey = new Map(judgements.map((j) => [j.key, j]));
  const disclosed = new Set(disclosedFactIds);

  const items: ItemScore[] = rubric.items.map((item) => {
    const j = byKey.get(item.key);
    const checked = j ? checkAgainstDisclosures(item, j.outcome, disclosed) : { outcome: "not_met" as const, adjustment: "Not assessed." };
    return {
      key: item.key,
      domain: item.domain,
      label: item.label,
      outcome: checked.outcome,
      // A disclosure-check downgrade leaves the assessor's number behind: it was for a better outcome.
      points: pointsFor(item.max_points, checked.outcome, checked.adjustment ? undefined : j?.points),
      max: item.max_points,
      evidence: j?.evidence ?? "",
      is_critical: item.is_critical,
      adjustment: checked.adjustment,
    };
  });

  const domainMap = new Map<string, { score: number; max: number }>();
  for (const i of items) {
    const d = domainMap.get(i.domain) ?? { score: 0, max: 0 };
    d.score += i.points;
    d.max += i.max;
    domainMap.set(i.domain, d);
  }
  const domains: DomainScore[] = [...domainMap].map(([domain, d]) => ({
    domain,
    score: round2(d.score),
    max: round2(d.max),
    pct: round2((d.score / d.max) * 100),
  }));

  // Weighted mean of domain percentages, over the weighted domains this rubric actually has items for.
  // Rubrics without domain weights (author-supplied mark schemes) score total marks over total available.
  let weighted = 0;
  let weightSum = 0;
  for (const d of domains) {
    const w = rubric.domain_weights[d.domain] ?? 0;
    weighted += w * d.pct;
    weightSum += w;
  }
  const totalMax = items.reduce((n, i) => n + i.max, 0);
  const overallPct = Object.keys(rubric.domain_weights).length
    ? weightSum > 0
      ? round2(weighted / weightSum)
      : 0
    : totalMax > 0
      ? round2((items.reduce((n, i) => n + i.points, 0) / totalMax) * 100)
      : 0;

  const criticalMissed = items.filter((i) => i.is_critical && i.outcome === "not_met").map((i) => i.key);
  return { items, domains, overallPct, passed: overallPct >= rubric.pass_mark && criticalMissed.length === 0, criticalMissed };
}
