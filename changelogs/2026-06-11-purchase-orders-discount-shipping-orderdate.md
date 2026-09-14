# Purchase Orders — Discount, Shipping Fee, Order Date & Receiving Fixes

**Date:** June 11, 2026
**Type:** Feature + Bug Fix
**Status:** Completed ✅

---

## Overview

Adds discount, shipping-fee and order-date support to purchase orders, reorders
the financial summary, and fixes two receiving bugs.

---

## What Was Changed

### 1. Discount & shipping fee fields
- New `discount`, `shipping_fee`, `discount_type` and `discount_value` columns on
  `purchase_orders`.
- The create/edit form (`PurchaseOrderForm.tsx`) now has a **Shipping fee** input
  and a **Discount** that is toggleable between **Percentage** and **Fixed**
  (mirroring the tax control) in the Financial Summary card.
- `discount` stores the computed dollar amount (like `tax_total`); a percentage
  discount is applied to the product subtotal.
- Financial summary order is now: **Subtotal → Shipping fee → Discount → Tax → Total**.
  Percentage tax is applied to the running total (subtotal + shipping − discount).
- Totals are recomputed server-side in both the POST and PATCH routes and shown
  on the PDF.

### 2. Order date
- New `order_date` column on `purchase_orders` (backfilled to `created_at` for
  existing rows).
- Editable in the form's Details card; shown on the dashboard list (new **Order
  Date** column), the detail header, and the PDF.

### 3. Fix: receiving failed against the live `inventory_log` table
- The live `inventory_log` is the app's real inventory table, with a different
  shape than the repo migrations assumed. Its canonical columns are
  `change_qty` (NOT NULL), `reason` (NOT NULL) and `reference_id` (**text**),
  plus a legacy `variant_id`. The mismatch surfaced as a chain of errors:
  `column "product_id" ... does not exist`, then
  `null value in column "variant_id" ...`, then
  `null value in column "change_qty" ...`.
- The migration now reconciles the table (`ADD COLUMN IF NOT EXISTS` for the
  newer `product_id` / `reference_type` / `delta` aliases, drops the legacy
  `NOT NULL` on `variant_id`), and `receive_po_items()` / `apply_po_inventory()`
  write the columns that actually exist — populating `change_qty` and casting the
  receipt/PO id into the text `reference_id`.

### 4. Fix: "Purchase order is paid and cannot receive items"
- `receive_po_items()` now only blocks receiving for **cancelled** orders. A
  **paid** PO can still receive stock (paid-before-delivery is common), and its
  `paid` status is preserved after the receipt instead of reverting to a
  fulfilment status.
- Front-end gating switched from `isPoLocked` to the new `canReceivePo` helper.

---

## Files Touched

- `purchase-orders-discount-shipping-migration.sql` (new)
- `lib/supabase.ts` — `PurchaseOrder` type
- `lib/admin/purchase-orders.ts` — input/patch types
- `lib/admin/po-status.ts` — `canReceivePo()`
- `app/api/admin/purchase-orders/route.ts` — POST totals
- `app/api/admin/purchase-orders/[id]/route.ts` — PATCH totals
- `app/api/admin/purchase-orders/[id]/pdf/route.ts` — PDF rows + order date
- `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`
- `app/(admin)/admin/purchase-orders/PurchaseOrderReceiving.tsx`
- `app/(admin)/admin/purchase-orders/page.tsx`
- `app/(admin)/admin/purchase-orders/[id]/page.tsx`

---

## Deployment

Run `purchase-orders-discount-shipping-migration.sql` against Supabase. It is
idempotent and safe to run multiple times.
