import { publicEnv } from "@/lib/env";

/**
 * The address auth emails should send people back to. On Vercel preview deployments that's the
 * preview itself (its stable branch URL), so signing in on a preview doesn't land you on production;
 * everywhere else it's NEXT_PUBLIC_SITE_URL. Supabase still checks the result against its
 * Redirect URLs allow-list.
 */
export function authSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL_ENV === "preview") {
    const host = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
    if (host) return `https://${host}`;
  }
  return publicEnv().NEXT_PUBLIC_SITE_URL;
}
