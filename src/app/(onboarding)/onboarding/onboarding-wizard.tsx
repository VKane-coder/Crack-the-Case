"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, Lock, Minus, Plus } from "lucide-react";
import { Celebration } from "@/components/game/celebration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DAILY_GOAL_OPTIONS,
  EXAM_TYPES,
  ONBOARDING_STEPS,
  daysUntil,
  type OnboardingStep,
  type StepData,
} from "@/features/onboarding/schema";
import { cn } from "@/lib/utils";
import { completeOnboarding, saveOnboardingStep } from "./actions";

export type AvatarOption = {
  id: string;
  name: string;
  emoji: string;
  rarity: string;
  locked: boolean;
  unlockHint?: string;
};
export type SpecialtyOption = { slug: string; name: string; colour_token: string };

type Draft = {
  display_name: string;
  avatar_id: string;
  daily_goal_cases: number;
  weekly_goal_cases: number;
  exam_type: StepData["exam"]["exam_type"] | null;
  exam_date: string | null;
  target_specialties: string[];
};

const HEADINGS: Record<OnboardingStep, { title: string; subtitle: string }> = {
  avatar: { title: "Choose your avatar", subtitle: "This little legend will cheer you on through every case." },
  goals: { title: "Set your learning goal", subtitle: "Little and often beats cramming. You can change this anytime." },
  exam: { title: "When's your exam?", subtitle: "We'll pace your practice so you peak at the right time." },
  specialties: { title: "Pick your specialties", subtitle: "We'll recommend cases from these first." },
};

