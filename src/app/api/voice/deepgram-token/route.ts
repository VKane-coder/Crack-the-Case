import { NextResponse } from "next/server";
import { sttAvailable, sttSettings, voiceFake } from "@/server/voice/config";
import { mintDeepgramToken, STT_KEYTERMS } from "@/server/voice/deepgram";
import { errorBody, stationRoute } from "@/server/station/http";
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
  let token: Awaited<ReturnType<typeof mintDeepgramToken>>;
  try {
    token = await mintDeepgramToken();
  } catch (err) {
    // Surface Deepgram's status and error code (never the key) so a bad key or missing
    // permission can be diagnosed from the station screen.
    const { statusCode, body: dgBody } = err as { statusCode?: number; body?: { err_code?: string; err_msg?: string } };
    console.error("deepgram token grant failed", { statusCode, err_code: dgBody?.err_code, err_msg: dgBody?.err_msg });
    const code = `deepgram_${statusCode ?? "network"}${dgBody?.err_code ? `_${dgBody.err_code}` : ""}`;
    return NextResponse.json(errorBody(code, "Voice input isn't available right now. You can type instead.", true), { status: 502 });
  }
  return NextResponse.json(
    { data: { provider: "deepgram", ...token, settings } },
    { headers: { "cache-control": "no-store" } },
  );
});
