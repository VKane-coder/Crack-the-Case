import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link_expired: "That link has gone a bit stale. Pop your email in and we'll send a fresh one.",
  oauth_cancelled: "Google sign-in didn't finish. Want to give it another go?",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(params.next));
  const error = ERRORS[one(params.error) ?? ""];
  let googleEnabled = false;
  try {
    googleEnabled = publicEnv().NEXT_PUBLIC_AUTH_GOOGLE_ENABLED;
  } catch {
    // Supabase not configured yet; the form still renders and reports errors on submit.
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10 [background:var(--hub-gradient)]">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 block text-center text-2xl font-black">
          Crack the <span className="text-brand-purple">Case</span>
        </Link>
        <LoginForm next={next} initialError={error} googleEnabled={googleEnabled} />
        <p className="text-muted-foreground mt-6 text-center text-xs">
          By continuing you agree to our terms and privacy policy. Crack the Case is a study tool, not medical advice.
        </p>
      </div>
    </main>
  );
}
