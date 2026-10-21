import { NextResponse } from "next/server";
import { beginPresentation } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

// POST → history_ended → presentation. Returns the server's deadline.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  return NextResponse.json({ data: await beginPresentation(user.id, params.id) });
});
