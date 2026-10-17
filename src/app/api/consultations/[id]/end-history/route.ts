import { NextResponse } from "next/server";
import { stationRoute } from "@/server/station/http";
import { endHistory } from "@/server/station/orchestrator";

// POST → history → history_ended (student ended early, or the clock ran out). Idempotent.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  return NextResponse.json({ data: await endHistory(user.id, params.id) });
});
