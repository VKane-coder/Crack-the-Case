import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { avatarAvailable, endAvatarSession, startAvatarSession, viewerAccess } = await import("./lemonslice");

const KEYS = {
  LEMONSLICE_API_KEY: "ls-secret",
  LIVEKIT_URL: "wss://crack-the-case.livekit.cloud",
  LIVEKIT_API_KEY: "lk-key",
  LIVEKIT_API_SECRET: "lk-secret-that-is-long-enough-for-hs256",
};

/** The grants inside a LiveKit pass (a JWT). */
function grants(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as {
    sub: string;
    video: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean };
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  for (const [k, v] of Object.entries(KEYS)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("avatarAvailable", () => {
  it("needs all four keys, and stays off in e2e runs", () => {
    expect(avatarAvailable()).toBe(true);
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    expect(avatarAvailable()).toBe(false);
    vi.stubEnv("LIVEKIT_API_SECRET", KEYS.LIVEKIT_API_SECRET);
    vi.stubEnv("VOICE_PROVIDERS", "fake");
    expect(avatarAvailable()).toBe(false);
  });
});

describe("startAvatarSession", () => {
  it("asks LemonSlice for a cartoon avatar fed over WebSocket and published into the station's room", async () => {
    fetchMock.mockResolvedValue(Response.json({ session_id: "s-1", websocket_address: "wss://ls/s-1", control_url: "x" }));
    const session = await startAvatarSession("abc", "https://storage/jeanie.png?token=t");
    expect(session).toEqual({ sessionId: "s-1", websocketAddress: "wss://ls/s-1", room: "station-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://lemonslice.com/api/liveai/sessions");
    expect(init.headers["X-API-Key"]).toBe("ls-secret");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      transport_type: "websocket-livekit",
      agent_image_url: "https://storage/jeanie.png?token=t",
      model: "cartoon",
      aspect_ratio: "2x3",
      audio_sample_rate: 16000,
      idle_timeout: 600,
      livekit_properties: { livekit_url: KEYS.LIVEKIT_URL },
    });
    // LemonSlice's pass may publish the face into this station's room only.
    expect(grants(body.livekit_properties.livekit_token)).toMatchObject({
      sub: "lemonslice-avatar",
      video: { room: "station-abc", roomJoin: true, canPublish: true },
    });
    // The secret key goes in the header, never in the body.
    expect(init.body).not.toContain("ls-secret");
  });

  it("reports LemonSlice's reason when it refuses", async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: "subscription inactive" }, { status: 402 }));
    await expect(startAvatarSession("abc", "https://img")).rejects.toThrow(/HTTP 402.*subscription inactive/);
  });
});

describe("viewerAccess", () => {
  it("gives the student a watch-only pass for their own station's room, and no keys", async () => {
    const access = await viewerAccess("abc", "user-1", { sessionId: "s-1", websocketAddress: "wss://ls/s-1", room: "station-abc" });
    expect(access.livekitUrl).toBe(KEYS.LIVEKIT_URL);
    expect(access.websocketAddress).toBe("wss://ls/s-1");
    expect(grants(access.token)).toMatchObject({
      sub: "student-user-1",
      video: { room: "station-abc", roomJoin: true, canPublish: false, canSubscribe: true },
    });
    const sent = JSON.stringify(access);
    for (const secret of [KEYS.LEMONSLICE_API_KEY, KEYS.LIVEKIT_API_SECRET]) expect(sent).not.toContain(secret);
  });
});

describe("endAvatarSession", () => {
  it("sends terminate to the session's control endpoint", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await endAvatarSession("s-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://lemonslice.com/api/liveai/sessions/s-1/control");
    expect(JSON.parse(init.body)).toEqual({ event: "terminate" });
    expect(init.headers["X-API-Key"]).toBe("ls-secret");
  });

  it("never throws, so a station can always move on", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(endAvatarSession("s-1")).resolves.toBeUndefined();
  });
});
