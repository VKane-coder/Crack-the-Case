import { NextResponse } from "next/server";
import { AvatarError } from "@/server/avatar/lemonslice";
import { errorBody, stationRoute } from "@/server/station/http";
import { closeAvatarFor, openAvatar } from "@/server/station/orchestrator";

export const maxDuration = 60;

// POST {} → { data: { livekitUrl, token, websocketAddress } | null }
// The patient's animated face for this station: a watch-only LiveKit pass and the address the browser
// feeds the patient's speech to. null when the avatar isn't set up or the case has no picture.
// If LemonSlice refuses (e.g. no active subscription), the reason comes back so previews can show it;
// the station carries on with voice only.
export const POST = stationRoute<{ id: string }>(async ({ user, params }) => {
  try {
    return NextResponse.json({ data: await openAvatar(user.id, params.id) });
  } catch (err) {
    if (!(err instanceof AvatarError)) throw err;
    console.warn("avatar unavailable", { message: err.message });
    return NextResponse.json(errorBody("avatar_unavailable", err.message, true), { status: 503 });
  }
});

// DELETE {} → { data: null }. Sent as the station page closes (tab closed, navigated away, reloaded),
// so the face stops at once instead of running until LemonSlice's idle timeout.
export const DELETE = stationRoute<{ id: string }>(async ({ user, params }) => {
  await closeAvatarFor(user.id, params.id);
  return NextResponse.json({ data: null });
});
