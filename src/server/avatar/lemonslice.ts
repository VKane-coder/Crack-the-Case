import "server-only";
import { AccessToken } from "livekit-server-sdk";
import { AVATAR_IDENTITY, AVATAR_SAMPLE_RATE, type AvatarAccess } from "@/features/station/avatar-protocol";
import { voiceFake } from "@/server/voice/config";

// The patient's animated face (LemonSlice, docs/architecture.md §8). LemonSlice turns the patient's
// ElevenLabs speech into lip-synced video and publishes it into a LiveKit room that the student's
// browser watches. Claude, Deepgram and ElevenLabs are unchanged: LemonSlice is the face only.
//
// Keys stay here. The browser gets a subscribe-only LiveKit pass for its own station's room and the
// session's audio address (which can only feed audio to that one avatar), never an API key.
// https://lemonslice.com/docs/websocket

const SESSIONS_URL = "https://lemonslice.com/api/liveai/sessions";
// Long enough for a student to think between questions (the idle timer resets while the avatar talks);
// the session is also ended explicitly when the patient stage ends, so this is only a backstop.
const IDLE_TIMEOUT_SECONDS = 600;

export function avatarAvailable() {
  if (voiceFake()) return false; // e2e runs use silent stand-ins, not a real avatar
  return ["LEMONSLICE_API_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"].every((k) => Boolean(process.env[k]));
}

/** What a station keeps about its avatar (consultations.client_meta.avatar). Written by the server only. */
export type AvatarSession = {
  sessionId: string;
  websocketAddress: string;
  room: string;
};

export class AvatarError extends Error {}

const roomFor = (consultationId: string) => `station-${consultationId}`;

function livekit() {
  return {
    url: process.env.LIVEKIT_URL!,
    key: process.env.LIVEKIT_API_KEY!,
    secret: process.env.LIVEKIT_API_SECRET!,
  };
}

/** A LiveKit pass for one room: LemonSlice's lets it publish the avatar; the student's only lets them watch. */
async function roomToken(room: string, identity: string, role: "avatar" | "viewer") {
  const { key, secret } = livekit();
  const token = new AccessToken(key, secret, {
    identity,
    ttl: role === "avatar" ? "1h" : "15m",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: role === "avatar",
    canPublishData: role === "avatar",
    canSubscribe: true,
  });
  return token.toJwt();
}

/** The student's way in to their station's avatar: a watch-only room pass and the session's speech address. */
export async function viewerAccess(consultationId: string, userId: string, session: AvatarSession): Promise<AvatarAccess> {
  return {
    livekitUrl: livekit().url,
    token: await roomToken(roomFor(consultationId), `student-${userId}`, "viewer"),
    websocketAddress: session.websocketAddress,
  };
}

/**
 * Starts the avatar for a station from the patient's picture. imageUrl must be reachable by
 * LemonSlice (a signed storage link is fine). A cold start can queue for a couple of minutes,
 * so stations start it during reading time.
 */
export async function startAvatarSession(consultationId: string, imageUrl: string): Promise<AvatarSession> {
  const room = roomFor(consultationId);
  const res = await fetch(SESSIONS_URL, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.LEMONSLICE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transport_type: "websocket-livekit",
      agent_image_url: imageUrl,
      model: process.env.LEMONSLICE_MODEL || "cartoon",
      aspect_ratio: "2x3", // the only ratio the cartoon model supports
      audio_sample_rate: AVATAR_SAMPLE_RATE,
      idle_timeout: IDLE_TIMEOUT_SECONDS,
      agent_prompt: "a patient talking to their doctor",
      agent_idle_prompt: "a patient listening to their doctor",
      livekit_properties: {
        livekit_url: livekit().url,
        livekit_token: await roomToken(room, AVATAR_IDENTITY, "avatar"),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as {
    session_id?: string;
    websocket_address?: string;
    detail?: unknown;
  } | null;
  if (!res.ok || !body?.session_id || !body.websocket_address) {
    throw new AvatarError(`LemonSlice session failed (HTTP ${res.status}): ${JSON.stringify(body?.detail ?? body).slice(0, 200)}`);
  }
  return {
    sessionId: body.session_id,
    websocketAddress: body.websocket_address,
    room,
  };
}

/** Ends the avatar (and its billing). Never throws: the idle timeout is the backstop. */
export async function endAvatarSession(sessionId: string) {
  try {
    const res = await fetch(`${SESSIONS_URL}/${encodeURIComponent(sessionId)}/control`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.LEMONSLICE_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "terminate" }),
      signal: AbortSignal.timeout(5_000),
    });
    // 404: already over (idle timeout, or the browser terminated it first).
    if (!res.ok && res.status !== 404)
      console.warn("avatar terminate failed", {
        sessionId,
        status: res.status,
      });
  } catch (err) {
    console.warn("avatar terminate failed", {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
