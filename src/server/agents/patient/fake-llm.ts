import { NO_USAGE } from "@/server/agents/shared/models";
import { knownFactIds, type PatientLlm } from "./llm";

// Deterministic stand-in for the Claude API, used by unit tests and e2e runs (PATIENT_LLM=fake).
// It answers with the script fact that best overlaps the student's question, and marks it disclosed.

type Fact = { id: string; content: string };

const STOP = new Set([
  "about",
  "there",
  "their",
  "which",
  "would",
  "could",
  "have",
  "been",
  "with",
  "your",
  "what",
  "when",
  "that",
  "this",
  "does",
  "doing",
  "tell",
  "more",
  "anything",
]);

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );

function lastStudentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : "")).join(" ");
  return "";
}

/** Parses "- id [CAT, tier]: content" lines back out of the patient script. */
function scriptFacts(system: { text: string }[]): Fact[] {
  const script = system.map((b) => b.text).join("\n");
  return [...script.matchAll(/^- ([a-z0-9_]+) \[[^\]]+\]: (.+)$/gm)].map((m) => ({ id: m[1], content: m[2] }));
}

export function fakePatientLlm(opts: { chunkDelayMs?: number } = {}): PatientLlm {
  return {
    async run(req, model, cb, signal) {
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const asked = words(lastStudentText(lastUser?.content));
      const known = new Set(knownFactIds(req));
      let best: Fact | undefined;
      let bestScore = 0;
      for (const f of scriptFacts(req.system)) {
        if (!known.has(f.id)) continue;
        const score = [...words(f.content)].filter((w) => asked.has(w)).length;
        if (score > bestScore) [best, bestScore] = [f, score];
      }
      const reply = best ? `[emotion:neutral] ${best.content}` : "[emotion:confused] Sorry, I'm not sure. What do you mean, doctor?";
      for (const chunk of reply.match(/[\s\S]{1,12}/g) ?? []) {
        if (signal.aborted) throw new Error(String(signal.reason ?? "aborted"));
        cb.onText(chunk);
        if (opts.chunkDelayMs) await new Promise((r) => setTimeout(r, opts.chunkDelayMs));
      }
      return { model: `fake:${model}`, factIds: best ? [best.id] : [], refused: false, usage: NO_USAGE };
    },
  };
}
