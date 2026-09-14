-- Admin Changelog — 2026-07-16 feature batch
-- ==========================================
-- Appends changelog_entries rows for the 2026-07-16 features that do NOT already
-- have a markdown write-up. Mirrors the format of changelog-append-migration.sql:
-- each row is inserted only when an entry with the same title + author
-- ("Engineering") does not already exist, so this file is idempotent and safe to
-- re-run. It never touches entries created through the Admin Changelog UI.
--
-- SCOPE NOTE — 2026-07-16 was a large day; three features are ALREADY documented
-- by existing write-ups and are deliberately EXCLUDED here to avoid duplication:
--   * aminocan/changelogs/2026-07-16-prepaid-invoices-supplier-pos.md
--   * aminocan/changelogs/2026-07-16-convert-to-prepaid-and-backorder-delete.md
--   * changelog/2026-07-16-invoice-stock-box-vial-conversion.md
-- (i.e. prepaid invoices + supplier POs, convert-to-prepaid / backorder delete,
-- and the box→vial stock conversion). Do NOT re-add those here.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping.

-- 1) Grouped, collapsible admin sidebar (PR #195) ----------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Admin — Grouped, collapsible sidebar navigation$cl$,
  $cl$The flat wall of 19 top-of-page nav pills is replaced by a left sidebar organized into 5 labeled sections. It collapses to an icon rail on desktop (remembered), becomes a slide-in drawer on mobile, keeps role gating and badges, and adds Back to Store + Sign Out.$cl$,
  $cl$## Summary

The admin nav was a flat wall of **19 equal-weight pills** wrapping across the
top of every page, with no hierarchy. It is replaced by a **left sidebar**
organized into **5 labeled sections** — *Overview, Orders & Fulfillment,
Catalog, People, System* — so destinations scan as groups.

## What changed

- **Collapsible** to an icon rail on desktop; the preference persists to
  localStorage. Labels / group headings hide and badges shrink to dots.
- **Mobile:** a slide-in drawer with overlay, opened from a compact top bar that
  shows the current page.
- **Role gating preserved** via `canAccessAdminPage`; empty groups are dropped
  (affiliates keep their restricted subset).
- Backorder / low-stock **badges carried over**.
- Sidebar footer adds **Back to Store** and a new **Sign Out** action.

## Files

- `app/(admin)/admin/layout.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Admin$cl$, $cl$Navigation$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$],
  $cl$[{"label": "PR #195", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/195"}]$cl$::jsonb,
  $cl$2026-07-16 10:48:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin — Grouped, collapsible sidebar navigation$cl$ AND author = $cl$Engineering$cl$
);

-- 2) Admin invoices — address editing + Fulfillment panel (PR #194) -----------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Admin invoices — Customer address editing & in-page Fulfillment panel$cl$,
  $cl$The Edit Customer modal now exposes the shipping address fields, and the admin invoice detail page gains a Fulfillment panel mirroring the warehouse queue (packed photos, per-line fulfill/backorder, checklist, status advancement), loaded lazily via a new single-invoice queue endpoint.$cl$,
  $cl$## Summary

Brings warehouse-style fulfillment and address editing into the admin invoice
and customer screens.

## Customers

- The **Edit Customer** modal now exposes the shipping **address fields**
  (address, city, state, postal code, country). The update API and Customer type
  already supported these; this wires them into the UI.

## Invoices

- A **Fulfillment panel** on the admin invoice detail page mirroring the
  warehouse fulfillment queue: **packed photos** (take / upload / delete),
  **per-line fulfill / backorder**, the handling **checklist**, and **status
  advancement**. It loads its own data **lazily** via a new single-invoice queue
  endpoint so it never blocks the invoice's first paint; photos are lazy-loaded.
- A lightweight **camera badge** with photo count on invoice list rows, using
  `packed_photos` already present in the list payload (no extra fetch).

## Backend

- New **`GET /api/warehouse/queue/[id]`** returning one invoice's fulfillment
  record, sharing the queue select/mapping (`QUEUE_SELECT`, `mapQueueRow`)
  between the list and single-invoice routes.

## Files

- `app/(admin)/admin/customers/_components/EditCustomerModal.tsx`
- `app/(admin)/admin/invoices/[id]/page.tsx`
- `app/(admin)/admin/invoices/_components/FulfillmentPanel.tsx`
- `app/(admin)/admin/invoices/page.tsx`
- `app/api/warehouse/queue/[id]/route.ts`, `app/api/warehouse/queue/route.ts`
- `lib/warehouse/api.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Fulfillment$cl$, $cl$Customers$cl$, $cl$Warehouse$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Customers$cl$],
  $cl$[{"label": "PR #194", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/194"}]$cl$::jsonb,
  $cl$2026-07-16 10:01:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin invoices — Customer address editing & in-page Fulfillment panel$cl$ AND author = $cl$Engineering$cl$
);

-- 3) Invoice detail — shipping-status dropdown + toasts (PR #196) --------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Invoices — Shipping-status dropdown & toasts on the detail page$cl$,
  $cl$The invoice detail Fulfillment panel's single-step "advance" button is replaced by a shipping-status dropdown mirroring the list's Shipping column, so any status can be set (including stepping back to fix a mistake), and each change fires a success/error toast.$cl$,
  $cl$## Summary

The admin invoice **list** already let you set an invoice's shipping /
fulfillment status from a dropdown, but the **detail** page's Fulfillment panel
only offered a single-step "advance" button with no explicit feedback.

## What changed

- The advance button is replaced by a **shipping-status dropdown** mirroring the
  list's Shipping column — **To pack / Packed / Shipped / Dropped off**, or
  **Picked up** for pickup orders — so any status can be set, **including
  stepping back** to correct a mistake.
- Each change fires a **success or error toast**.

## Files

- `app/(admin)/admin/invoices/_components/FulfillmentPanel.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Fulfillment$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #196", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/196"}]$cl$::jsonb,
  $cl$2026-07-16 14:22:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Shipping-status dropdown & toasts on the detail page$cl$ AND author = $cl$Engineering$cl$
);

-- 4) Admin products — vial price subscript, column toggles, undo toasts (#197) -
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Admin products — Vial price subscript, column toggles & undo toasts$cl$,
  $cl$The Vial price column is merged into Price (CAD) as an editable subscript, "Vials / Box" and "Min Quantity" are hidden by default behind a new Columns menu, and each inline edit shows a success toast with an Undo button that restores the previous value.$cl$,
  $cl$## Summary

Tidies the admin products table and makes inline editing safer.

## What changed

- **Merge the Vial price column into Price (CAD):** vial price renders as an
  **editable subscript** beneath the main price, keeping inline editing.
- **Hide "Vials / Box" and "Min Quantity"** columns by default and add a
  **Columns** menu to toggle which optional columns show (persisted to
  localStorage).
- **Undo toasts:** each successful inline edit shows a success toast with an
  **Undo** button that restores the previous value; `ToastContext` was extended
  to support an optional action button.

## Files

- `app/(admin)/admin/products/page.tsx`
- `contexts/ToastContext.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Products$cl$, $cl$UI$cl$, $cl$Pricing$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #197", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/197"}]$cl$::jsonb,
  $cl$2026-07-16 14:33:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin products — Vial price subscript, column toggles & undo toasts$cl$ AND author = $cl$Engineering$cl$
);

