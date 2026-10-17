import { NextResponse } from "next/server";
import { stationRoute } from "@/server/station/http";
import { patientAvailable } from "@/server/station/llm";
import { StationError, startConsultation } from "@/server/station/orchestrator";

// POST { caseSlug } → { data: { id } }. Abandons any station already in progress.
export const POST = stationRoute<object>(async ({ user, body }) => {
  if (typeof body.caseSlug !== "string" || !/^[a-z0-9-]{1,100}$/.test(body.caseSlug)) {
    throw new StationError("invalid_input", "Pick a case to start.");
  }
  if (!patientAvailable()) throw new StationError("unavailable", "Patients aren't available right now. Please try again later.");
  const id = await startConsultation(user.id, body.caseSlug);
  return NextResponse.json({ data: { id } }, { status: 201 });
});
