# Prepaid Invoices & Attached Supplier Purchase Orders

**Date:** July 16, 2026
**Type:** Feature
**Status:** Completed ✅

---

## Overview

A new **Prepaid Invoice** flow for the scenario where a client pays us up front
to procure product from our suppliers. A prepaid invoice behaves like an ordinary
invoice, but its detail page grows a **Supplier Purchase Orders** panel that
routes every line item to a supplier (cheapest auto-selected, fully overridable),
groups the lines by supplier, and generates one purchase order per supplier —
each linked back to the invoice. The generated POs download as **price-less**
supplier PDFs containing only SKU, description and quantity.

---

## What Was Added

### 1. Prepaid invoice type
- New `invoices.invoice_type` column (`'standard' | 'prepaid'`, default
  `'standard'`) and `purchase_orders.source_invoice_id` FK linking a PO to the
  prepaid invoice it was generated from (`prepaid-invoices-migration.sql`).
- New **Prepaid Invoice** tab on the Invoices page. It reuses the invoices list,
  filtered to `invoice_type = 'prepaid'`, with its own **New Prepaid Invoice**
  CTA. The standard **Invoices** tab now shows standard invoices only.
- The invoice form (`/admin/invoices/new?type=prepaid`) creates the invoice with
  `invoice_type = 'prepaid'`; the type is preserved on edit. A **Prepaid** badge
  appears on the new/edit pages and the invoice detail header.

### 2. Supplier routing in the invoice form
- The prepaid invoice form shows a **Supplier routing** card directly below the
  line items: each product line gets a supplier picker (cheapest auto-selected,
  overridable) and a live preview of the purchase orders that will be prepared,
  grouped by supplier. The choice is saved on the line
  (`invoice_line_items.preferred_supplier_id`) and honoured when the POs are
  generated. Backed by `POST /api/admin/supplier-options` (by product ids).

### 3. Supplier Purchase Orders panel
- New `PrepaidPurchaseOrders` panel at the bottom of a prepaid invoice's detail
  page. For every product-linked line item it shows a custom **supplier picker**
  (`SupplierSelect`) that:
  - auto-selects the **cheapest** supplier for each product (from
    `supplier_prices`), flagged with a "Cheapest" badge;
  - lists every supplier with their per-product price, lead time, and a
    "catalog price" hint when a supplier has no explicit price;
  - can be overridden per line, with a warning when the pick isn't the cheapest.
- Lines are grouped into a live **draft PO preview** (one card per supplier, with
  cost, unit count and lead time). One click creates all POs at once.
- Free-text lines (no catalog product) are surfaced separately as not
  auto-routable.

### 3. Price-less supplier PDFs
- The PO PDF route accepts `?prices=hidden` — the document then contains only
  **SKU · Description · Qty** (no unit price, landed cost, totals), for sending
  to a supplier. Each generated PO has a **PDF** button, plus **Download all**.

### 4. APIs
- `GET /api/admin/invoices/:id/supplier-options` — suppliers + prices per line
  item product, cheapest flagged.
- `GET/POST /api/admin/invoices/:id/purchase-orders` — list POs for an invoice /
  create one PO per supplier group (totals + landed cost computed server-side,
  partial success reported), linked via `source_invoice_id`.
- `GET /api/admin/invoices` gains an `invoice_type` filter; create/update accept
  and persist `invoice_type`.

---

## Migration

Run `prepaid-invoices-migration.sql` (idempotent) to add `invoices.invoice_type`
and `purchase_orders.source_invoice_id`.
