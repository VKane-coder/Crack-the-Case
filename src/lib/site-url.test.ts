import { describe, expect, it } from "vitest";
import { authSiteUrl } from "./site-url";

describe("authSiteUrl", () => {
  it("uses the preview's own branch URL on Vercel previews", () => {
    expect(authSiteUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "app-git-x-team.vercel.app", VERCEL_URL: "app-abc.vercel.app" } as never)).toBe(
      "https://app-git-x-team.vercel.app",
    );
    expect(authSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "app-abc.vercel.app" } as never)).toBe("https://app-abc.vercel.app");
  });

  it("uses NEXT_PUBLIC_SITE_URL in production and locally", () => {
    expect(authSiteUrl({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: "app-git-main.vercel.app" } as never)).toBe(
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    );
  });
});
