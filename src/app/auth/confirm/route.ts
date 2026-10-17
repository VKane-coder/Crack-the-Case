import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

// Our magic-link email points here with ?token_hash=…&type=email. Verifying the hash server-side works
// even when the link opens in a different browser from the one that requested it.
// Also accepts ?code=… (PKCE) in case the default Supabase template is still in use.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next") ?? nextFromRedirectTo(searchParams.get("redirect_to"), origin));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
    if (error) console.warn("auth.verifyOtp(token_hash) failed", { code: error.code });
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error) console.warn("auth.exchangeCodeForSession failed", { code: error.code });
  }

  return NextResponse.redirect(new URL(ok ? next : `/login?error=link_expired&next=${encodeURIComponent(next)}`, origin));
}

function nextFromRedirectTo(redirectTo: string | null, origin: string): string | null {
  if (!redirectTo) return null;
  try {
    const url = new URL(redirectTo);
    return url.origin === origin ? url.searchParams.get("next") : null;
  } catch {
    return null;
  }
}
