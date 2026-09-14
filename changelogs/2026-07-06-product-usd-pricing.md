# Product USD Pricing (CAD ↔ USD toggle)

Date: 2026-07-06

Products can now be shown and charged in USD as well as CAD. CAD stays the base
price; USD is either an explicit per-product override or auto-calculated from a
global CAD→USD multiplier, so updating one rate refreshes every USD price.

## Data model

- `products.price_usd` (numeric, nullable) — an **optional** explicit USD price.
  When null, the USD price is computed live as `ROUND(price × usd_exchange_rate)`
  — the same fallback pattern as `vial_price` → `price / 10`.
- `site_settings.usd_exchange_rate` (numeric, default `0.73`) — the CAD→USD
  multiplier. Admin-editable in Site Settings, with a "Live rate" button that
  fetches the current market rate for review before saving.
- Added by `product-usd-price-migration.sql` — run it in the Supabase SQL editor.

## Products admin page

- A **CAD / USD** toggle sits next to the search box. CAD is the default and
  shows the base `price` column; USD shows `price_usd` or, when unset, the auto
  value (`price × rate`, marked *auto*).
- In USD mode the **Price** cell is inline-editable and writes `price_usd`
  (clearing it reverts to auto). The **Vial price** cell shows the converted USD
  value read-only (there is no per-vial USD override) — edit vial prices in CAD.
- The create/edit form has a new **Price (USD)** field; leaving it blank
  auto-calculates from CAD × the current rate.

## Invoice creation / edit

- The existing **Paid In** (CAD / USD) control now actually converts prices.
  Switching currency re-prices every product-bound line to the catalog price in
  the selected currency (manual lines keep their entered price). Line prices,
  the product picker, and the totals all reflect the chosen currency.
- USD line prices use the product's `price_usd` when set (and no pricelist
  override applies), otherwise the CAD price × rate. Pricelist prices are
  converted at the rate.

## Keeping the multiplier updated

- The rate lives in Site Settings → **USD Pricing**. Because auto USD prices are
  computed from it live, changing the rate instantly updates every non-overridden
  USD price across the Products table and new invoices.
- `GET /api/admin/settings/usd-rate` fetches a live CAD→USD rate (best-effort,
  key-less FX sources with a fallback) for the "Live rate" button; the admin
  still reviews and saves it.

## Files

- `product-usd-price-migration.sql` — adds `products.price_usd` +
  `site_settings.usd_exchange_rate`.
- `lib/pricing.ts` — shared `usdFromCad` / `productUsdPrice` helpers + default rate.
- `lib/supabase.ts` — `Product.price_usd`.
- `app/api/admin/settings/route.ts` — read/validate/persist `usd_exchange_rate`.
- `app/api/admin/settings/usd-rate/route.ts` — live-rate fetch helper.
- `app/(admin)/admin/settings/page.tsx` — USD Pricing settings card.
- `app/api/admin/products/route.ts`, `app/api/admin/products/[id]/route.ts` —
  accept/persist `price_usd`.
- `app/(admin)/admin/products/page.tsx` — currency toggle, USD display/edit,
  form field.
- `components/admin/InvoiceForm.tsx` — currency-aware pricing + re-price on toggle.
