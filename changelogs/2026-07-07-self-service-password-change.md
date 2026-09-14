# Self-service password change

Date: 2026-07-07

Signed-in users can now change their own password without going through the
email reset flow — both on the customer account page and in the admin panel.

## Customer account

- A collapsible **Password & Security** card in the account dashboard sidebar
  (`/account/dashboard`), sitting between the shipping address and Sign Out.
  Expanding it reveals the change-password form.

## Admin panel

- A **Your Password** card at the top of **Site Settings** (`/admin/settings`).
  It's a personal account action, so it stays enabled even for read-only
  (assistant) roles — the read-only restriction only covers site-wide settings.
  The card shows the signed-in admin's email so it's clear which login is being
  updated.

## How it works

- New shared component `components/ChangePasswordForm.tsx`, with `customer`
  (slate/cyan) and `admin` (ink/bronze) style variants so it blends into either
  surface.
- Requires the **current password**, a new password, and a confirmation. The
  current password is re-verified with `supabase.auth.signInWithPassword`
  before the change is applied, so an unattended open session alone can't rotate
  the password. A failed verification leaves the existing session intact.
- New password strength is checked with the existing `validatePassword`
  (`lib/password.ts`) — 8+ chars with upper/lower/number/symbol — and must
  differ from the current one. The change is applied via
  `supabase.auth.updateUser`.

## Files

- `components/ChangePasswordForm.tsx` — new shared form.
- `app/(customer)/account/dashboard/page.tsx` — Password & Security card.
- `app/(admin)/admin/settings/page.tsx` — Your Password card.
