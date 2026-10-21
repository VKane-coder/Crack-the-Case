import { NextResponse } from "next/server";
import { addPresentationSegment } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

// POST { text, clientSeq } → stores one part of the presentation (idempotent per clientSeq).
export const POST = stationRoute<{ id: string }>(async ({ user, params, body }) => {
  const result = await addPresentationSegment(user.id, params.id, { text: String(body.text ?? ""), clientSeq: Number(body.clientSeq) });
  return NextResponse.json({ data: result });
});
