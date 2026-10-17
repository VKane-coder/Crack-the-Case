import { NextResponse } from "next/server";
import { stationRoute } from "@/server/station/http";
import { beginHistory } from "@/server/station/orchestrator";

// POST → briefing → history. Returns the server's deadline; the client clock only displays it.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  return NextResponse.json({ data: await beginHistory(user.id, params.id) });
});
