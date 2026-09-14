# Purchase Order line items — invoice-style product picker & roomier layout

**Date:** 2026-07-13
**Area:** Admin (Purchase Orders — create & edit form)
**Migrations:** none

## Summary

Reworked how products are added to a purchase order so it matches the **Create
Invoice** flow, and gave the selected line items a cleaner, less cramped layout.

- **Per-line product search (like invoices).** The old catalog *grid of
  clickable tiles* + separate "Selected Products" table is gone. Each line item
  is now its own card with an inline type-to-search box: type, pick a match from
  the dropdown, and the product binds to that line and auto-prices from the
  supplier's pricelist. "Add another item" appends a fresh line.
- **Slug shown prominently.** On every bound line the product **slug** renders as
  a prominent monospace chip directly under the search field, with the SKU
  snapshot kept as a smaller secondary detail. On existing POs the slug is
  resolved from the live product catalog (falling back to the stored snapshot).
- **Smarter, roomier layout.** The Qty / Unit $ fields are now fixed, right-sized
  inputs instead of full-width cells whose borders merged together. Each control
  is labeled, the line total is pushed to the right, and the remove button sits
  inline — no more squished table.

## Behavior preserved

- **Supplier-first gating** — the products section stays locked with its empty
  state until a supplier is chosen, and shows the "loading prices" state while a
  supplier's pricelist is fetched.
- **Auto-pricing & the Box / Vial toggle** per line, re-pricing from the
  supplier's catalog.
- **Cheaper-supplier alerts** — picking a product another supplier sells for less
  still opens the switch/keep prompt; it now binds to the originating line
  instead of appending a new one.
- **Locked / receiving-started POs** remain read-only.

## Implementation notes

- All changes are in
  `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`.
- Line-item state is now index-based (`addLine` / `patchLine` / `removeLine`),
  mirroring `InvoiceForm`. A per-line `activeLineIdx` drives which typeahead
  dropdown is open, closed on outside click.
- `pickProductForLine` runs the cheaper-supplier check before binding; the
  cheaper-supplier prompt carries the target `lineIdx`.
- Submit drops blank rows (no product bound and no free-text description) before
  validating there's at least one line item.

## Files

- `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`
