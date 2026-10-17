import { NextResponse } from "next/server";
import { sttAvailable, sttSettings, voiceFake } from "@/server/voice/config";
import { mintDeepgramToken, STT_KEYTERMS } from "@/server/voice/deepgram";
import { stationRoute } from "@/server/station/http";
import { requireSpeakingPhase, StationError } from "@/server/station/orchestrator";

// POST { consultationId } → a 30-second Deepgram token plus streaming settings. Only for the
// student's own station while the student is speaking (history, presentation, examiner questions), so the route can't be used as a free token tap.
export const POST = stationRoute<object>(async ({ user, body }) => {
  const id = typeof body.consultationId === "string" ? body.consultationId : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StationError("invalid_input", "Missing station.");
  if (!sttAvailable()) throw new StationError("unavailable", "Voice input isn't available right now. You can type instead.");
  await requireSpeakingPhase(user.id, id);

  const settings = { ...sttSettings(), keyterms: STT_KEYTERMS };
  if (voiceFake()) return NextResponse.json({ data: { provider: "fake", accessToken: "fake", expiresIn: 30, settings } });
  const token = await mintDeepgramToken();
  return NextResponse.json(
    { data: { provider: "deepgram", ...token, settings } },
    { headers: { "cache-control": "no-store" } },
  );
});
