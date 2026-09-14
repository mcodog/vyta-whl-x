# Vial Pricing — explicit single-vial price, history & box/vial tagging

Date: 2026-06-28

Products now carry an explicit `vial_price` (single-vial price) alongside
`price` (the pack-of-10 / "box" price). The storefront uses `vial_price`
instead of the old `price ÷ 10` rule, admins can edit and track it, and every
order / invoice / purchase-order line records whether it was priced as a box
or a single vial.

## Customer-facing

- **Single vial** now charges `vial_price` (falling back to `price ÷ 10` when a
  product has no vial price set); a **pack of 10** still charges `price`.
- Updated everywhere a per-vial price was derived: the add-to-cart modal, the
  product detail page (now shows "$X / single vial"), and the product list
  cards (per-vial line under the pack price).
- The cart stores which option was chosen (`priceType`) so it flows into the
  order.

## Orders

- Order line items now store `price_type` (`box` / `vial`). The admin order
  detail and the customer order detail show a **Single vial** / **Pack of 10**
  tag per line. Orders placed before this change have no tag (left untagged, as
  requested).

## Invoices & Purchase Orders

- Each line item has a **Box / Vial** toggle (defaults to **Box**). Switching
  re-prices the line from the product's box vs vial price; the choice is saved
  on the line (`price_type`) and shown on the invoice detail. Existing lines
  backfill to `box`.

## Admin Products

- New **Vial price** column with inline editing (blank = "auto", i.e. price÷10).
- Vial price added to the create/edit product form.
- The per-product **History** modal gained a **Vial price** tab (with revert),
  alongside Price and Stock. This modal is the admin per-product view.

## Data model

- `products.vial_price` (added on the DB) is now surfaced on the `Product` type
  and editable from admin; changes are tracked in `product_change_history`
  (its `field` check now allows `vial_price`, with a seeded baseline row).
- `order_items.price_type` — nullable (existing orders stay untagged).
- `invoice_line_items.price_type` / `purchase_order_items.price_type` —
  `NOT NULL DEFAULT 'box'`.

Migration: `vial-price-and-price-type-migration.sql`.

## Notes / assumptions

- The `vial_price` value the DB returns after an insert/update is what gets
  recorded in history, so the timeline stays accurate even if the
  `trg_products_set_vial_price` trigger adjusts the value.
- Customer price overrides apply to the box `price` only; the single-vial price
  is the catalog `vial_price` for all customers.
- Invoice/PO PDFs and confirmation emails were left as-is (the box/vial tag is
  shown in the admin UI and on the invoice detail page).

## Files

- `vial-price-and-price-type-migration.sql`, `lib/supabase.ts`,
  `lib/admin/product-history.ts`, `lib/admin/invoices.ts`,
  `lib/admin/invoice-split.ts`
- Customer: `components/AddToCartModal.tsx`, `components/Products.tsx`,
  `contexts/CartContext.tsx`, `app/products/page.tsx`,
  `app/products/[slug]/page.tsx`, `app/api/products/featured/route.ts`
- Orders: `app/api/orders-email/route.ts`, `app/api/orders/route.ts`,
  `app/(admin)/admin/orders/[id]/page.tsx`,
  `app/(customer)/account/orders/[id]/page.tsx`
- Admin products: `app/(admin)/admin/products/page.tsx`,
  `app/api/admin/products/route.ts`, `app/api/admin/products/[id]/route.ts`
- Invoices: `components/admin/InvoiceForm.tsx`,
  `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts`,
  `app/(admin)/admin/invoices/[id]/page.tsx`
- Purchase orders: `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`,
  `app/(admin)/admin/purchase-orders/new/page.tsx`,
  `app/api/admin/purchase-orders/route.ts`,
  `app/api/admin/purchase-orders/[id]/route.ts`
