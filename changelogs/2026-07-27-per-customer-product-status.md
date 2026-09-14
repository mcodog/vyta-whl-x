# Per-Customer Product Status (visibility) on customer pricing

Date: 2026-07-27

The individual customer pricing screen (Pricing → Customer Pricing → *Edit
individually*) now controls a per-customer product **status** alongside the
per-customer **price**. When a product is set to **Hidden** for a customer, it
is dropped from that customer's storefront and product listings — even if the
product carries no custom price.

## What changed

### New `is_visible` column on customer price overrides
- `aminocan/customer-product-status-migration.sql`
  - Adds `customer_price_overrides.is_visible BOOLEAN NOT NULL DEFAULT true`.
  - Relaxes `override_price` to allow `NULL`, so a row can now represent a
    price override, a visibility override, or both. A visibility-only "Hidden"
    row has a null `override_price`.
  - Adds a partial index on hidden rows for the storefront lookup.

### Customer pricing grid — new **Status** column
- `app/(admin)/admin/pricing/customer/[id]/page.tsx`
  - Each product row gains a **Visible / Hidden** toggle. Hidden rows are
    highlighted, and the toggle is included in the unsaved-changes count and the
    Save / Reset flow.
  - Save reconciles each product to a single row: an upsert when it has a custom
    price and/or is hidden, a delete when it is back to default (no custom price
    **and** visible).

### API
- `app/api/admin/price-overrides/route.ts`
  - `GET` returns `is_visible`.
  - `POST` accepts `is_visible` and allows a visibility-only upsert (no
    `override_price`). Only the fields present in the request are written, so
    toggling visibility leaves an existing price untouched and vice-versa.

### Storefront respects hidden products
- `app/api/products/route.ts` and `app/api/products/featured/route.ts`
  - When a `customer_id` is supplied, products the customer is hidden from are
    excluded from the listing (a hidden single product by `slug` returns
    `products: null`).
  - A product priced at **$0** for the customer (custom `override_price = 0`) is
    also treated as hidden and excluded — a $0 price means "don't show it". The
    customer pricing grid shows a **Hidden ($0)** badge for these rows.

### Null-price safety in existing consumers
- `lib/admin/pricelists.ts`, `CustomerPricingPanel.tsx`,
  `CustomerOverridesView.tsx` now skip visibility-only rows so they aren't shown
  or counted as `$0` overrides.

## Migration

Run `aminocan/customer-product-status-migration.sql` in the Supabase SQL editor.
Existing rows default to `is_visible = true`, so current behavior is unchanged
until a product is explicitly hidden for a customer.