-- 5) Admin warehouse — fulfillment queue shortcut button (PR #198) ------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Admin warehouse — Fulfillment queue shortcut button$cl$,
  $cl$A distinctive gradient button in the admin warehouse header now links straight to the live /warehouse fulfillment floor, gated to non-read-only roles (admins) — matching who can actually reach it.$cl$,
  $cl$## Summary

Admins can already access the live **/warehouse** fulfillment floor; this
surfaces it directly.

## What changed

- A distinctive **gradient button** in the admin warehouse header links to the
  live fulfillment floor.
- **Gated to non-read-only roles** (admins), matching who can actually reach
  `/warehouse`.

## Files

- `app/(admin)/admin/warehouse/page.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Warehouse$cl$, $cl$Navigation$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Warehouse$cl$],
  $cl$[{"label": "PR #198", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/198"}]$cl$::jsonb,
  $cl$2026-07-16 14:38:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin warehouse — Fulfillment queue shortcut button$cl$ AND author = $cl$Engineering$cl$
);

-- 6) Invoice line items priced from the customer's price list (PR #199) --------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Invoices — Line items priced from the selected customer's price list$cl$,
  $cl$On the admin invoice form, the product picker and default line prices now resolve from the selected customer's applied price list (their customer_price_overrides) layered over the global active pricelist, re-pricing when the admin switches customers.$cl$,
  $cl$## Summary

Invoice line pricing now respects **per-customer** price overrides, not just the
global active pricelist.

## What changed

- On `admin/invoices/[id]`, the product picker and default line prices resolve
  from the selected customer's applied price list (their
  `customer_price_overrides`, managed under **admin/pricing → Customer
  Pricing**).
- New **`getCustomerPriceOverrides()`** fetches a customer's per-product override
  prices (CAD box prices).
- `InvoiceForm` layers those over the global active pricelist in
  `priceForProduct` — **customer override wins, then active pricelist, then
  product default** — and **re-prices** product-bound lines when the admin
  switches customers (the initial mount is preserved so editing keeps the
  invoice's stored prices).
- The line-items helper text now names the customer's price list.

## Files

- `components/admin/InvoiceForm.tsx`
- `lib/admin/pricelists.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Pricing$cl$, $cl$Customers$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Pricing$cl$],
  $cl$[{"label": "PR #199", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/199"}]$cl$::jsonb,
  $cl$2026-07-16 14:43:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Line items priced from the selected customer's price list$cl$ AND author = $cl$Engineering$cl$
);

-- 7) Invoice export to external sites (PR #200/#202) --------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Invoices — Export to external sites (import-invoice Edge Function)$cl$,
  $cl$Push an invoice (line items, customer, payments) from this site to another website running a compatible import-invoice Supabase Edge Function. The receiver matches the customer by email and products by SKU (creating them if missing), with preview/commit modes and a schema-tolerant importer.$cl$,
  $cl$## Summary

**Push an invoice** — with its line items, customer, and payments — from this
site to another website that runs a compatible **import-invoice** Supabase Edge
Function. Data is sent **by value**: the receiver matches the customer by email
and each product by SKU (creating them if missing) and the invoice by its
number.

## Sender side

- **Migration** `invoice-export-migration.sql`: `invoice_export_destinations`
  (configurable destinations with a shared secret) and `invoice_exports`
  (attempt log).
- `lib/admin/invoice-export.ts` builds the by-value payload and calls a
  destination in **preview** (dry-run) or **commit** mode with the shared secret.
- `app/api/admin/invoice-export/*`: destination CRUD, preview, and send routes
  (admin-gated; send logs each attempt).
- **UI:** *Settings → Invoice Export* to manage destinations, a **"Send to
  site"** button on `admin/invoices/:id`, and an **"Export to site"** bulk action
  on `admin/invoices`. Preview shows exactly what will be sent plus the
  receiver's column-compatibility and existence checks.

## Receiving side

- `supabase/functions/import-invoice`: a Deno Edge Function that verifies the
  shared secret, checks column compatibility and existing records, then
  matches/creates the customer and products and inserts the invoice, line items,
  and payments. Existing invoices are skipped unless overwrite is set.
- **Schema-tolerant:** required columns/tables **block**, optional ones (e.g.
  `tax_rate`, `processing_fee`, `with_labels`, or a missing payments table) are
  dropped and reported instead of failing the whole commit
  (`missing_required` / `missing_tables` / `payments_skipped`).

## Migration (run before deploying)

`invoice-export-migration.sql` — creates `invoice_export_destinations` and
`invoice_exports`. The receiver deploys the `import-invoice` Edge Function.

## Files

- `INVOICE-EXPORT.md`
- `lib/admin/invoice-export.ts`
- `app/api/admin/invoice-export/*`
- `app/(admin)/admin/settings/invoice-export/page.tsx`
- `components/admin/ExportInvoiceDialog.tsx`
- `supabase/functions/import-invoice/index.ts`
- `invoice-export-migration.sql`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Integration$cl$, $cl$Export$cl$, $cl$API$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Settings$cl$],
  $cl$[{"label": "PR #200", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/200"}, {"label": "PR #202", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/202"}]$cl$::jsonb,
  $cl$2026-07-16 14:56:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Export to external sites (import-invoice Edge Function)$cl$ AND author = $cl$Engineering$cl$
);

-- 8) Admin invoices — remove redundant Issue date column ----------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Admin invoices — Remove the redundant Issue date column$cl$,
  $cl$The per-row Issue date column is dropped from the admin invoices table because the date is already shown in the per-day group divider rows; the group divider colspan was adjusted accordingly.$cl$,
  $cl$## Summary

The issue date is **already shown in the per-day group divider rows**, so the
per-row **Issue** column was redundant.

## What changed

- Drop the **header, cell, and skeleton placeholder** for the Issue column, and
  adjust the group divider **colspan** accordingly.

## Files

- `app/(admin)/admin/invoices/page.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[]$cl$::jsonb,
  $cl$2026-07-16 17:53:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin invoices — Remove the redundant Issue date column$cl$ AND author = $cl$Engineering$cl$
);
