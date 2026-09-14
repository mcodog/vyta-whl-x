# USD pricing: change history + storefront billing

**Date:** 2026-07-08
**Area:** Admin products, storefront pricing, cart, checkout, orders, invoices, emails
**PR:** [#134](https://github.com/thepuragroup-droid/aminocan-whl/pull/134)
**Migrations:**
- `aminocan/product-usd-price-history-migration.sql`
- `aminocan/order-currency-migration.sql`

## Summary

Two related USD-pricing changes this session:

1. The admin Products **History** action now tracks changes to the USD price
   (`products.price_usd`) alongside CAD price, vial price, and stock.
2. Customers tagged `customers.price_currency = 'USD'` now **see and are billed
   in USD** across the whole storefront — previously the tag only affected
   admin/invoicing and the store always showed/charged CAD.

`price_usd` is a **separate column** on `products`: the optional explicit USD
override. When it's null the USD price is computed as CAD `price` ×
`site_settings.usd_exchange_rate` (same rule as the admin). CAD stays the base
currency for everyone else.

## Migrations (run before deploying)

- `product-usd-price-history-migration.sql` — widen the
  `product_change_history.field` CHECK to allow `'price_usd'` and seed a baseline
  row for products that already have an explicit USD price.
- `order-currency-migration.sql` — add a `currency` column (`'CAD' | 'USD'`,
  default `'CAD'`) to `orders`.

Both are idempotent. The order API and invoice auto-creation fall back to CAD on
a pre-migration database.

## 1. USD price in product change history

- `lib/admin/product-history.ts` — `price_usd` added to the tracked fields.
- `app/api/admin/products/[id]/route.ts`, `app/api/admin/products/route.ts` —
  record `price_usd` changes on update and on create.
- `app/api/admin/products/[id]/history/route.ts` — widened field type.
- `app/(admin)/admin/products/page.tsx` — new **Price (USD)** history tab, with an
  `(auto: price × rate)` note when no explicit override is set.

## 2. Storefront USD billing for USD-tagged customers

- **`contexts/CurrencyContext.tsx`** (new) — resolves the active currency from the
  signed-in customer's tag and fetches the stored exchange rate once from the new
  public `GET /api/settings/currency`. Exposes a `ready` flag so prices don't
  flash. Wired into `app/layout.tsx`.
- **`contexts/CartContext.tsx`** — cart items carry a per-vial `priceUsd` captured
  at add-to-cart time (honours `price_usd` overrides); CAD stays the stored base.
- **Display** — homepage featured, product listing, product detail, add-to-cart
  modal, cart, and checkout render the active currency (`components/Products.tsx`,
  `components/AddToCartModal.tsx`, `app/products/page.tsx`,
  `app/products/[slug]/page.tsx`, `app/cart/page.tsx`, `app/checkout/page.tsx`).
- **Server** (`app/api/orders-email/route.ts`) — keeps computing shipping and
  Easyship customs values in CAD, then restates the stored order (line prices,
  subtotal, discount, total) in the billing currency and converts shipping to USD
  at the rate. Affiliate commissions stay in CAD. `orders.currency` is stored.
- **Order → invoice → email** — the auto-created invoice inherits the order
  currency (`lib/admin/invoices.ts`); the customer e-Transfer invoice email and
  admin notification are labelled/totalled in that currency
  (`lib/etransfer-email.ts`, `app/api/cron/send-etransfer-emails/route.ts`).
- `lib/pricing.ts` — added `inCurrency`, `formatMoney`, `toPriceCurrency`;
  `productUsdPrice` now honours per-customer CAD overrides.

## Loading skeletons

- **Checkout** now shows a two-column layout skeleton (details form + order
  summary) instead of the bare "Loading checkout…" spinner, for both the settings
  gate and the Suspense fallback.
- **Price-flicker guard** — storefront pages hold their skeletons until the
  currency + rate resolve, and the checkout order summary shows a shimmer in place
  of each amount until then, so a USD customer never sees a CAD figure first.

## Payment note

The live payment rail is Interac e-Transfer (a CAD bank rail). A USD order is
**denominated** in USD (order, invoice, emails); payment collection is unchanged.
Shipping is converted to USD so the total is a single currency.
