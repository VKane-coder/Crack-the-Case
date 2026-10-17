"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authSiteUrl } from "@/lib/site-url";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export type AuthActionResult = { ok: true } | { ok: false; error: string };

const emailSchema = z.email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);

function friendlyAuthError(error: { status?: number; code?: string; message: string }): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "Whoa, that's a lot of emails! Give it a minute, then try again.";
  }
  if (error.code === "otp_expired") return "That code has expired. Ask for a fresh one and try again.";
  if (error.code === "otp_disabled" || error.code === "signup_disabled") return "Sign-ups are paused right now. Please try later.";
  return "Something went wrong on our side. Please try again.";
}

export async function sendEmailLink(input: { email: string; next?: string }): Promise<AuthActionResult> {
  const email = emailSchema.safeParse(input.email.trim().toLowerCase());
  if (!email.success) return { ok: false, error: "That email doesn't look quite right." };

  const redirectTo = new URL("/auth/confirm", authSiteUrl());
  redirectTo.searchParams.set("next", safeNext(input.next));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: redirectTo.toString(), shouldCreateUser: true },
  });
  if (error) {
    console.error("auth.signInWithOtp failed", { code: error.code, status: error.status });
    return { ok: false, error: friendlyAuthError(error) };
  }
  return { ok: true };
}

export async function verifyEmailCode(input: { email: string; code: string; next?: string }): Promise<AuthActionResult> {
  const email = emailSchema.safeParse(input.email.trim().toLowerCase());
  const code = codeSchema.safeParse(input.code.replace(/\s/g, ""));
  if (!email.success || !code.success) return { ok: false, error: "Enter the 6-digit code from your email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error) {
    if (error.code === "otp_expired" || error.status === 403) {
      return { ok: false, error: "That code didn't work. It may have expired, so check it or ask for a new one." };
    }
    return { ok: false, error: friendlyAuthError(error) };
  }
  redirect(safeNext(input.next));
}
