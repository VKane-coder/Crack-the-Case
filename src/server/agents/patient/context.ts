import type Anthropic from "@anthropic-ai/sdk";
import type { PatientView } from "@/server/cases/projector";
import { PERSONA_PROFILES } from "./persona";
import { ROLE_CONTRACT } from "./prompts/role-contract";

// Builds the patient agent's request from the patient view only (never the full case; see the
// lint rule in eslint.config.mjs). Layer order runs from most to least shared so the cache prefix
// stays stable: role contract → persona → patient script → conversation → per-turn station state.

export type ChatTurn = { role: "student" | "patient"; content: string };

export type StationState = { elapsedSeconds: number; limitSeconds: number; disclosedFactIds: string[] };

export const MARK_DISCLOSED_TOOL = "mark_disclosed";

/** The stage direction that stands in for the student's greeting before the opening statement. */
export const CONSULTATION_START = "(The consultation begins. The doctor greets you and asks what brings you in today.)";

export function patientScript(view: PatientView): string {
  const lines = [
    `Your script`,
    `You are ${view.name}, ${view.age}, ${view.sex}${view.pronouns ? ` (${view.pronouns})` : ""}. Occupation: ${view.occupation}.`,
  ];
  if (view.background) lines.push(`Background: ${view.background}`);
  lines.push(`How you come across: ${view.persona_notes}`);
  lines.push(``, `Why you're here, in your own words:`);
  for (const [k, v] of Object.entries(view.presenting_complaint)) lines.push(`- ${k}: ${v}`);
  lines.push(``, `Facts about you (id, area, disclosure rule: what you would say):`);
  for (const f of view.facts) {
    const cue = f.prompt ? ` (when asked something like "${f.prompt}")` : "";
    lines.push(`- ${f.id} [${f.category}, ${f.disclosure}]${cue}: ${f.content}`);
  }
  lines.push(
    ``,
    `Your own ideas, concerns and expectations:`,
    `- Ideas: ${view.ice.ideas}`,
    `- Concerns: ${view.ice.concerns}`,
    `- Expectations: ${view.ice.expectations}`,
  );
  if (view.behaviour_rules.length) {
    lines.push(``, `How you behave:`);
    for (const r of view.behaviour_rules) lines.push(`- ${r}`);
  }
  lines.push(``, `You have already opened the consultation by saying: "${view.opening_statement}"`);
  return lines.join("\n");
}

export function markDisclosedTool(view: PatientView): Anthropic.Beta.BetaTool {
  return {
    name: MARK_DISCLOSED_TOOL,
    description:
      "Record which facts from your script you revealed in the reply you just spoke. Call once per reply, after speaking, with an empty list if you revealed none. This is silent bookkeeping; the student never sees it.",
    input_schema: {
      type: "object",
      properties: {
        fact_ids: {
          type: "array",
          items: { type: "string", enum: view.facts.map((f) => f.id) },
          description: "Ids of the script facts revealed in this reply.",
        },
      },
      required: ["fact_ids"],
      additionalProperties: false,
    },
    // Streamed requests with client tools stream tool input as generated; we validate it ourselves.
    eager_input_streaming: true,
  };
}

function fmt(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function stationStateNote(state: StationState): string {
  const revealed = state.disclosedFactIds.length ? state.disclosedFactIds.join(", ") : "none yet";
  return `Station clock: ${fmt(state.elapsedSeconds)} of ${fmt(state.limitSeconds)} elapsed. Facts you have already revealed: ${revealed}.`;
}

export type PatientRequest = {
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
};

/**
 * @param history every turn after the opening statement, oldest first; the last turn is the student's.
 * @param correction optional operator note for a regeneration (guardrail retry), appended after the state.
 */
export function buildPatientRequest(view: PatientView, history: ChatTurn[], state: StationState, correction?: string): PatientRequest {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: ROLE_CONTRACT },
    { type: "text", text: PERSONA_PROFILES[view.persona] },
    { type: "text", text: patientScript(view), cache_control: { type: "ephemeral" } },
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: CONSULTATION_START },
    { role: "assistant", content: view.opening_statement },
    ...history.map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role === "student" ? "user" : "assistant", content: t.content })),
  ];

  // Second breakpoint on the latest student turn: next turn's request re-reads everything up to here.
  const last = messages.at(-1);
  if (last?.role === "user" && typeof last.content === "string") {
    messages[messages.length - 1] = {
      role: "user",
      content: [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }],
    };
  }

  // Volatile per-turn state goes after the last breakpoint, as an operator (system) message.
  const notes = [stationStateNote(state), correction].filter(Boolean).join("\n\n");
  messages.push({ role: "system", content: notes });

  return { system, tools: [markDisclosedTool(view)], messages };
}
