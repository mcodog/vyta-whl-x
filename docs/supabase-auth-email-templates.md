# Supabase Auth email templates (VYTA Biosciences)

These emails are **not sent from this codebase** — they are the Supabase Auth
templates configured in the Supabase Dashboard:

> **Authentication → Emails → Templates** (Magic Link, Confirm signup, Reset
> password, Invite user)

They use Supabase's Go template syntax (`{{ .ConfirmationURL }}`,
`{{ .Data.first_name }}`, `{{ .Email }}`), which is why they live in the
dashboard and not in the repo. This file is the source of truth for the
**VYTA-branded** versions — copy the HTML below into the matching template
in the dashboard.

Rebrand notes:
- Brand name is **VYTA Biosciences** (`VYTA` as the all-caps header wordmark, to
  match the invoice/report/PDF headers).
- Contact address is `support@aminocan.com` (unchanged). The previous welcome
  template had a mismatch where the link text showed `support@aminocan.com`
  but the `mailto:` pointed at `support@fieldandform.space` — both now point at
  `support@aminocan.com`.

## The shared card shell

Templates 1–3 use one layout so the three transactional emails read as a set:
a Midnight Navy header band with the VYTA wordmark, a white card on Cloud
(`#F7FAFB`), a Bio Teal (`#438B9E`) button, an expiry callout, a copy-and-paste
fallback URL, and a footer with the "ignore this" reassurance.

Constraints the markup works around — worth knowing before editing it:

- **Body markup only.** The dashboard editor takes the message body, so there is
  no `<head>`, no `<style>` block and no media queries. Every rule is inline,
  and the card padding (`32px`) and outer gutter (`12px`) are chosen to sit
  comfortably on a phone without a mobile override.
- **Tables, not divs**, with `width="560"` alongside `max-width:560px` so Outlook
  gets a fixed width while everything else scales down.
- **No external images**, so nothing is blocked by default in Gmail or Outlook.
- The **60 minute** expiry matches Supabase's default email OTP expiry, which is
  shared across templates. If you change it under **Authentication → Settings**,
  update the callout in all three.
- Colors are the brand tokens from `tailwind.config.ts`: Midnight Navy
  `#07203A`, Vital Blue `#1B5D83`, Bio Teal `#438B9E`, Aqua `#6EB2B8`, Cloud
  `#F7FAFB`, line `#D5E2E7`.

### Which template owns the destination path

This trips people up, so it is worth stating once:

| Template | Link | Who supplies the path |
| --- | --- | --- |
| Magic Link | bare `{{ .ConfirmationURL }}` | the **code** (`emailRedirectTo`) |
| Confirm signup | bare `{{ .ConfirmationURL }}` | the **code** |
| Invite user | bare `{{ .ConfirmationURL }}` | the **code** |
| Reset password | `{{ .ConfirmationURL }}/account/set-password` | the **template** |

Setting the path on both sides is what produced
`/account/set-password/account/set-password`. See template 3 for the details.

Every destination must also be on the **Redirect URLs** allowlist under
**Authentication → URL Configuration**, or Supabase silently falls back to the
Site URL — the full list is in `MAGIC-LINK-SETUP.md`.

---

## 1. Magic Link

