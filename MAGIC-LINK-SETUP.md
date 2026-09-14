# Customer Magic-Link Sign-In

Admins, assistants, and affiliates can email a one-click, passwordless
sign-in link to a customer from **Admin → Customers** (the **Login Link**
button in each row). Affiliates can only send links to customers bound to
them; admins/assistants can send to anyone.

The email is sent by **Supabase's own auth email service** (not a third-party
mailer). For reliable production delivery you must configure **custom SMTP** in
Supabase — see below.

## Account creation → invite + "set your password"

New **customers** (via **Admin → Customers → New Customer**) and new
**affiliates** (via **Admin → Affiliates → Add Affiliate**) are onboarded with
an invite flow:

1. The account is created **without a password** (passwordless).
2. A sign-in link is emailed to them, redirecting to **`/account/set-password`**.
3. Clicking it signs them in and lands them on the **Set your password** page,
   where they choose their own password.
4. After saving, they continue to their destination — `/account/dashboard` for
   customers, `/admin` for affiliates (decided by their role).

Notes:
- If the email can't be sent, the account is still created and the dialog shows
  the exact error; staff can resend from the **Login Link** button.
- The **Login Link** button on the Customers list sends a *straight* sign-in
  link (to `/account/dashboard`) — handy for someone who already has a password.
- **Guest** customers quick-added inline while creating an invoice get no login
  account (synthetic `@aminocan.local` email).

## How it works

Unlike a customer requesting their own magic link, here the link is generated
**on the customer's behalf** by staff. That has one important consequence:

- We must use the **implicit (hash-token) flow**, not PKCE. PKCE requires a
  `code_verifier` created in the *recipient's* browser at the moment they
  request the link — which never happens here. So the send uses a Supabase
  client explicitly configured with `flowType: 'implicit'`, which makes Supabase
  email a `/auth/v1/verify` link that returns the session tokens in the URL
  hash, working no matter who clicks it.

Flow:

1. `POST /api/admin/customers/magic-link` (service role) verifies the caller
   and, for affiliates, that the customer is bound to them.
2. It calls `sendSupabaseMagicLink()` (`lib/admin/magic-link.ts`), which uses an
   implicit-flow anon client to call
   `auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } })`.
   **Supabase generates the link and sends the email itself** via its configured
   SMTP. `shouldCreateUser: false` guarantees it only emails an account that
   already exists.
3. The customer clicks the link → Supabase `/auth/v1/verify` validates it and
   redirects to the target (`/account/dashboard` or `/admin`) with the session
   tokens in the URL hash.
4. The shared browser client (`lib/supabase.ts`, `detectSessionInUrl: true`)
   picks up the tokens and `CustomerContext` signs the customer in.

Guest records (synthetic `@aminocan.local` email) and addresses with no auth
account return a friendly error instead.

## Staff-sent password reset links

Alongside the sign-in link there is a **Reset password** action on **Admin →
Customers** (list rows and the customer detail header) and on **Admin → Sales
People** for affiliates (list rows and the detail header — `/admin/affiliates`
redirects there). It emails the user a Supabase **recovery** link so they can
choose a new password themselves; staff never see or set the password.

Use it when someone is locked out and wants a password again — the sign-in link
just signs them straight in without changing anything.

Flow:

1. `POST /api/admin/customers/password-reset` (service role) verifies the caller
   exactly as the magic-link route does: admins/assistants may target anyone,
   affiliates only customers bound to them. Deactivated accounts and guest
   `@aminocan.local` records are rejected with a friendly message.
2. It calls `sendSupabasePasswordReset()` (`lib/admin/magic-link.ts`), which
   uses the same implicit-flow anon client to call
   `auth.resetPasswordForEmail(email, { redirectTo })` — again so the link works
   outside the recipient's browser (no PKCE `code_verifier` exists here).
   `redirectTo` is the **bare site origin, with no path**: the "Reset Password"
   email template appends `/account/set-password` to `{{ .ConfirmationURL }}`
   itself, and Supabase glues that suffix onto the end of the `redirect_to` the
   URL carries. Sending the path here too doubles it into
   `/account/set-password/account/set-password`. The customer-facing
   **/forgot-password** form passes `window.location.origin` for the same
   reason. Change the reset destination in the dashboard template, not in code —
   see `docs/supabase-auth-email-templates.md`.
