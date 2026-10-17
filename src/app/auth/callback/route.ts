import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// OAuth (Google) returns here with ?code=… to exchange for a session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.warn("auth.exchangeCodeForSession failed", { code: error.code });
  }
  const reason = searchParams.get("error") ? "oauth_cancelled" : "link_expired";
  return NextResponse.redirect(new URL(`/login?error=${reason}&next=${encodeURIComponent(next)}`, origin));
}