Sent by `sendSupabaseMagicLink()` (`lib/admin/magic-link.ts`) behind the
**Login Link** button on Admin → Customers, and by the onboarding invite flow.
Links to a bare `{{ .ConfirmationURL }}` — the caller passes the full
destination (`/account/dashboard`, `/account/set-password` or `/admin`).

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#F7FAFB;">
  <tr>
    <td align="center" style="padding:40px 12px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #D5E2E7;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td align="center" style="background:#07203A;padding:32px 24px;">
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">VYTA</div>
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#6EB2B8;text-transform:uppercase;padding-top:6px;">Biosciences</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

            <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;color:#07203A;font-weight:700;">Sign in to your account</h1>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#4E6E85;">
              Click the button below and you'll be signed in instantly — no password needed.
            </p>

            <!-- Button -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" bgcolor="#438B9E" style="border-radius:10px;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 38px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background:#438B9E;">Sign in securely</a>
                </td>
              </tr>
            </table>

            <!-- Expiry note -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
              <tr>
                <td style="background:#F2F8F9;border:1px solid #C9DFE2;border-radius:10px;padding:14px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1B5D83;">
                  This link expires in <strong>60 minutes</strong> and can only be used once.
                </td>
              </tr>
            </table>

            <div style="border-top:1px solid #D5E2E7;height:1px;line-height:1px;font-size:0;margin:0 0 22px;">&nbsp;</div>

            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#7E99AB;">Button not working? Copy and paste this address into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}" style="color:#1B5D83;text-decoration:underline;">{{ .ConfirmationURL }}</a>
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F7FAFB;border-top:1px solid #D5E2E7;padding:22px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7E99AB;">
              If you didn't request this email, you can safely ignore it — no one can access your account without this link.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#9CC8CE;">&copy; VYTA Biosciences</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
```

---

## 2. Confirm signup

Sent when someone signs up with an email/password and Supabase needs the
address confirmed. Same shell as the magic link, with the address being
confirmed echoed back via `{{ .Email }}` as a trust signal — drop that line if
you would rather not repeat it. Links to a bare `{{ .ConfirmationURL }}`.

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#F7FAFB;">
  <tr>
    <td align="center" style="padding:40px 12px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #D5E2E7;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td align="center" style="background:#07203A;padding:32px 24px;">
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">VYTA</div>
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#6EB2B8;text-transform:uppercase;padding-top:6px;">Biosciences</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

            <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;color:#07203A;font-weight:700;">Confirm your email address</h1>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#4E6E85;">
              You're one click away. Confirm <strong style="color:#07203A;">{{ .Email }}</strong> to finish setting up your account.
            </p>

            <!-- Button -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" bgcolor="#438B9E" style="border-radius:10px;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 38px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background:#438B9E;">Confirm email address</a>
                </td>
              </tr>
            </table>

            <!-- Expiry note -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
              <tr>
                <td style="background:#F2F8F9;border:1px solid #C9DFE2;border-radius:10px;padding:14px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1B5D83;">
                  This link expires in <strong>60 minutes</strong> and can only be used once.
                </td>
              </tr>
            </table>

            <div style="border-top:1px solid #D5E2E7;height:1px;line-height:1px;font-size:0;margin:0 0 22px;">&nbsp;</div>

            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#7E99AB;">Button not working? Copy and paste this address into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}" style="color:#1B5D83;text-decoration:underline;">{{ .ConfirmationURL }}</a>
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F7FAFB;border-top:1px solid #D5E2E7;padding:22px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7E99AB;">
              If you didn't create a VYTA Biosciences account, you can safely ignore this email — no account will be activated.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#9CC8CE;">&copy; VYTA Biosciences</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
```

---

## 3. Reset password

Sent by the customer-facing **/forgot-password** form and by the staff-initiated
**Reset password** action on Admin → Customers / Sales People.

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
> Note the suffix appears **twice**: on the button's `href` and on the
> copy-and-paste fallback URL, which must match the button or the fallback
> lands people on the site root.

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#F7FAFB;">
  <tr>
    <td align="center" style="padding:40px 12px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #D5E2E7;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td align="center" style="background:#07203A;padding:32px 24px;">
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">VYTA</div>
            <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#6EB2B8;text-transform:uppercase;padding-top:6px;">Biosciences</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

            <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25;color:#07203A;font-weight:700;">Reset your password</h1>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#4E6E85;">
              We received a request to reset the password for <strong style="color:#07203A;">{{ .Email }}</strong>. Choose a new one below.
            </p>

            <!-- Button -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" bgcolor="#438B9E" style="border-radius:10px;">
                  <a href="{{ .ConfirmationURL }}/account/set-password" style="display:inline-block;padding:15px 38px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background:#438B9E;">Reset password</a>
                </td>
              </tr>
            </table>

            <!-- Expiry note -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
              <tr>
                <td style="background:#F2F8F9;border:1px solid #C9DFE2;border-radius:10px;padding:14px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1B5D83;">
                  This link expires in <strong>60 minutes</strong> and can only be used once. Your current password stays active until you choose a new one.
                </td>
              </tr>
            </table>

            <div style="border-top:1px solid #D5E2E7;height:1px;line-height:1px;font-size:0;margin:0 0 22px;">&nbsp;</div>

            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#7E99AB;">Button not working? Copy and paste this address into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}/account/set-password" style="color:#1B5D83;text-decoration:underline;">{{ .ConfirmationURL }}/account/set-password</a>
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F7FAFB;border-top:1px solid #D5E2E7;padding:22px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7E99AB;">
              If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#9CC8CE;">&copy; VYTA Biosciences</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
