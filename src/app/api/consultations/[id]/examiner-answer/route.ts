import { NextResponse } from "next/server";
import { answerQuestion } from "@/server/station/examination";
import { stationRoute } from "@/server/station/http";

// POST { ord, answer } → stores the answer; returns the next question, or question: null when done.
export const POST = stationRoute<{ id: string }>(async ({ user, params, body }) => {
  const result = await answerQuestion(user.id, params.id, { ord: Number(body.ord), answer: String(body.answer ?? "") });
  return NextResponse.json({ data: result });
});
