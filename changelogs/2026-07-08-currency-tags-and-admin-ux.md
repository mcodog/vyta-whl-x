# Per-customer currency tags, CAD/USD analytics & admin UX polish

**Date:** 2026-07-08
**Area:** Admin pricing, customers, invoices, analytics, products, commissions,
sales-people & affiliates
**PR:** [#132](https://github.com/thepuragroup-droid/aminocan-whl/pull/132)
**Migration:** `aminocan/customer-price-currency-migration.sql`

## Summary

This session added per-customer CAD/USD billing tags, split analytics revenue by
currency, fixed and rebuilt the customer-pricing interface, and applied a round
of loading/pagination polish across the admin tables.

## Migration (run before deploying)

`customer-price-currency-migration.sql` adds a `price_currency` column
(`'CAD' | 'USD'`, default `'CAD'`) to `customers`. Idempotent. No other schema
changes — the CAD/USD analytics reuse the existing `invoices.currency` column.

## Per-customer currency tag (CAD / USD)

- New `customers.price_currency` column tags which currency a customer is billed
  in.
- **New Customer** and **Edit Customer** modals include a CAD/USD toggle; the
  customers API reads/writes the field.
- Picking a customer on the **invoice form** defaults the invoice currency to
  their tag and re-prices product-bound lines (still overridable per invoice).
- On the pricing page each customer card has a **CAD/USD toggle button** (beside
  *Add override*) — admins click it to switch and persist the customer's billing
  currency (optimistic, rolls back on failure); non-admins see a read-only tag.

## CAD / USD analytics

- The analytics summary API produces a `revenue.by_currency` breakdown — CAD and
  USD each with their own invoiced / paid / outstanding / counts. Amounts are
  never converted between currencies; pre-flag invoices count as CAD.
- **Admin → Analytics** gains a **Revenue by currency** section with a CAD card
  and a USD card.

## Customer-pricing interface

- The **Add / Edit Price Override** modal is larger, and `MultiSelectCustomer`'s
  dropdown now uses fixed positioning so a scrollable modal can no longer clip
  the customer list.
- The flat overrides table was replaced with a **grouped card grid**, toggleable
  **By Customer** / **By Product**, searchable, 2-column, with **pagination**
  (all customers listed, 10 per page) and **skeleton loading**.
- Each card previews a few overrides with an **Add override** shortcut and a
  **See all** link to a new per-customer / per-product detail page
  (`/admin/pricing/customer/[id]`, `/admin/pricing/product/[id]`) with full
  add/edit/delete.
- **Bulk Edit Pricing**: larger step-1 modal; step 2 drops the Status column and
  supports **↑ / ↓ / Enter** to move between price fields; new **step 3 review**
  summarising which overrides will be created/updated and for whom before saving.

## Customers page

- Removed the **Joined** and **Role** columns; the role now shows as a **tag
  beside the customer name**.
- Row actions became **icon-only buttons** with a custom white, shadowed hover
  tooltip.

## Loading & pagination polish

- New shared `TableSkeleton` (shimmer rows) and `Pagination` (Prev / Next
  footer) components.
- **Products** — skeleton rows while loading (already paginated).
- **Commissions**, **Sales People**, **Affiliates** — added 20-per-page
  pagination and skeleton loading.
