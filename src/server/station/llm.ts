import "server-only";
import { claudeExaminerLlm } from "@/server/agents/examiner/claude-llm";
import { fakeExaminerLlm, type ExaminerLlm } from "@/server/agents/examiner/llm";
import { claudePatientLlm } from "@/server/agents/patient/claude-llm";
import { fakePatientLlm } from "@/server/agents/patient/fake-llm";
import type { PatientLlm } from "@/server/agents/patient/llm";

/** True when e2e/dev runs asked for the scripted patient. Never honoured on Vercel production. */
export function usingFakePatient() {
  return process.env.PATIENT_LLM === "fake" && process.env.VERCEL_ENV !== "production";
}

export function patientLlm(): PatientLlm {
  return usingFakePatient() ? fakePatientLlm({ chunkDelayMs: 25 }) : claudePatientLlm;
}

/** Whether a real or fake patient can answer right now (the Claude API needs a key). */
export function patientAvailable() {
  return usingFakePatient() || Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The examiner follows the patient: scripted in e2e runs, Claude otherwise. */
export function examinerLlm(): ExaminerLlm {
  return usingFakePatient() ? fakeExaminerLlm : claudeExaminerLlm;
}
