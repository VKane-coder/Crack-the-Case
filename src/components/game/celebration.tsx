"use client";

import { useEffect, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import confetti from "canvas-confetti";
import { Sparkles } from "lucide-react";

const BRAND = ["#5b8def", "#14b8a6", "#8b5cf6", "#6ee7b7", "#ff7a6b", "#f5b83d"];

/** Confetti plus an XP count-up. Reused by onboarding now and by post-station results later. */
export function Celebration({ xp, title, subtitle, children }: {
  xp: number;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? xp : 0);

  useEffect(() => {
    if (reduced) return;
    confetti({ particleCount: 140, spread: 75, origin: { y: 0.35 }, colors: BRAND, disableForReducedMotion: true });
    const controls = animate(0, xp, { duration: 1.2, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [xp, reduced]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className="flex flex-col items-center gap-4 text-center"
    >
      <div className="text-6xl" aria-hidden>
        🎉
      </div>
      <h1 className="text-3xl font-black sm:text-4xl">{title}</h1>
      {subtitle && <p className="max-w-sm text-lg text-muted-foreground">{subtitle}</p>}
      {xp > 0 && (
        <div
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-purple to-brand-blue px-5 py-2 text-xl font-black text-white shadow-lg"
          aria-live="polite"
        >
          <Sparkles className="size-5" /> <span className="tabular-nums">+{shown} XP</span>
        </div>
      )}
      {children}
    </motion.div>
  );
}
