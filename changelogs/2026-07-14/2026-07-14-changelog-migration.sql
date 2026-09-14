-- Admin Changelog — 2026-07-14 feature batch
-- ==========================================
-- Appends changelog_entries rows for the PRs that merged to main on 2026-07-14
-- (#171, #172, #177, #178, #185, #186) that do NOT already have a markdown
-- write-up. Mirrors the format of changelog-append-migration.sql: each row is
-- inserted only when an entry with the same title + author ("Engineering") does
-- not already exist, so this file is idempotent and safe to re-run. It never
-- touches entries created through the Admin Changelog UI.
--
-- SCOPE NOTE — several PRs that also merged on 2026-07-14 are ALREADY documented
-- by existing 2026-07-13 write-ups and are deliberately EXCLUDED here:
--   * #173 → changelogs/2026-07-13-invoice-cancel-stock-restore.md
--   * #175 → changelogs/2026-07-13-easyship-invoice-sync.md
--   * #176 → changelogs/2026-07-13-fulfillment-queue-box-vial-info.md
--   * #180 → changelogs/2026-07-13-invoice-print-box-vial.md
-- Their commits were authored on the 13th. Do NOT re-add those here.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping.

-- 1) Invoice list — clickable rows + inline fulfillment dropdown (PR #171) ----
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Invoices — Clickable list rows & inline fulfillment-status dropdown$cl$,
  $cl$Whole invoice rows now open the detail page, and the Shipping column becomes a dropdown that sets the fulfillment status (packed / shipped / dropped off, or picked up for pickup invoices), saved optimistically and synced to the linked order. Adds a new "dropped off" status.$cl$,
  $cl$## Summary

Faster fulfillment triage straight from the admin invoice **list**.

## What changed

- **Whole invoice rows** now navigate to the detail page (interactive cells stop
  propagation).
- The **Shipping column** becomes a dropdown to set the fulfillment status —
  **packed, shipped, or dropped off** (**picked up** for pickup invoices) —
  saved **optimistically** via the admin invoice PATCH route, which stamps
  who/when and **syncs the linked order's status** for terminal steps.
- Adds a new **`dropped_off`** fulfillment status (we handed the parcel to the
  courier) across the type, warehouse helpers/validation, and a DB migration.

## Migration (run before deploying)

`invoice-dropped-off-status-migration.sql`.

## Files

- `app/(admin)/admin/invoices/page.tsx`
- `app/api/admin/invoices/[id]/route.ts`
- `app/api/warehouse/queue/[id]/route.ts`
- `lib/admin/invoices.ts`, `lib/warehouse/api.ts`, `lib/supabase.ts`
- `invoice-dropped-off-status-migration.sql`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Fulfillment$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #171", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/171"}]$cl$::jsonb,
  $cl$2026-07-14 11:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Clickable list rows & inline fulfillment-status dropdown$cl$ AND author = $cl$Engineering$cl$
);

