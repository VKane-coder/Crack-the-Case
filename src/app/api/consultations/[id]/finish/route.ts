import { after, NextResponse } from "next/server";
import { finishStation, runAssessment } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

// Marking can take a minute or two on the most capable model.
export const maxDuration = 300;

// POST → examiner_questions → assessing; marking runs after the response. Poll GET /result.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  const result = await finishStation(user.id, params.id);
  after(() => runAssessment(user.id, params.id));
  return NextResponse.json({ data: result }, { status: 202 });
});
