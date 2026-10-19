import { NextResponse } from "next/server";
import { endPresentation } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

export const maxDuration = 60;

// POST → presentation → examiner_questions. Returns the first question and how many there are.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  return NextResponse.json({ data: await endPresentation(user.id, params.id) });
});
