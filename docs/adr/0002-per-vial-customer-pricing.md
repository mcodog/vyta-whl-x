# 2. Per-vial customer/affiliate pricing overrides

- **Status:** Accepted
- **Date:** 2026-07-28
- **Area:** Pricing, Invoicing / AR
- **Relates to:** ADR 0001 (affiliate invoice pricing locked to assigned price list)
- **Related code:**
  - `customer-vial-override-and-kat-pricing-migration.sql` (schema + seed)
  - `components/admin/InvoiceForm.tsx` (`vialPriceForProduct`)
  - `lib/admin/affiliate-pricing.ts` (server re-derivation)
  - `lib/admin/pricelists.ts` (`CustomerOverride`)
  - `app/api/admin/price-overrides/route.ts`

## Context

A customer's (and an affiliate's) custom prices live in
`customer_price_overrides`, which stored only a **box** price
(`override_price` + `unlabeled_override_price`). Single-vial lines had no
per-customer price: `vialPriceForProduct` always used the catalog
`products.vial_price` (falling back to `price ÷ 10`), regardless of any override.

Under ADR 0001 an affiliate's invoice lines are priced strictly from their
assigned pricing. That made the gap visible: when an affiliate switched a line to
**Vial**, the price jumped to the catalog vial price instead of a price they
control. Affiliates need their own single-vial price, distinct from the box
price and from the catalog — e.g. the affiliate "Kat Torres" is quoted **2× the
catalog vial price** per vial.

## Decision

Add a **per-vial override** to `customer_price_overrides`:

```
ALTER TABLE customer_price_overrides
  ADD COLUMN vial_override_price DECIMAL(10,2) CHECK (vial_override_price >= 0);
```

Vial-line pricing now follows the same precedence shape as box pricing:

1. `vial_override_price` (the customer/affiliate's own single-vial price, stored
   in their own currency, CAD↔USD converted like the box override), else
2. catalog `products.vial_price`, else
3. `price ÷ 10`.

This is threaded through consistently:

- **`CustomerOverride`** gains a `vial: number | null` field.
- **Client** (`InvoiceForm.vialPriceForProduct`) prefers the override; the
  affiliate override loader selects `vial_override_price`.
- **Server** (`lib/admin/affiliate-pricing.ts`) applies the same precedence when
  it re-derives affiliate line prices, so the API can't be tricked into a
  different vial price.
- **API** (`/api/admin/price-overrides`) reads and writes `vial_override_price`
  (non-negative), so the value round-trips.
- **Admin UI** (`admin/pricing/customer/[id]`) gains a **Custom Vial** column
  (with the catalog vial price shown as **Default Vial**) alongside the existing
  box price, so admins set a customer's per-vial price like any other cell. An
  override row may carry a box price, a vial price, or both — so `labeled` is now
  nullable and box lines fall through to the price list / catalog when only a
  vial price is set. The bulk "Customer Pricing" tool remains box-only for now,
  and safely leaves `vial_override_price` untouched (it's absent from its
  payload).

The migration also **seeds Kat** (`e112efa7-…`, whose `affiliates.id` ==
`customers.id` == auth uid) with a full override set over every active product:
box = catalog price, vial = 2× catalog vial price. This makes every price on her
invoices come from her own overrides rather than the catalog. Seeded values are
CAD (the catalog currency); if her `price_currency` is USD an admin adjusts.

## Consequences

**Positive**

- Affiliates/customers can be quoted a genuine single-vial price that is
  independent of the catalog and of the box price.
- Uniform precedence (override → catalog → `÷ 10`) across box and vial, on both
  the client and the server, keeps displayed and enforced prices identical.
- Purely additive schema change; existing rows (no `vial_override_price`) behave
  exactly as before.

**Negative / trade-offs**

- One more column to keep in sync across the override loaders, the invoice form,
  the server re-derivation, the price-overrides API, and the pricing editor.
- The bulk "Customer Pricing" matrix does not yet edit vial prices (only the
  per-customer detail editor does); it is box-only but non-destructive to vial.
- The seed assumes CAD pricing for Kat.

## Alternatives considered

- **Derive the vial price from the box override (e.g. `box ÷ vials_per_box`).**
  Rejected: the requirement is an explicit, independently-set vial price (2× the
  catalog), not a fraction of the box price.
- **Store vial prices only on the affiliate, not on `customer_price_overrides`.**
  Rejected: affiliate invoice pricing already reads `customer_price_overrides`
  keyed to the affiliate's own customer id, and regular customers benefit from
  the same column — one place, one precedence.
