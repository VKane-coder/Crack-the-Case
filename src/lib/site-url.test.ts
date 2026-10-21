import { afterEach, describe, expect, it, vi } from "vitest";
import { authSiteUrl } from "./site-url";

describe("authSiteUrl", () => {
  it("uses the preview's own branch URL on Vercel previews", () => {
    expect(
      authSiteUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "app-git-x-team.vercel.app",
        VERCEL_URL: "app-abc.vercel.app",
      } as never),
    ).toBe("https://app-git-x-team.vercel.app");
    expect(
      authSiteUrl({
        VERCEL_ENV: "preview",
        VERCEL_URL: "app-abc.vercel.app",
      } as never),
    ).toBe("https://app-abc.vercel.app");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses NEXT_PUBLIC_SITE_URL in production and locally", () => {
    // publicEnv() validates the Supabase settings too; CI has none, so stub them.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crackthecase.example");
    expect(
      authSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "app-git-main.vercel.app",
      } as never),
    ).toBe("https://crackthecase.example");
  });
});
