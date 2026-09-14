# Price Lists & Customer Price-List Application

**Date:** July 10, 2026
**Type:** Feature Addition
**Status:** Completed ✅

---

## Overview

Reworked the admin **Pricing** page around reusable **price lists**, added a
spreadsheet-style price-list editor, and gave the **Customers** area a way to
apply a whole price list to a customer (with a preview and an override/keep
confirmation). Success/error feedback across the new interfaces now uses the
global toast system instead of inline banners.

---

## What Was Added / Changed

### 1. Pricing page is now two workspaces
**Files:** `app/(admin)/admin/pricing/page.tsx`,
`app/(admin)/admin/pricing/_components/PriceListsView.tsx`,
`app/(admin)/admin/pricing/_components/CustomerOverridesView.tsx`

- **Price Lists** is the new default/main view (admin & assistant).
- **Customer Pricing** — the previous per-customer override screen — is now an
  alternate view reachable from a segmented toggle at the top of the page.
- Affiliates continue to see only the Customer Pricing view.
- The old `page.tsx` content was moved verbatim into `CustomerOverridesView`.

### 2. Price Lists view (table + cards)
**File:** `app/(admin)/admin/pricing/_components/PriceListsView.tsx`

Lists every price list with a table/card layout toggle, showing name,
description, product count, date created, created-by, and active/inactive
status. Supports creating a list (optionally copied from an existing one or
seeded from default product prices), activating/deactivating, and deleting.

A pinned, read-only **Default Prices** record represents the catalog's own
prices (the `products` table). It cannot be edited here (edit under Products)
or deleted; it shows as "Active" whenever no custom list is active, and a
**Use default** action clears the active list so the catalog prices apply.

### 3. Spreadsheet-style price-list editor
**File:** `app/(admin)/admin/pricing/list/[id]/page.tsx`

A paginated grid of all active products showing default price, the editable
**list price**, and the percentage up/down vs. default. Only the list price is
editable; `↑ / ↓ / Enter` move between rows like a spreadsheet, changed cells
are highlighted, and a sticky bar tracks unsaved changes. The list's
name/description and active status can be edited inline.

### 4. Spreadsheet-style customer price editor
**File:** `app/(admin)/admin/pricing/customer/[id]/page.tsx`

The per-customer override screen now uses the same spreadsheet grid: a
paginated list of all products with default price, an editable **custom
price**, and the % change. `↑ / ↓ / Enter` move between rows; clearing a cell
removes the override and falls back to the default. Changes batch-save (upserts
+ deletes) with a sticky unsaved-changes bar.

### 5. Apply a price list to a customer
**Files:**
`app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`,
`app/(admin)/admin/customers/_components/CustomerPricingModal.tsx`,
`app/(admin)/admin/customers/page.tsx`,
`app/(admin)/admin/customers/_components/EditCustomerModal.tsx`

- A new **Pricing** action (tag icon) on each customer row opens a modal to
  apply a price list.
- The **Edit Customer** modal is now wider (two-column) with a dedicated
  **Pricing** section.
- Applying shows a **preview** (current vs. new price per product) and a
  **confirmation**. When the customer already has custom prices for products in
  the list, a choice is offered: **Price list wins** (overwrite) or
  **Keep existing** (only fill gaps).
- The pricing panel also shows a **Current prices** table (default vs. applied
  price for every product), searchable by product name or SKU and paginated.
- The **New Customer** modal gained an optional **Price List** selector; the
  chosen list is applied to the customer immediately after creation.

### 6. API
**Files:** `app/api/admin/pricelists/route.ts`,
`app/api/admin/pricelists/[id]/route.ts`,
`app/api/admin/pricelists/[id]/apply-to-customer/route.ts`,
`app/api/admin/customers/route.ts`

- Price lists now carry `description` and `created_by` (returned with the
  creator's name).
- New endpoint `POST /api/admin/pricelists/[id]/apply-to-customer` copies the
  list's item prices into `customer_price_overrides` (mode `override` or
  `keep_existing`) and records the source list on the customer.
- The customers list now embeds the applied price list's name.

### 7. Toasts as the norm
New/edited interfaces (price lists, list editor, customer pricing, edit
customer) report success/error via the global `useToast()` system.

---

## Database Migration

**File:** `pricelist-enhancements-migration.sql` — run in the Supabase SQL editor.

- `pricelists.description` (text) and `pricelists.created_by` (fk → customers).
- `customers.applied_pricelist_id` (fk → pricelists, `ON DELETE SET NULL`) —
  records which list a customer's prices came from.

> The new API queries reference these columns/foreign keys, so apply the
> migration before deploying.
