# Affiliate Price List Sync

**Date:** August 10, 2026
**Type:** Fix
**Status:** Completed ✅

---

## Overview

An affiliate is the same account across the customers, affiliates and
sales_persons tables, and that one UID keys **two** price lists that are supposed
to hold the same prices:

1. **Their own customer record** (`customer_price_overrides` for their UID) —
   what prices the invoices they create.
2. **Their affiliate price list** (`affiliate_price_overrides`) — copied onto
   every customer bound to them.

Nothing kept these equal, so they drifted:

- An affiliate importing a price list updated (2) and their bound customers, but
  **not their own record (1)** — so the invoices they created kept the **old**
  prices.
- An admin setting an affiliate's prices via Customer Pricing updated (1) but not
  (2), so the affiliate's bound customers never saw the change.

Both lists are now kept in sync, so it no longer matters which one is read.

---

## What Changed

### Sync helper (`lib/admin/affiliate-pricelist-sync.ts`)
- `syncAffiliatePriceListFromOwnRecord` rewrites an affiliate's price list to
  match the sellable (positive, visible) box prices on their own record. It is a
  **no-op for ordinary customers**, so it can be called with any `customer_id`.
- Only the labeled **box** price is synced (the one field both tables share);
  unlabeled / per-vial / visibility data stays on the customer record.

### Write paths now kept in sync
- **Affiliate price-list import** (`/api/admin/price-overrides/import`) now also
  writes the prices onto the affiliate's **own record**, so their invoices price
  from the list they just imported.
- **Customer Pricing edits** to an affiliate's own record propagate to their
  affiliate price list:
  - applying a price list (`/api/admin/pricelists/[id]/apply-to-customer`),
  - a single override create/delete (`/api/admin/price-overrides` POST/DELETE),
  - an admin CSV import onto that record.

### One-time backfill
- `affiliate-customer-pricelist-sync-migration.sql` reconciles rows that drifted
  before this shipped. When the two lists disagree on a product, the
  more-recently-edited side wins.

---

## Deployment

1. Deploy the code (no schema change).
2. Run `affiliate-customer-pricelist-sync-migration.sql` against Supabase once to
   reconcile existing data (idempotent).