-- 2) Easyship — courier handover, insurance & optional recipient (PR #171) ----
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Shipping — Easyship courier handover, insurance & optional recipient contact$cl$,
  $cl$Easyship shipments gain a per-shipment insurance toggle and a courier-handover choice (courier pickup vs we drop off), surfaced in the Shipping Label panel and the invoice form. A missing customer email or phone no longer blocks a shipment — house defaults fill in.$cl$,
  $cl$## Summary

More control over how Easyship shipments are created, and fewer things that can
block a label.

## Insurance & handover

- **Insurance** is a per-shipment toggle wired to the verified
  `insurance.is_insured` shipment field.
- **Handover** (courier pickup vs we drop off) is applied best-effort via
  Easyship's Carrier Pickup API **after** the shipment exists — **non-blocking**
  so it never undoes a bought label (request shape provisional pending verified
  docs).
- Both options are surfaced in the **Shipping Label panel** and the **invoice
  form**, and threaded through create-shipment, invoice create (POST) and edit
  (PATCH).

## Optional recipient contact

- Recipient **email & phone are now optional**: the client-shipment **house
  defaults** (aminoship@proton.me / house phone) are reused so a missing customer
  email or phone never blocks a shipment or label. The defaults live in a
  dependency-free module and the readiness checks mark phone/email optional.

## Files

- `app/(admin)/admin/orders/[id]/_components/ShippingLabelPanel.tsx`
- `components/admin/InvoiceForm.tsx`
- `app/api/admin/orders/[id]/create-shipment/route.ts`
- `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts`
- `app/api/admin/invoices/shipping-readiness/route.ts`
- `lib/shipping/easyship.ts`, `lib/shipping/auto-shipment.ts`,
  `lib/shipping/contact-defaults.ts`, `lib/shipping/labelReadiness.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Shipping$cl$, $cl$Easyship$cl$, $cl$Invoices$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #171", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/171"}]$cl$::jsonb,
  $cl$2026-07-14 10:45:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Shipping — Easyship courier handover, insurance & optional recipient contact$cl$ AND author = $cl$Engineering$cl$
);

-- 3) Admin pricing — card view is the default (PR #172) -----------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Admin pricing — Card view is now the default for price lists$cl$,
  $cl$The admin pricing Price Lists view now opens in card view by default instead of the table.$cl$,
  $cl$## Summary

- The admin pricing **Price Lists** view now defaults to **card view** instead
  of the table (the table remains available via the view toggle).

## Files

- `app/(admin)/admin/pricing/_components/PriceListsView.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Pricing$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Pricing$cl$],
  $cl$[{"label": "PR #172", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/172"}]$cl$::jsonb,
  $cl$2026-07-14 10:30:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin pricing — Card view is now the default for price lists$cl$ AND author = $cl$Engineering$cl$
);

-- 4) NumberInput — fix unremovable placeholder 0 (PR #177) --------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$bugfix$cl$,
  $cl$Admin forms — Number fields can be cleared (no more stuck placeholder 0)$cl$,
  $cl$Invoice and purchase-order numeric fields (Qty, Unit $, Disc %, Tax, Shipping, Processing fee, Discount, Commission, Lead-time) were bound to state defaulting to 0/1, so the field could never be blank. A new NumberInput treats empty as null, so fields start blank and can be fully cleared.$cl$,
  $cl$## Summary

Invoice and purchase-order line-item fields (**Qty, Unit $, Disc %**) plus the
**Tax, Shipping, Processing fee, Discount, Commission** and **Lead-time** inputs
were bound to numeric state defaulting to **0 / 1**, so the field could never be
blank and the leading value couldn't be deleted.

## What changed

- A reusable **`NumberInput`** component represents an empty field as **null**:
  the field starts blank, can be fully cleared, and still accepts partial decimal
  input (e.g. `"1."`) while focused.
- Line-item and summary numeric state becomes **`number | null`**; totals coerce
  a blank field to 0 and, on save, **Qty falls back to 1** and **prices/rates to
  0**, so filled-in forms behave exactly as before.

## Files

- `components/admin/NumberInput.tsx`
- `components/admin/InvoiceForm.tsx`
- `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`
- `app/(admin)/admin/purchase-orders/suppliers/page.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Purchase Orders$cl$, $cl$Forms$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Purchase Orders$cl$],
  $cl$[{"label": "PR #177", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/177"}]$cl$::jsonb,
  $cl$2026-07-14 10:15:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin forms — Number fields can be cleared (no more stuck placeholder 0)$cl$ AND author = $cl$Engineering$cl$
);

-- 5) Rebrand document/PDF/report titles to PuraMass (PR #178) -----------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Documents — Rebrand generated PDFs & reports from Aminocan to PuraMass$cl$,
  $cl$Brand titles/headers in generated invoices, packing lists, purchase orders, stock reports and commission reports (and PDF metadata) now show PuraMass instead of Aminocan. Functional contact details are left unchanged.$cl$,
  $cl$## Summary

- Brand titles and headers in generated **invoices, packing lists, purchase
  orders, stock reports and commission reports** now show **PuraMass** instead of
  Aminocan.
- **PDF metadata** (Title / Author / Creator) is updated to match.
- Functional contact details (**aminocan.com**, **info@aminocan.com**) are left
  **unchanged**.

## Files

- `lib/admin/invoice-html.ts`, `lib/invoice-pdf.ts`
- `lib/admin/packing-list-pdf.ts`, `lib/admin/report-html.ts`,
  `lib/admin/stock-report-pdf.ts`
- `app/api/admin/purchase-orders/[id]/pdf/route.ts`
- `app/api/admin/commissions/report/route.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Branding$cl$, $cl$Documents$cl$, $cl$PDF$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Reports$cl$],
  $cl$[{"label": "PR #178", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/178"}]$cl$::jsonb,
  $cl$2026-07-14 10:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Documents — Rebrand generated PDFs & reports from Aminocan to PuraMass$cl$ AND author = $cl$Engineering$cl$
);

-- 6) Invoices — backorder override toggle (PR #185) --------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Invoices — Backorder override (keep the whole order on one invoice)$cl$,
  $cl$The backorder confirmation dialog (shown when line items exceed available stock) now offers an Override toggle that forces the whole order onto a single invoice instead of splitting off a backorder.$cl$,
  $cl$## Summary

The backorder confirmation dialog — shown on create/edit when line items exceed
available stock — now offers an **Override** toggle.

## What changed

- **Override** forces the whole order onto a **single invoice** instead of
  splitting off a backorder.
- **`InvoiceForm`:** the toggle sits in the Backorder confirmation modal, sends
  `override_backorder` in the payload, and adapts the copy / primary button.
- **`POST /invoices`:** when `override_backorder` is set, skips
  `computeStockSplit` and puts every quantity on one invoice (no backorder
  created).
- **`PATCH /invoices/[id]`:** on override, clears any open backorder instead of
  recomputing it from stock.
- **`backorder-sync`:** extracts a `clearOpenInvoiceBackorder` helper for reuse.

## Files

- `components/admin/InvoiceForm.tsx`
- `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts`
- `lib/admin/backorder-sync.ts`, `lib/admin/invoices.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Backorders$cl$, $cl$Inventory$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #185", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/185"}]$cl$::jsonb,
  $cl$2026-07-14 15:24:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Backorder override (keep the whole order on one invoice)$cl$ AND author = $cl$Engineering$cl$
);

-- 7) Analytics — revamped page (PR #186) -------------------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Analytics — Revamped page with grouped sections, charts & leaderboards$cl$,
  $cl$The Analytics page is restructured into grouped sections (Overview, Revenue, Inventory & Supply, Performance) with a sticky mini-nav and scrollspy, inline SVG charts (paid/outstanding donut, per-currency stacked bars, top-products bars), and ranked leaderboards for top customers, sales people, affiliates and products.$cl$,
  $cl$## Summary

A ground-up revamp of the admin **Analytics** page.

## What changed

- **Restructured** into grouped sections — *Overview, Revenue, Inventory &
  Supply, Performance* — with a **sticky mini-navigation** and **scrollspy**.
- **Inline SVG charts:** a paid/outstanding **donut**, per-currency **stacked
  bars**, a **top-products** bar chart, and ranked **performance
  leaderboards**.
- The analytics summary API is extended with **performance leaderboards**: top
  customers, top sales people, top affiliates (revenue + commission / invoice
  counts) and top-selling products (units + revenue), reusing the same date
  scope.

## Files

- `app/(admin)/admin/analytics/*`
- analytics summary API route$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Analytics$cl$, $cl$Reports$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Analytics$cl$],
  $cl$[{"label": "PR #186", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/186"}]$cl$::jsonb,
  $cl$2026-07-14 15:45:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Analytics — Revamped page with grouped sections, charts & leaderboards$cl$ AND author = $cl$Engineering$cl$
);

-- 8) Invoices — page size, Create & Send toggle, deleted-customer tag (#186) --
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Invoices — Smaller default page size, opt-in Create & Send, deleted-customer tag$cl$,
  $cl$Invoice UX fixes shipped alongside the analytics revamp: the list defaults to 10 rows (editable, persisted), Create Invoice now has an explicit opt-in Create & Send toggle (email only fires when opted in), a deleted customer's name/email is snapshotted onto their invoices with a Deleted tag, and a $0 customs value no longer 422s Easyship rates.$cl$,
  $cl$## Summary

Invoice UX fixes and an Easyship correction that shipped in the same PR as the
analytics revamp.

## Invoices

- **List page size** defaults to **10** (was 20) with an editable rows-per-page
  selector persisted in localStorage — shorter load time.
- **Create Invoice:** the always-labelled "Create & Send" is replaced with an
  explicit **opt-in toggle**. The customer email now only fires when opted in (it
  never actually fired before); the button reads **"Create Invoice" / "Create &
  Send"** accordingly, and email failures are non-fatal.
- **Deleted-customer tag:** a new migration snapshots a deleted customer's
  name/email onto their invoices and sets a `customer_deleted` flag via a
  **BEFORE DELETE trigger**. A **"Deleted" / "Customer deleted"** tag shows in the
  invoice list and detail (**never** on the printed document).

## Easyship

- **Floor each item's `declared_customs_value`** at a positive minimum in
  `buildParcels`, so **$0 line items** no longer trigger a **422
  "declared_customs_value must be greater than 0"** from the rates endpoint.

## Migration (run before deploying)

`invoice-customer-deleted-tag-migration.sql` — snapshot columns + BEFORE DELETE
trigger.$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Customers$cl$, $cl$Easyship$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #186", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/186"}]$cl$::jsonb,
  $cl$2026-07-14 15:46:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Smaller default page size, opt-in Create & Send, deleted-customer tag$cl$ AND author = $cl$Engineering$cl$
);
