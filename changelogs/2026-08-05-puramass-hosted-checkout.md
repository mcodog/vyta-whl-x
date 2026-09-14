# PuraMass Hosted Checkout (new payment processor)

**Date:** August 5, 2026
**Type:** Feature
**Status:** Completed ✅

---

## Overview

Added the **PuraMass hosted checkout** (Stealth Health partner API) as an opt-in
payment processor alongside the existing in-house email/invoice checkout. When
an admin enables it, the storefront hands the cart off to PuraMass: the backend
POSTs the cart's SKUs, gets back a `payment_link` on `app.puramass.com`, and
redirects the customer there. PuraMass re-reads prices from its own catalog and
owns payment, fulfilment, and order emails from that point.

It is **off by default** and fully reversible — when disabled, the existing
checkout is unchanged.

See `docs/PURAMASS_HOSTED_CHECKOUT.md` for the full operator/developer guide.

---

## What Was Added

### 1. Server-side API client + catalog matcher
- `lib/payments/puramass.ts` — server-only client: `isPuramassConfigured()`,
  `fetchPuramassCatalog()`, `createPuramassOrder()`, `PuramassApiError`.
  Credentials are read from the environment and never exposed to the browser or
  echoed in errors; requests time out and never cache.
- `lib/payments/puramass-catalog.ts` — bundled catalog snapshot + a
  strength-anchored name matcher that maps a product to a PuraMass SKU, flagging
  ambiguous/unmatched products instead of guessing.
- `lib/payments/puramass-catalog.test.ts` — matcher unit tests.

### 2. Database migration
**File:** `puramass-hosted-checkout-migration.sql`
- `products.puramass_sku` (+ index) — maps our internal SKUs to PuraMass SKUs.
- `site_settings.puramass_checkout_enabled` — the admin toggle (default `false`).
- `puramass_orders` — hand-off ledger tying our `partner_reference` to
  PuraMass's `transaction_id` / `payment_link`, with RLS + `updated_at` trigger.

### 3. Checkout hand-off route
**File:** `app/api/checkout/puramass/route.ts`
- Gated by both the admin toggle and server credentials; rate-limited.
- Resolves each cart line's `puramass_sku` from the DB (never trusts client SKUs
  or prices); returns `409` + `unmapped` names when a product isn't mapped.
- Converts vial quantities to pack counts (each PuraMass SKU is a 10-pack),
  clamped 1–99; creates the order, records the hand-off, returns the payment link.

### 4. Admin SKU sync endpoint
**File:** `app/api/admin/puramass/sync-skus/route.ts`
- Admin-only. Auto-fills `products.puramass_sku` from the live catalog (snapshot
  fallback), preserving existing mappings; returns a matched/ambiguous/unmatched
  report and writes an audit-log entry.

### 5. Settings API
**File:** `app/api/admin/settings/route.ts`
- Surfaces `puramass_checkout_enabled` (read/write) and `puramass_configured`
  (read-only, from env) with the usual progressive-column fallback.

### 6. Admin Settings UI
**File:** `app/(admin)/admin/settings/page.tsx`
- New "PuraMass Checkout" section: enable/disable toggle, a server-credential
  status banner, a "Sync SKUs from catalog" button, and a mapping report
  (mapped / need-review / unmatched).

### 7. Storefront checkout
**File:** `app/checkout/page.tsx`
- New `PuramassCheckoutContent` screen (collects email + optional name, shows an
  indicative cart summary, redirects to the PuraMass payment link). The
  `/checkout` router renders it when the toggle is on.

### 8. Config + docs
- `.env.example` — `PURAMASS_API_KEY`, `PURAMASS_PARTNER_ID`,
  `PURAMASS_API_BASE_URL` (server-only).
- `docs/PURAMASS_HOSTED_CHECKOUT.md` — integration guide + deliberate trade-offs.

---

## Deliberate Trade-offs

For orders checked out via PuraMass, the store's own machinery is bypassed:
per-customer CAD pricing / pricelists / affiliate discounts / free-shipping
thresholds do not apply (PuraMass charges its own USD catalog price), the
in-house warehouse/fulfilment and invoice emails are not used, and affiliate
commissions are not auto-created (the referral code is recorded for manual
follow-up). There is no payment-status webhook in the partner API, so live
status lives in the PuraMass portal; the `puramass_orders` ledger keeps the
hand-off record for reconciliation.
