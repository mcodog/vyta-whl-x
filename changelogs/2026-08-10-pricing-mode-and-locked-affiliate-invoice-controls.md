# Pricing Mode (Template vs Dedicated) + Locked Affiliate Invoice Controls

**Date:** August 10, 2026
**Type:** Feature + UI/UX Enhancement
**Status:** Completed ✅

---

## Overview

Two related changes to how an affiliate ("client") sees and how the system
tracks their pricing:

1. **Affiliate invoice controls are now shown, not hidden.** On the invoice
   create/edit form, the **currency toggle** and the **price list** were
   previously hidden for affiliates. They are now always visible but **locked**
   (read-only), so an affiliate can *see* what currency and price list drive
   their quote without being able to change them.

2. **Template vs Dedicated marking.** Every customer now carries a stored
   `pricing_mode` flag — `template` (their prices track a shared price list) or
   `dedicated` (bespoke, hand-managed prices) — so the app can state which a
   client is on with a single column read instead of diffing their overrides
   against a price list on every load.

See `docs/adr/0005-pricing-mode-template-vs-dedicated.md` for the full rationale.

---

## What Was Changed

### 1. `pricing_mode` column + backfill
**File:** `customer-pricing-mode-migration.sql`

- Adds `customers.pricing_mode TEXT NOT NULL DEFAULT 'template'`
  (`CHECK IN ('template','dedicated')`) plus an index.
- One-time backfill flags as `dedicated` any customer already holding a price
  override that isn't present at the same price in their applied list (a
  customer with custom prices and no applied list counts as dedicated). A clean
  copy of a list, or a customer with no custom prices, stays `template`.

### 2. Marking helper (single chokepoint)
**File:** `lib/admin/pricing-mode.ts`

- `markCustomerTemplate` / `markCustomerDedicated` / `setCustomerPricingMode`.
- Best-effort: a mode update never blocks the price write that triggered it
  (failures are logged and swallowed), matching the affiliate price-list sync.

### 3. Write paths maintain the flag O(1)
- **`app/api/admin/pricelists/[id]/apply-to-customer/route.ts`** — applying a
  list in `override` mode marks the customer `template`; `keep_existing` that
  kept ≥1 of their own prices marks them `dedicated`.
- **`app/api/admin/price-overrides/route.ts`** — a price-bearing override POST,
  or an override DELETE, marks the customer `dedicated` (visibility-only writes
  don't count).
- **`app/api/admin/price-overrides/import/route.ts`** — a CSV import marks every
  targeted customer (and an affiliate's own record) `dedicated`.

### 4. Expose pricing config to the affiliate form
**File:** `app/api/affiliate/me/route.ts`

- Response now includes `priceCurrency`, `pricingMode`, and `appliedPricelist`
  (`{ id, name, currency }`). Served with the service-role client because a
  signed-in affiliate can't read `pricelists` under its RLS.

### 5. Locked-but-visible invoice controls
**File:** `components/admin/InvoiceForm.tsx`

- **Price List** field renders for affiliates as a locked display showing the
  source list with a **Template · «name»** or **Dedicated** badge and a lock
  icon, plus helper text ("Prices are locked and set by an admin.").
- **Paid In** (currency) renders for affiliates as locked CAD/USD buttons with a
  lock indicator on the active currency and a "Locked to your account currency"
  caption.
- Both locked controls show a **loading state** (spinner + skeleton) until the
  affiliate's config resolves, so they no longer flash a default value (e.g.
  "Standard pricing", or USD) and then switch. The currency spinner is shown for
  new invoices only — edits already know the currency from the saved invoice.
- Admin behavior is unchanged (both controls stay fully interactive).

---

## Notes

- **Presentation only for the lock:** the server-side price enforcement from
  ADR 0001 (`lib/admin/affiliate-pricing.ts`) is unchanged and remains the real
  boundary — the UI lock is cosmetic.
- **Flip rule:** any hand-edit makes a customer `dedicated` (no value
  comparison); re-applying a shared list is the only way back to `template`.
