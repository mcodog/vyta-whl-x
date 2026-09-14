# Resend affiliate password set-up link from the affiliates table

Date: 2026-07-27

When an affiliate is created, they're emailed a passwordless sign-in link that
lands on **/account/set-password** so they can choose their own password. That
email can now be **resent** directly from the affiliates list — no need to
re-create the affiliate or dig into the Customers list.

## What changed

- `app/(admin)/admin/affiliates/page.tsx`
  - Each row's **Actions** now has a **mail** button (visible to editors) that
    resends the set-up link to that affiliate.
  - Reuses the existing `sendCustomerMagicLink(affiliate.id, '/account/set-password')`
    flow — the same call the *Add Affiliate* dialog makes on creation — so the
    recipient gets an identical link.
  - Success/failure is reported via a toast (including Supabase's rate-limit and
    deactivated-account messages surfaced from the magic-link API).

No API or schema changes — this wires the existing
`/api/admin/customers/magic-link` endpoint (which already accepts affiliate ids
and the `/account/set-password` redirect) into the affiliates table.