3. The recipient clicks through to **`/account/set-password`**, which saves the
   new password against the recovery session the link established, then
   continues to `/account/dashboard` (customers) or `/admin` (affiliates).
4. The send is recorded in the audit log as `customer.password_reset`.

This is the staff-initiated twin of the customer-facing **/forgot-password**
form, and shares its Supabase configuration — the **"Reset Password"** email
template must be enabled (see below).

## Required Supabase dashboard configuration

1. **Custom SMTP (required for delivery).** Supabase's built-in email service is
   rate-limited (a few messages/hour) and intended for testing only. Configure
   SMTP under **Project Settings → Authentication → SMTP Settings** (e.g. point
   it at Resend, SendGrid, Postmark, or your own server) so magic-link emails
   actually deliver in production.

2. **Email templates.** The **"Magic Link"** template under **Authentication →
   Email Templates** must be enabled and contain `{{ .ConfirmationURL }}`
   (it does by default). Customize the wording/branding there. The
   **"Reset Password"** template is used by the staff-sent reset links and the
   customer-facing /forgot-password form — same requirement.

3. **URL configuration** (**Authentication → URL Configuration**):
   - **Site URL** — your production URL (e.g. `https://www.puramass.com`).
   - **Redirect URLs** — add every target the link may redirect back to:
     - `https://www.puramass.com` (**bare origin** — password-reset links; the
       template appends `/account/set-password` to it)
     - `https://www.puramass.com/account/set-password` (onboarding invite links)
     - `https://www.puramass.com/account/dashboard`
     - `https://www.puramass.com/admin` (affiliate links land here)
     - `http://localhost:3000` (bare origin, local dev password resets)
     - `http://localhost:3000/account/set-password` (local dev)
     - `http://localhost:3000/account/dashboard` (local dev)
     - `http://localhost:3000/admin` (local dev)

   The bare-origin entries matter: recovery links now pass the origin alone as
   `redirect_to` because the "Reset Password" template supplies the path (see
   the reset flow above). Add whichever host the app is actually served from —
   `www.` and apex are different origins to Supabase.

   If a redirect target is not on the allowlist, Supabase silently falls back to
   the Site URL.

## Environment variables

No third-party mail provider is needed for sign-in links anymore. Used here:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (used to call `signInWithOtp` /
  `resetPasswordForEmail`)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — looks up / validates the customer)
- `NEXT_PUBLIC_BASE_URL` (builds the `emailRedirectTo`)

(`RESEND_API_KEY` / `EMAIL_FROM` are still used for **other** emails — order
confirmations, invoices — just no longer for sign-in links.)

## Troubleshooting — "the sign-in email never arrives"

1. **SMTP not configured / built-in limit hit.** Without custom SMTP, Supabase
   throttles to a few emails/hour and may stop sending. Configure SMTP (above).
   The app surfaces Supabase's rate-limit as "Too many sign-in emails requested
   … wait a minute." (reset links say "Too many reset emails requested …").
2. **Check the SMTP provider's logs** (e.g. Resend → Emails, SendGrid Activity)
   for the recipient to see *delivered / bounced / spam*. The server also logs
   `[magic-link] Supabase magic-link email queued` /
   `[password-reset] Supabase recovery email queued` / the precise error.
3. **Domain verification / SPF / DKIM.** Whatever domain your SMTP sends from
   must be verified with valid SPF/DKIM, or mail lands in spam or is rejected.
4. **Spam folder.** Transactional login links frequently land in spam until the
   sending domain has reputation/DMARC configured.
5. **Redirect allowlist.** If the link signs them in but lands on the wrong
   page, add the redirect path to the allowlist (above).
