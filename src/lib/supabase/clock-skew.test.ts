import { describe, expect, it, vi } from "vitest";
import { retryClockSkew } from "./clock-skew";

const futureJwt = () => Response.json({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }, { status: 401 });
const ok = () => Response.json([{ id: 1 }]);
const noWait = async () => {};

describe("retryClockSkew", () => {
  it("retries a request rejected because the new token looks like it's from the future", async () => {
    const base = vi.fn().mockResolvedValueOnce(futureJwt()).mockResolvedValueOnce(ok());
    const res = await retryClockSkew(base, noWait)("https://x.supabase.co/rest/v1/profiles", { headers: { a: "b" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(base).toHaveBeenCalledTimes(2);
    expect(base.mock.calls[1]).toEqual(base.mock.calls[0]); // the same request again
  });

  it("gives up after two retries and returns Supabase's answer", async () => {
    const base = vi.fn().mockImplementation(async () => futureJwt());
    const res = await retryClockSkew(base, noWait)("https://x.supabase.co/rest/v1/profiles");
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("leaves every other response alone", async () => {
    const expired = vi.fn().mockResolvedValue(Response.json({ code: "PGRST301", message: "JWT expired" }, { status: 401 }));
    expect((await retryClockSkew(expired, noWait)("u")).status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);

    const fine = vi.fn().mockResolvedValue(ok());
    expect((await retryClockSkew(fine, noWait)("u")).status).toBe(200);
    expect(fine).toHaveBeenCalledTimes(1);
  });
});
