# Supplier Pricelists

**Date:** June 11, 2026
**Type:** Feature
**Status:** Completed ✅

---

## Overview

Each supplier now carries its own pricelist of our products. Those prices drive
purchase-order line pricing and power a "cheaper supplier" alert on the PO
creation page.

---

## What Was Added

### 1. Per-supplier pricelists (`supplier_prices`)
- New `supplier_prices(supplier_id, product_id, price)` table (`supplier-pricelists-migration.sql`).
- Existing suppliers are seeded with every active product at the default
  `products.price`; new suppliers are seeded by the `POST /api/admin/suppliers`
  route. Products without a row fall back to `products.price` everywhere.

### 2. Supplier Pricelists tab
- New page **Purchase Orders → Pricelists** (`/admin/purchase-orders/supplier-pricelists`),
  linked from the PO index and the Suppliers page.
- Supplier picker at the top, then an editable table: **Product · SKU · Original
  price · Supplier price**.
- Keyboard navigation: `↑` / `↓` / `Enter` move between Supplier price cells.
- Unsaved edits are highlighted; a sticky save bar persists changes.
- **CSV**: download a template (SKU + current prices) and upload a filled CSV —
  rows are matched to products **by SKU**, matched prices save automatically, and
  unknown/invalid rows are reported.

### 3. PO creation page
- **Line items are locked until a supplier is selected** — the Products card
  shows a clear locked state until then.
- When a supplier is chosen, line `unit_price` auto-fills from that supplier's
  pricelist (falling back to the product default). Changing the supplier
  re-prices all (unlocked) lines.
- **Cheaper-supplier detection**: adding a product that another supplier sells
  for less opens a dialog to either **switch the PO to the cheaper supplier**
  (re-prices all lines) or **keep the current supplier**. A toggle in the
  Products card turns the detection on/off.
- Tooltips throughout (supplier hint, detection toggle, pricelist columns, CSV
  buttons, keyboard hint).

---

## API

- `GET /api/admin/suppliers/:id/prices` — active products + this supplier's price.
- `PUT /api/admin/suppliers/:id/prices` — upsert `{ items: [{ product_id, price }] }`.
- `GET /api/admin/supplier-prices/cheapest` — cheapest supplier per product.

---

## Deployment

Run `supplier-pricelists-migration.sql` against Supabase (idempotent).
