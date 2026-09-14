import { createClient } from "@supabase/supabase-js";

/**
 * Sends a passwordless magic-link email using Supabase's OWN email service
 * (so no third-party mailer like Resend is involved — configure custom SMTP in
 * Supabase → Auth → SMTP for production delivery).
 *
 * Why a dedicated client with the IMPLICIT flow:
 *   These links are generated on a customer's behalf by staff, not in the
 *   recipient's browser. PKCE would need a `code_verifier` created in the
 *   recipient's browser, which never happens here. Forcing the implicit flow
 *   makes Supabase email a `/auth/v1/verify` link that returns the session
 *   tokens in the URL hash, so it works no matter who clicks it. The app's
 *   browser client picks the tokens up via `detectSessionInUrl`.
 *
 * `shouldCreateUser: false` — the auth account is always created first (by the
 * customer/affiliate create routes), so this only ever emails an existing user
 * and never silently creates a stray account.
 */
function getOtpClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return createClient(url, anon, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * The site's origin with any trailing slash stripped, so a path can be appended
 * without producing a doubled `//`.
 */
function siteOrigin(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://puramass.com";
  return base.replace(/\/+$/, "");
}

export async function sendSupabaseMagicLink(
  email: string,
  redirectPath: string = "/account/dashboard",
): Promise<{ success: boolean; error?: string }> {
  const to = (email ?? "").trim().toLowerCase();
  // Guest records use a synthetic @aminocan.local address and have no inbox.
  if (!to || to.endsWith("@aminocan.local")) {
    return { success: false, error: "No real email address on file" };
  }

  const { error } = await getOtpClient().auth.signInWithOtp({
    email: to,
    options: {
      // The "Magic Link" template links to a bare `{{ .ConfirmationURL }}`, so
      // this flow owns its destination path (unlike the recovery one below).
      emailRedirectTo: `${siteOrigin()}${redirectPath}`,
      shouldCreateUser: false,
    },
  });

  if (error) {
    console.error("[magic-link] Supabase signInWithOtp failed", {
      to,
      status: (error as any).status,
      message: error.message,
    });
    return { success: false, error: error.message };
  }

  console.log("[magic-link] Supabase magic-link email queued", { to });
  return { success: true };
}

/**
 * Sends a password-reset (recovery) email using Supabase's OWN email service —
 * the staff-initiated twin of the customer-facing /forgot-password form.
 *
 * Uses the same implicit-flow client as the magic link above and for the same
 * reason: the link is generated on the user's behalf by an admin, so there is
 * no `code_verifier` in the recipient's browser for PKCE to match against.
 * The recovery link therefore returns its tokens in the URL hash and works for
 * whoever opens it in the mailbox.
 *
 * The recipient lands on `/account/set-password`, which writes the new password
 * against the recovery session the link established. That path is NOT set here:
 * the Supabase "Reset Password" template appends `/account/set-password` to
 * `{{ .ConfirmationURL }}` itself (see docs/supabase-auth-email-templates.md),
 * and the suffix lands on the end of the `redirect_to` the URL carries. So this
 * sends the bare origin — sending the path on both sides is what produced the
 * doubled `/account/set-password/account/set-password` landing URL. Change the
 * destination in the dashboard template, not here.
 */
export async function sendSupabasePasswordReset(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const to = (email ?? "").trim().toLowerCase();
  // Guest records use a synthetic @aminocan.local address and have no inbox.
  if (!to || to.endsWith("@aminocan.local")) {
    return { success: false, error: "No real email address on file" };
  }

  const { error } = await getOtpClient().auth.resetPasswordForEmail(to, {
    redirectTo: siteOrigin(),
  });

  if (error) {
    console.error("[password-reset] Supabase resetPasswordForEmail failed", {
      to,
      status: (error as any).status,
      message: error.message,
    });
    return { success: false, error: error.message };
  }

  console.log("[password-reset] Supabase recovery email queued", { to });
  return { success: true };
}
