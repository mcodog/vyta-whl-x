# Supabase Auth email templates (PuraMass)

These two emails are **not sent from this codebase** — they are the Supabase
Auth templates configured in the Supabase Dashboard:

> **Authentication → Emails → Templates** (Invite / Confirm signup, and Reset
> password)

They use Supabase's Go template syntax (`{{ .ConfirmationURL }}`,
`{{ .Data.first_name }}`, `{{ .Email }}`), which is why they live in the
dashboard and not in the repo. This file is the source of truth for the
**PuraMass-branded** versions — copy the HTML below into the matching template
in the dashboard.

Rebrand notes:
- Brand name is **PuraMass** (`PURAMASS` as the all-caps header wordmark, to
  match the invoice/report/PDF headers).
- Contact address is `support@aminocan.com` (unchanged). The previous welcome
  template had a mismatch where the link text showed `support@aminocan.com`
  but the `mailto:` pointed at `support@fieldandform.space` — both now point at
  `support@aminocan.com`.

---

## 1. Welcome / sign-in (Invite user)

```html
<div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
    <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">PURAMASS</h1>
    <p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
  </div>

  <div style="padding: 32px 24px;">
    <p style="font-size: 14px; color: #1A1A1A; margin: 0 0 16px; line-height: 1.6;">
      Hi {{ .Data.first_name }},
    </p>

    <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Welcome to PuraMass!</h2>
    <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px; line-height: 1.6;">
      We're glad to have you on board. Your account is ready, and we've sent you a secure sign-in link below — no password needed.
    </p>

    <p style="font-size: 14px; color: #1A1A1A; margin: 0 0 12px; font-weight: 600;">Here's how to get started:</p>
    <ol style="font-size: 14px; color: #6B7280; margin: 0 0 24px; padding: 0 0 0 20px; line-height: 1.7;">
      <li style="margin-bottom: 6px;">Click the <strong style="color: #1A1A1A;">Sign in to PuraMass</strong> button below</li>
      <li style="margin-bottom: 6px;">You will be prompted to set your password, and then you will be signed in after completing the setup</li>
      <li>Once you're in, you can browse our premium Canadian peptides, update your profile, and place your first order</li>
    </ol>

    <div style="text-align: center; margin: 0 0 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Sign in to PuraMass
      </a>
    </div>

    <p style="font-size: 12px; color: #6B7280; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">Or paste this link into your browser</p>
    <div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="font-size: 13px; color: #1A1A1A; margin: 0; font-family: monospace; word-break: break-all;">{{ .ConfirmationURL }}</p>
    </div>

    <p style="font-size: 14px; color: #6B7280; margin: 0 0 16px; line-height: 1.6;">
      If you run into any trouble signing in or have questions, just reply to this email or reach us at <a href="mailto:support@aminocan.com" style="color: #1A1A1A; text-decoration: underline;">support@aminocan.com</a>. We're happy to help.
    </p>

    <p style="font-size: 14px; color: #1A1A1A; margin: 24px 0 0; line-height: 1.6;">
      Welcome aboard,<br/>
      <span style="color: #6B7280;">The PuraMass Team</span>
    </p>
  </div>

  <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
    <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
      PuraMass Peptides &bull; Canada<br/>
      Sent to {{ .Email }} &bull; If you didn't request this email, you can safely ignore it.
    </p>
  </div>
</div>
```

---

## 2. Reset password

> **The `/account/set-password` suffix on `{{ .ConfirmationURL }}` below is
> deliberate — this template owns the reset link's destination path.** Supabase
> glues that suffix onto the end of the `redirect_to` the confirmation URL
> carries, so the code that sends recovery emails must pass the **bare site
> origin** with no path: `resetPasswordForEmail(email, { redirectTo: origin })`
> in `/forgot-password` and `sendSupabasePasswordReset()`
> (`lib/admin/magic-link.ts`). Setting the path on both sides is what produced
> `https://www.puramass.com/account/set-password/account/set-password`. To send
> recovery links somewhere else, change the path here — not in the code.
>
> The invite template above is the opposite: it links to a bare
> `{{ .ConfirmationURL }}`, so those flows pass the full path themselves.

```html
<h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">Reset your password</h2>
<p style="font-size: 14px; color: #6B7280; margin: 0 0 24px; line-height: 1.6;">
  We received a request to reset your password. Follow the link below to choose a new one and regain access to your account.
</p>

<p style="font-size: 14px; color: #1A1A1A; margin: 0 0 12px; font-weight: 600;">Here's how to reset your password:</p>
<ol style="font-size: 14px; color: #6B7280; margin: 0 0 24px; padding: 0 0 0 20px; line-height: 1.7;">
  <li style="margin-bottom: 6px;">Click the <strong style="color: #1A1A1A;">Reset Password</strong> button below</li>
  <li style="margin-bottom: 6px;">Choose a new password for your account</li>
  <li>Sign in using your new password once the reset is complete</li>
</ol>

<div style="text-align: center; margin: 0 0 24px;">
  <a href="{{ .ConfirmationURL }}/account/set-password" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
    Reset Password
  </a>
</div>

<p style="font-size: 12px; color: #6B7280; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">Or paste this link into your browser</p>
<div style="background: #F7F7F7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
  <p style="font-size: 13px; color: #1A1A1A; margin: 0; font-family: monospace; word-break: break-all;">{{ .ConfirmationURL }}/account/set-password</p>
</div>

<p style="font-size: 14px; color: #6B7280; margin: 0 0 16px; line-height: 1.6;">
  If you didn't request this password reset, you can safely ignore this email and your password will remain unchanged.
</p>

<p style="font-size: 14px; color: #1A1A1A; margin: 24px 0 0; line-height: 1.6;">
  Regards,<br/>
  <span style="color: #6B7280;">The PuraMass Team</span>
</p>
```
