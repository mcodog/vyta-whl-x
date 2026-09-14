# Pricing panel — per-vial prices, template column & signed adjust multiplier

Date: 2026-08-12

The "Apply a price list · multiply · convert" panel (used on the customer
pricing page **and** the sales person → Pricing tab) now works with single-vial
prices, not just box (case) prices, and its multiplier reads as a plain
markup/markdown. Applying a list or copying a customer now sets each product's
per-vial override too, so the salesperson's own invoices pre-fill the vial price
they were given.

## Apply-a-price-list panel (`CustomerPricingPanel`)

- **Vial prices everywhere.** Both the **Current prices** table and the
  **Preview** now show box (case) and single-vial prices side by side, under a
  grouped `Box (case)` / `Vial` header so the two are clearly distinct.
- **Template price list column.** The Current prices table shows the price for
  each product in the customer's applied **template** price list, next to the
  catalog **Default** and their **Applied** override.
- **Vial price from …** a new basis selector controls where the applied vial
  price comes from:
  - **Catalog vial** — the product's own single-vial price (`vial_price`, else
    box ÷ 10). The default.
  - **Box ÷ 10** — a tenth of the source box price (vials track the box discount).
  - **Retail price** — the catalog retail (box) price.
  - **Source's vial** — when copying from another customer, that customer's own
    per-vial price (the default for a customer source).
- **Adjust price** replaces the old multiplier. Presets are now signed
  adjustments — **0% = unchanged**, negatives deduct (**−25% / −50% / −75%**),
  positives mark up (**+25% / +50% / +100% / +200%**). Same math underneath, just
  clearer to read.
- Box and vial each get their **own** adjust multiplier and rounding (see the
  2026-08-12 "vials get their own multiplier & rounding" follow-up); the CAD→USD
  convert is shared.
- A small **Hidden** marker now appears in the Current prices table for products
  the customer has hidden.

## Apply (`/api/admin/pricing/apply-transformed`)

- Accepts a `vial_basis` and writes each product's `vial_override_price`
  alongside the box `override_price`, derived from the chosen basis and run
  through the same multiplier / convert (no box rounding).
- Copying **from a customer** now carries that customer's per-vial prices, not
  just their box prices.

## Storefront — configured prices shown to the logged-in customer

The storefront applied a customer's **box** override + visibility but always
showed the **catalog** single-vial price. It now shows the per-vial price
configured for the signed-in customer everywhere:

- `/api/products` and `/api/products/featured` now select `vial_override_price`
  and return it as the product's `vial_price` (alongside the box `override_price`
  and the existing $0 / hidden visibility rules). The product list, product
  detail, add-to-cart modal and checkout add-ons all read `vial_price`, so the
  configured single-vial price flows through automatically — and into the cart /
  order.
- **`Hero.tsx`** no longer bypasses overrides: for a signed-in customer it layers
  their configured box + vial prices and visibility onto the featured card
  (previously it always showed catalog prices and ignored per-customer
  visibility).

## Invoices — configured prices when a non-admin client is logged in

Already enforced and confirmed: when an affiliate / salesperson (a non-admin
"client") creates or edits an invoice, every line's price is re-derived
server-side from their configured pricing — their own `customer_price_overrides`
(box **and** vial) → the active price list → catalog default — ignoring any price
submitted by the client (`enforceAffiliateLinePrices` in the invoice POST and
PATCH routes). Because applying prices now writes the per-vial override too, the
vial price they were given pre-fills their invoices.

## Notes

- Price lists still store box prices only — the per-vial override is derived from
  the selected basis at apply time.
- Per-product hand editing of box price, vial price and visibility is unchanged
  and still lives under **Edit individually** (the per-customer grid).
