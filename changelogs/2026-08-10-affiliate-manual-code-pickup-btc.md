# Manual-Code Affiliates + Pickup Contact Message + BTC Payment Scaffolding

**Date:** August 10, 2026
**Type:** Feature + UI/UX Enhancement
**Status:** Completed ✅

---

## Overview

Three checkout-flow changes:

1. **Per-affiliate "manual code only" mode.** An affiliate can now be flagged so
   that customers bound to them are **not** auto-locked into the affiliate
   discount. Those customers must supply the referral code themselves — typed in
   at checkout, or auto-filled by arriving through a referral link (`?ref=CODE`).
   Affiliates without the flag keep the previous behaviour (being bound
   auto-applies the discount).

2. **Local pickup no longer publishes a fixed address.** The checkout "Pickup
   Location" card previously showed the store's configured pickup address. It now
   tells the customer to contact their sales person to arrange pickup.

3. **Bitcoin (BTC) payment method scaffolding — inactive.** A checkout
   payment-method registry now exists with Interac e-Transfer (active) and
   Bitcoin (inactive), plus a generic BTC instructions template. BTC shows in
   checkout as a disabled "Coming soon" tile and is normalised away server-side;
   flipping one flag activates it end-to-end.

---

## What Was Changed

### 1. `manual_code_only` flag on affiliates
**File:** `affiliate-manual-code-only-migration.sql`

- Adds `affiliates.manual_code_only BOOLEAN NOT NULL DEFAULT false`.

**Attribution logic** — `lib/affiliate/commission.ts`

- `resolveAffiliateAttribution` now skips the bound-customer auto-attribution
  (priority 1) when the affiliate is `manual_code_only`, falling through to the
  referral-code path (priority 2). This is authoritative for both the e-Transfer
  (`/api/orders-email`) and legacy crypto (`/api/orders`) checkouts.

**Client mirror** — `app/checkout/page.tsx`, `app/api/auth/customer/route.ts`

- `/api/auth/customer` attaches a derived `affiliate_manual_code_only` to the
  signed-in customer (read from the bound affiliate).
- The checkout only treats the affiliate as attributed from the binding when the
  affiliate is *not* `manual_code_only`; otherwise a valid referral code is
  required. A hint prompts bound manual-code customers to enter their code.

**Admin toggle** — `EditAffiliateModal`, sales-people API/type/mappers, affiliate
`PUT` route

- The affiliate edit modal gains a "Manual code only" checkbox, threaded through
  `updateAffiliate` → `PUT /api/admin/affiliates/[id]`. The flag is surfaced in
  the merged sales-people list and detail views so the checkbox reflects state.

### 2. Pickup "contact your sales person" message
**File:** `app/checkout/page.tsx`

- The Pickup Location card now reads "Please contact your sales person to arrange
  your pickup." with a note that the location/time are confirmed once payment is
  received. The `pickupAddress` prop and its settings plumbing were removed.

### 3. BTC payment method (inactive) + generic template
**File:** `lib/paymentMethod.ts`

- Adds `CHECKOUT_PAYMENT_METHODS` (etransfer active, btc inactive),
  `DEFAULT_CHECKOUT_PAYMENT_METHOD`, `resolveCheckoutPaymentMethod`, and the
  generic `BTC_PAYMENT_INSTRUCTIONS_TEMPLATE` with a `{{placeholder}}` renderer.
- `app/api/orders-email/route.ts` resolves the requested payment method against
  the active set (inactive/unknown → e-Transfer).
- `lib/email-smtp.ts` renders BTC instructions from the template when the method
  is `btc` (dormant until BTC is activated).
- Checkout renders inactive methods as disabled "Coming soon" tiles from the
  registry.

---

## Activating BTC later

Set `active: true` on the `btc` entry in `CHECKOUT_PAYMENT_METHODS`, make the
checkout method selectable, and pass `btcAddress` / `btcAmount` into the invoice
email so the generic template fills completely.
