"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { sendEmailLink, verifyEmailCode } from "./actions";

type Props = { next: string; initialError?: string; googleEnabled: boolean };

export function LoginForm({ next, initialError, googleEnabled }: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string>();
  const [emailSent, setEmailSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const send = (resend = false) =>
    startTransition(async () => {
      setError(undefined);
      setNotice(undefined);
      const res = await sendEmailLink({ email, next });
      if (!res.ok) return setError(res.error);
      setEmailSent(true);
      setStep("code");
      if (resend) setNotice("Fresh email on its way!");
    });

  const verify = () =>
    startTransition(async () => {
      setError(undefined);
      // On success the action redirects, so we only get a result back on failure.
      const res = await verifyEmailCode({ email, code, next });
      if (res && !res.ok) setError(res.error);
    });

  const google = () =>
    startTransition(async () => {
      setError(undefined);
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", next);
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.toString() },
      });
      if (error) setError("Couldn't reach Google just now. Try email instead?");
    });

  return (
    <Card className="gap-5 p-6 sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="flex flex-col gap-5"
          >
            <div className="text-center">
              <div className="mb-2 text-4xl" aria-hidden>
                🩺
              </div>
              <h1 className="text-2xl font-black">Ready to crack some cases?</h1>
              <p className="text-muted-foreground mt-1">Sign in or create an account. No password needed.</p>
            </div>

            {googleEnabled && (
              <>
                <Button variant="outline" size="lg" onClick={google} disabled={pending}>
                  <GoogleIcon /> Continue with Google
                </Button>
                <div className="text-muted-foreground flex items-center gap-3 text-xs font-bold uppercase">
                  <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
                </div>
              </>
            )}

            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label htmlFor="email" className="text-sm font-bold">
                Email
              </label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@student.uni.edu.au"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(error)}
                required
              />
              <Button type="submit" variant="reward" size="lg" disabled={pending || !email}>
                {pending ? <Loader2 className="animate-spin" /> : null} Email me a sign-in link
              </Button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-sm font-bold disabled:opacity-50"
                disabled={!email || pending}
                onClick={() => {
                  setError(undefined);
                  setEmailSent(false);
                  setStep("code");
                }}
              >
                I already have a code
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            className="flex flex-col gap-5"
          >
            <div className="text-center">
              <div className="bg-brand-teal/15 text-brand-teal mx-auto mb-3 grid size-14 place-items-center rounded-2xl">
                <MailCheck className="size-7" />
              </div>
              <h1 className="text-2xl font-black">{emailSent ? "Check your inbox" : "Enter your code"}</h1>
              <p className="text-muted-foreground mt-1">
                {emailSent ? "We sent a link and a 6-digit code to " : "Type the 6-digit code from your latest sign-in email to "}
                <span className="text-foreground font-bold">{email}</span>
                {emailSent ? ". Tap the link, or type the code here." : "."}
              </p>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                verify();
              }}
            >
              <label htmlFor="code" className="sr-only">
                6-digit code
              </label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                className="text-center text-2xl tracking-[0.5em] tabular-nums"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-invalid={Boolean(error)}
                autoFocus
              />
              <Button type="submit" variant="reward" size="lg" disabled={pending || code.length !== 6}>
                {pending ? <Loader2 className="animate-spin" /> : null} Let&apos;s go
              </Button>
            </form>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 font-bold"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(undefined);
                }}
              >
                <ArrowLeft className="size-4" /> Different email
              </button>
              <button type="button" className="text-primary font-bold" onClick={() => send(emailSent)} disabled={pending}>
                {emailSent ? "Resend email" : "Send me a code"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {notice && !error && <p className="bg-brand-teal/10 text-brand-teal rounded-xl p-3 text-center text-sm font-semibold">{notice}</p>}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-xl p-3 text-center text-sm font-semibold">
          {error}
        </p>
      )}
    </Card>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}
