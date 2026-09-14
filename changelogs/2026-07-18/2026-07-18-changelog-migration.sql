-- Admin Changelog — 2026-07-18 feature batch
-- ==========================================
-- Appends the changelog_entries rows for everything that merged to main on
-- 2026-07-18 (PRs #210, #213, #214, #215, #216 — the underlying commits were
-- authored late on the 17th and merged in the early hours of the 18th). Mirrors
-- the format of changelog-append-migration.sql: each row is inserted only when
-- an entry with the same title + author ("Engineering") does not already exist,
-- so this file is idempotent and safe to re-run. It never touches entries
-- created through the Admin Changelog UI.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping.
--
-- NOTE: The feature code itself may need its own DB migrations. The
-- labeled/unlabeled + USD pricing work ships with
-- `christian-usd-pricelist-labeled-unlabeled-migration.sql` and
-- `jason-supplier-pricelist-migration.sql`. The other changes are code-only.

-- 1) Supplier routing line rows redesigned as cards (PR #210) -----------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Purchase Orders — Supplier routing lines redesigned as cards$cl$,
  $cl$In the narrower main column the supplier-routing grid squeezed the product description against the supplier dropdown. Each line is now a card: the description spans the full width and wraps, quantity sits on the right, and the supplier picker gets its own row with the line cost beside it.$cl$,
  $cl$## Summary

In the narrower main column the single-row grid squeezed the product
description against the supplier dropdown.

## What changed

- Each line is redesigned as a **card**: the description spans the full width
  (and wraps), **qty** sits on the right, and the **supplier picker** gets its
  own full-width row with the **line cost** beside it.
- Applied to **both** the in-form routing view and the invoice **Supplier
  Purchase Orders** panel.

## Files

- `components/admin/PrepaidLineSuppliers.tsx`
- `components/admin/PrepaidPurchaseOrders.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Purchase Orders$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Purchase Orders$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #210", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/210"}]$cl$::jsonb,
  $cl$2026-07-18 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Purchase Orders — Supplier routing lines redesigned as cards$cl$ AND author = $cl$Engineering$cl$
);

-- 2) Stock Report — column selection in the customize modal (PR #213) ---------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Stock Report — Choose which columns appear (customize modal)$cl$,
  $cl$Admins can now tick which table columns (SKU, Description, Strength, Stock, Min Quantity, On Order, Need To Order) appear on the downloaded Stock Report. The choice persists and an empty selection falls back to all columns.$cl$,
  $cl$## Summary

Admins can now tick which table columns appear on the downloaded **Stock
Report**, straight from the Customize modal.

## What changed

- Selectable columns: **SKU, Description, Strength, Stock, Min Quantity, On
  Order, Need To Order**.
- The selection is passed to the report route via a **`cols`** param, filtered
  against the known column keys, and rendered dynamically so headers and cells
  stay in lock-step.
- Choices **persist in localStorage** alongside the existing card / on-order
  toggles, and an **empty selection falls back to all columns**.

## Files

- `app/(admin)/admin/products/page.tsx`
- `app/api/admin/products/stock-report/route.ts`
- `lib/admin/stock-report.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Stock Report$cl$, $cl$Products$cl$, $cl$Reports$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #213", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/213"}]$cl$::jsonb,
  $cl$2026-07-18 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Stock Report — Choose which columns appear (customize modal)$cl$ AND author = $cl$Engineering$cl$
);

-- 3) Labeled/unlabeled invoice pricing + USD-native prices (PR #214/#215) -----
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Invoices — Labeled/unlabeled pricing & USD-native customer prices$cl$,
  $cl$The invoice With/Without labels toggle now re-prices product lines between a labeled and a new unlabeled price, USD-tagged customers' stored overrides are treated as native USD (shown 1:1 on USD invoices), and Jason (supplier) and Christian (USD customer) price lists were imported.$cl$,
  $cl$## Summary

Adds an **unlabeled** price alongside the existing labeled price and teaches the
invoice form to switch between them, plus proper **USD-native** handling of
customer overrides and two imported price lists.

## Schema

- An **unlabeled price column** was added to `pricelist_items` and
  `customer_price_overrides` (the existing `price` column is the *labeled*
  value).

## Invoice pricing

- The **With labels / Without labels** toggle now re-prices product lines
  between the labeled (`override_price`) and unlabeled
  (`unlabeled_override_price`) price, falling back to labeled when no unlabeled
  value exists.
- **USD-tagged customers'** stored overrides are treated as **native USD**:
  shown 1:1 on a USD invoice (no exchange-rate re-conversion), divided by the
  rate for CAD.
- Price resolution carries **labeled + unlabeled** for both customer overrides
  and the global active pricelist; the APIs return the unlabeled columns.
- The **save-line-prices-to-customer** prompt is disabled for USD-native
  customers and when labels are off, so it can't corrupt USD or unlabeled data.

## Price-list imports

- **Jason supplier pricelist** — `jason-supplier-pricelist-migration.sql`
  (price × 0.65 + $5.00).
- **Christian Harcus USD customer pricelist** — built from the PURA USD PDF,
  matched to products on **`products.slug`** (the PDF "Code"): 85 of 108 rows
  match; the other 23 are strengths the catalog does not carry and are skipped
  (not remapped). The migration also reports active products the PDF does not
  price.

## Migrations (run before deploying)

- `jason-supplier-pricelist-migration.sql`
- `christian-usd-pricelist-labeled-unlabeled-migration.sql` (adds the unlabeled
  columns + seeds Christian's USD list)

## Files

- `components/admin/InvoiceForm.tsx`
- `app/api/admin/price-overrides/route.ts`
- `app/api/admin/pricelists/active/route.ts`
- `lib/admin/pricelists.ts`, `lib/pricing.ts`
- `docs/labeled-unlabeled-invoice-pricing.spec.md`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Pricing$cl$, $cl$Invoices$cl$, $cl$USD$cl$, $cl$Suppliers$cl$, $cl$Labels$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Pricing$cl$, $cl$Purchase Orders$cl$],
  $cl$[{"label": "PR #214", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/214"}, {"label": "PR #215", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/215"}]$cl$::jsonb,
  $cl$2026-07-18 11:45:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Labeled/unlabeled pricing & USD-native customer prices$cl$ AND author = $cl$Engineering$cl$
);

-- 4) Stock Report — boxes/vials unit toggle in the customize modal (PR #216) --
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Stock Report — Boxes/vials unit toggle in the customize modal$cl$,
  $cl$The Customize Stock Report modal used to send you to the Products Report options to switch stock display between boxes and vials. That control — a Boxes/Vials selector plus the "show leftover vials" checkbox — now lives directly in the modal, sharing state so all reports stay in sync.$cl$,
  $cl$## Summary

The Customize Stock Report modal previously **redirected** users to the Products
Report options to switch stock display between boxes and vials.

## What changed

- Surfaces that control **directly in the modal**: a **Boxes / Vials** selector
  plus the **"show leftover vials"** checkbox, reusing the shared
  `stockUnit` / `showRemainder` state so all reports stay in sync.
- The unit choice is included in the modal's **Reset to defaults**, and the
  button tooltip was updated.

## Files

- `app/(admin)/admin/products/page.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Stock Report$cl$, $cl$Products$cl$, $cl$Reports$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #216", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/216"}]$cl$::jsonb,
  $cl$2026-07-18 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Stock Report — Boxes/vials unit toggle in the customize modal$cl$ AND author = $cl$Engineering$cl$
);