```

---

## 4. Welcome / sign-in (Invite user)

Still on the older single-column layout rather than the card shell above — left
as-is here so it keeps matching what is currently in the dashboard. Links to a
bare `{{ .ConfirmationURL }}`, so the invite flow passes the full
`/account/set-password` path itself.


```html
<div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #DCE7EB;">
    <h1 style="font-size: 24px; font-weight: 700; color: #07203A; margin: 0;">VYTA</h1>
    <p style="font-size: 11px; letter-spacing: 0.15em; color: #438B9E; margin: 4px 0 0; text-transform: uppercase;">Canadian Peptides</p>
  </div>

  <div style="padding: 32px 24px;">
    <p style="font-size: 14px; color: #07203A; margin: 0 0 16px; line-height: 1.6;">
      Hi {{ .Data.first_name }},
    </p>

    <h2 style="font-size: 20px; font-weight: 600; color: #07203A; margin: 0 0 8px;">Welcome to VYTA Biosciences!</h2>
    <p style="font-size: 14px; color: #5B7A8C; margin: 0 0 24px; line-height: 1.6;">
      We're glad to have you on board. Your account is ready, and we've sent you a secure sign-in link below — no password needed.
    </p>

    <p style="font-size: 14px; color: #07203A; margin: 0 0 12px; font-weight: 600;">Here's how to get started:</p>
    <ol style="font-size: 14px; color: #5B7A8C; margin: 0 0 24px; padding: 0 0 0 20px; line-height: 1.7;">
      <li style="margin-bottom: 6px;">Click the <strong style="color: #07203A;">Sign in to VYTA</strong> button below</li>
      <li style="margin-bottom: 6px;">You will be prompted to set your password, and then you will be signed in after completing the setup</li>
      <li>Once you're in, you can browse our premium Canadian peptides, update your profile, and place your first order</li>
    </ol>

    <div style="text-align: center; margin: 0 0 24px;">
      <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background: #07203A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Sign in to VYTA
      </a>
    </div>

    <p style="font-size: 12px; color: #5B7A8C; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">Or paste this link into your browser</p>
    <div style="background: #F7FAFB; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="font-size: 13px; color: #07203A; margin: 0; font-family: monospace; word-break: break-all;">{{ .ConfirmationURL }}</p>
    </div>

    <p style="font-size: 14px; color: #5B7A8C; margin: 0 0 16px; line-height: 1.6;">
      If you run into any trouble signing in or have questions, just reply to this email or reach us at <a href="mailto:support@aminocan.com" style="color: #07203A; text-decoration: underline;">support@aminocan.com</a>. We're happy to help.
    </p>

    <p style="font-size: 14px; color: #07203A; margin: 24px 0 0; line-height: 1.6;">
      Welcome aboard,<br/>
      <span style="color: #5B7A8C;">The VYTA Biosciences Team</span>
    </p>
  </div>

  <div style="padding: 24px; text-align: center; background: #F7FAFB; border-top: 1px solid #DCE7EB;">
    <p style="font-size: 12px; color: #8FA9B6; margin: 0;">
      VYTA Biosciences &bull; Canada<br/>
      Sent to {{ .Email }} &bull; If you didn't request this email, you can safely ignore it.
    </p>
  </div>
</div>
```
