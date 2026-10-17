import { after, NextResponse } from "next/server";
import { retryAssessment, runAssessment } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

export const maxDuration = 300;

// POST → assessment_failed → assessing, then marks again in the background.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  const result = await retryAssessment(user.id, params.id);
  after(() => runAssessment(user.id, params.id));
  return NextResponse.json({ data: result }, { status: 202 });
});