export function OnboardingWizard({
  avatars,
  specialties,
  initial,
  initialStep = 0,
}: {
  avatars: AvatarOption[];
  specialties: SpecialtyOption[];
  initial: Draft;
  initialStep?: number;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(initialStep);
  const [direction, setDirection] = useState(1);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ xp: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const step = ONBOARDING_STEPS[stepIndex];
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const stepPayload = (): StepData[OnboardingStep] => {
    switch (step) {
      case "avatar":
        return { display_name: draft.display_name, avatar_id: draft.avatar_id };
      case "goals":
        return { daily_goal_cases: draft.daily_goal_cases, weekly_goal_cases: draft.weekly_goal_cases };
      case "exam":
        return { exam_type: draft.exam_type ?? "other", exam_date: draft.exam_date };
      case "specialties":
        return { target_specialties: draft.target_specialties };
    }
  };

  const canContinue =
    (step === "avatar" && draft.display_name.trim().length > 0 && Boolean(draft.avatar_id)) ||
    step === "goals" ||
    (step === "exam" && draft.exam_type !== null) ||
    (step === "specialties" && draft.target_specialties.length > 0);

  const next = () =>
    startTransition(async () => {
      setError(undefined);
      const saved = await saveOnboardingStep(step, stepPayload());
      if (!saved.ok) return setError(saved.error);
      if (stepIndex < ONBOARDING_STEPS.length - 1) {
        setDirection(1);
        setStepIndex((i) => i + 1);
        return;
      }
      const result = await completeOnboarding({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (!result.ok) return setError(result.error);
      setDone({ xp: result.xpAwarded });
    });

  const back = () => {
    setError(undefined);
    setDirection(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  if (done) {
    const avatar = avatars.find((a) => a.id === draft.avatar_id);
    return (
      <Shell>
        <Celebration
          xp={done.xp}
          title={`You're all set, ${draft.display_name.trim()}!`}
          subtitle="Your first patient is waiting. Let's crack that first case."
        >
          {avatar && (
            <div className="bg-card grid size-20 place-items-center rounded-full text-5xl shadow-md" aria-hidden>
              {avatar.emoji}
            </div>
          )}
          <Button variant="reward" size="lg" onClick={() => router.push("/hub")}>
            Take me to my hub
          </Button>
        </Celebration>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          disabled={stepIndex === 0 || pending}
          aria-label="Back"
          className="text-muted-foreground hover:bg-muted grid size-10 shrink-0 place-items-center rounded-xl disabled:invisible"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="flex flex-1 gap-1.5" aria-label={`Step ${stepIndex + 1} of ${ONBOARDING_STEPS.length}`}>
          {ONBOARDING_STEPS.map((s, i) => (
            <div key={s} className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
              <motion.div
                className="from-brand-teal to-brand-blue h-full rounded-full bg-gradient-to-r"
                initial={false}
                animate={{ width: i <= stepIndex ? "100%" : "0%" }}
                transition={{ duration: 0.4 }}
              />
            </div>
          ))}
        </div>
        <span className="text-muted-foreground w-10 text-right text-sm font-bold tabular-nums">
          {stepIndex + 1}/{ONBOARDING_STEPS.length}
        </span>
      </div>

      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.section
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: 40 * direction }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 * direction }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-6"
        >
          <header>
            <h1 className="text-2xl font-black sm:text-3xl">{HEADINGS[step].title}</h1>
            <p className="text-muted-foreground mt-1">{HEADINGS[step].subtitle}</p>
          </header>

          {step === "avatar" && <AvatarStep draft={draft} update={update} avatars={avatars} />}
          {step === "goals" && <GoalsStep draft={draft} update={update} />}
          {step === "exam" && <ExamStep draft={draft} update={update} />}
          {step === "specialties" && <SpecialtiesStep draft={draft} update={update} specialties={specialties} />}
        </motion.section>
      </AnimatePresence>

      <div className="from-background via-background/95 sticky bottom-0 mt-8 flex flex-col gap-3 bg-gradient-to-t to-transparent pt-4 pb-4">
        {error && (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-xl p-3 text-center text-sm font-semibold">
            {error}
          </p>
        )}
        <Button variant="reward" size="lg" onClick={next} disabled={!canContinue || pending}>
          {pending && <Loader2 className="animate-spin" />}
          {stepIndex === ONBOARDING_STEPS.length - 1 ? "Finish setup" : "Continue"}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh [background:var(--hub-gradient)]">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-6 sm:pt-12">{children}</div>
    </main>
  );
}

type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void };

function AvatarStep({ draft, update, avatars }: StepProps & { avatars: AvatarOption[] }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="display_name" className="text-sm font-bold">
          What should we call you?
        </label>
        <Input
          id="display_name"
          value={draft.display_name}
          maxLength={40}
          autoComplete="given-name"
          placeholder="Your first name or a nickname"
          onChange={(e) => update({ display_name: e.target.value })}
        />
      </div>
      <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-3 gap-3">
        {avatars.map((a) => {
          const selected = draft.avatar_id === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={a.locked ? `${a.name} (locked: ${a.unlockHint})` : a.name}
              disabled={a.locked}
              onClick={() => update({ avatar_id: a.id })}
              className={cn(
                "bg-card relative flex flex-col items-center gap-1 rounded-2xl border-2 p-3 transition-all",
                selected ? "border-brand-purple ring-brand-purple/15 scale-[1.03] shadow-md ring-4" : "hover:border-primary/40",
                a.locked && "cursor-not-allowed opacity-60",
              )}
            >
              <span className={cn("text-4xl", a.locked && "grayscale")} aria-hidden>
                {a.emoji}
              </span>
              <span className="text-xs leading-tight font-bold">{a.name}</span>
              {a.locked && (
                <span className="text-muted-foreground flex items-center gap-1 text-[10px] font-semibold">
                  <Lock className="size-3" /> {a.unlockHint}
                </span>
              )}
              {selected && (
                <span className="bg-brand-purple absolute -top-2 -right-2 grid size-6 place-items-center rounded-full text-white">
                  <Check className="size-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function GoalsStep({ draft, update }: StepProps) {
  return (
    <>
      <div role="radiogroup" aria-label="Daily goal" className="grid grid-cols-2 gap-3">
        {DAILY_GOAL_OPTIONS.map((o) => {
          const selected = draft.daily_goal_cases === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() =>
                update({
                  daily_goal_cases: o.value,
                  weekly_goal_cases: Math.min(50, Math.max(draft.weekly_goal_cases, o.value * 5)),
                })
              }
              className={cn(
                "bg-card flex flex-col items-start gap-1 rounded-2xl border-2 p-4 text-left transition-all",
                selected ? "border-brand-teal ring-brand-teal/15 shadow-md ring-4" : "hover:border-primary/40",
              )}
            >
              <span className="text-3xl" aria-hidden>
                {o.emoji}
              </span>
              <span className="font-extrabold">{o.label}</span>
              <span className="text-muted-foreground text-sm">{o.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="bg-card flex items-center justify-between rounded-2xl border-2 p-4">
        <div>
          <div className="font-extrabold">Weekly goal</div>
          <div className="text-muted-foreground text-sm">Cases per week</div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label="Fewer cases per week"
            disabled={draft.weekly_goal_cases <= draft.daily_goal_cases}
            onClick={() => update({ weekly_goal_cases: draft.weekly_goal_cases - 1 })}
          >
            <Minus />
          </Button>
          <span className="w-8 text-center text-2xl font-black tabular-nums" aria-live="polite">
            {draft.weekly_goal_cases}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="More cases per week"
            disabled={draft.weekly_goal_cases >= 50}
            onClick={() => update({ weekly_goal_cases: draft.weekly_goal_cases + 1 })}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </>
  );
}

function ExamStep({ draft, update }: StepProps) {
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const days = draft.exam_date ? daysUntil(draft.exam_date) : null;
  return (
    <>
      <div role="radiogroup" aria-label="Exam type" className="flex flex-col gap-3">
        {EXAM_TYPES.map((t) => {
          const selected = draft.exam_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => update({ exam_type: t.value })}
              className={cn(
                "bg-card flex items-center gap-3 rounded-2xl border-2 p-4 text-left font-extrabold transition-all",
                selected ? "border-brand-blue ring-brand-blue/15 shadow-md ring-4" : "hover:border-primary/40",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {t.emoji}
              </span>
              {t.label}
              {selected && <Check className="text-brand-blue ml-auto size-5" />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="exam_date" className="text-sm font-bold">
          Exam date <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="exam_date"
          type="date"
          min={minDate}
          value={draft.exam_date ?? ""}
          onChange={(e) => update({ exam_date: e.target.value || null })}
        />
        {days !== null && days >= 0 && (
          <p className="bg-brand-purple/10 text-brand-purple rounded-xl p-3 text-center font-bold">
            {days === 0
              ? "It's today! You've got this. 💜"
              : `${days} day${days === 1 ? "" : "s"} to go. Plenty of time to get exam-ready.`}
          </p>
        )}
        {draft.exam_date === null && <p className="text-muted-foreground text-sm">No date yet? No worries, you can add it later.</p>}
      </div>
    </>
  );
}

function SpecialtiesStep({ draft, update, specialties }: StepProps & { specialties: SpecialtyOption[] }) {
  const toggle = (slug: string) =>
    update({
      target_specialties: draft.target_specialties.includes(slug)
        ? draft.target_specialties.filter((s) => s !== slug)
        : [...draft.target_specialties, slug],
    });
  return (
    <div className="flex flex-wrap gap-2.5" role="group" aria-label="Specialties">
      {specialties.map((s) => {
        const selected = draft.target_specialties.includes(s.slug);
        return (
          <button
            key={s.slug}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(s.slug)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border-2 px-4 py-2.5 font-bold transition-all",
              selected ? "border-brand-teal bg-brand-teal text-white shadow-md" : "bg-card hover:border-primary/40",
            )}
          >
            {selected && <Check className="size-4" />}
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
