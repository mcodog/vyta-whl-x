-- Admin Changelog — 2026-07-17 feature batch
-- ==========================================
-- Appends the changelog_entries rows for the work authored AND merged on
-- 2026-07-17: the admin/products report redesign (PRs #211 and #212). Mirrors
-- the format of changelog-append-migration.sql: each row is inserted only when
-- an entry with the same title + author ("Engineering") does not already exist,
-- so this file is idempotent and safe to re-run. It never touches entries
-- created through the Admin Changelog UI.
--
-- SCOPE NOTE: The PRs that *merged* in the early hours of 2026-07-17 (#204–#209)
-- are July-16-authored commits — the tail of the prepaid-invoice / stock-unit /
-- supplier-routing work — already documented by the `2026-07-16-*.md`
-- write-ups. They are deliberately EXCLUDED here to avoid duplication.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping. These changes are code-only — no
-- feature DB migration is required.

-- 1) Admin products reports — redesign (PR #211/#212) -------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Admin reports — Redesigned products/stock reports (grouped toggles, boxes stock, PURAMASS branding)$cl$,
  $cl$The Customize Report modal now toggles whole sections instead of individual cards/columns, all three reports lead with SKU + Description and show stock in boxes by default with a new Strength column, and everything wears a branded PURAMASS layout. Choices persist across the page.$cl$,
  $cl$## Summary

A ground-up redesign of the three admin **products reports** (Products, Stock,
Stock Changes) — how they're customized, how stock reads, and how they look.

## Customize by section

- The **Customize Report** modal now toggles **whole sections** — *Catalog*,
  *Inventory*, *Revenue & Pricing* — instead of individual cards/columns.
  Ticking one box removes its related cards **and** columns together.
- Stock On Hand's **stock-value** sub-figure is the money "outlier": it only
  shows when pricing is included.

## Across all three reports

- **Drop the Category column**; lead with **SKU** (product slug) then
  **Description**.
- **Stock in boxes by default**, with leftover vials shown in parentheses and
  the unit spelled out — e.g. **"24 boxes (3 vials)"** / **"2 boxes (1 vial)"** —
  switchable to vials; the unit is named in the column header.
- New **Strength column** (e.g. 10mg, 5mg) pulled out of the Description cell
  into its own column.

## Branded PURAMASS layout

- Gold wordmark, black title, gold rule, an at-a-glance info line (generated
  date, product count, unit, currency), black table header with white text,
  alternating white / pale-gold single-line rows, and a
  *PuraMass · Puramass.com* footer.

## Persistence

- Stock display and section choices persist to **localStorage** and apply across
  every report on the page. The **emailed** stock report PDF/CSV are unchanged.

## Files

- `app/(admin)/admin/products/page.tsx`
- `app/api/admin/products/report/route.ts`
- `app/api/admin/products/stock-report/route.ts`
- `app/api/admin/products/stock-change-report/route.ts`
- `lib/admin/report-html.ts`, `lib/admin/stock-report.ts`,
  `lib/admin/stock-change-report.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$major$cl$,
  ARRAY[$cl$Products$cl$, $cl$Reports$cl$, $cl$Stock Report$cl$, $cl$UI$cl$, $cl$Branding$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #211", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/211"}, {"label": "PR #212", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/212"}]$cl$::jsonb,
  $cl$2026-07-17 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin reports — Redesigned products/stock reports (grouped toggles, boxes stock, PURAMASS branding)$cl$ AND author = $cl$Engineering$cl$
);

-- 2) Stock Report — cleaner table & optional extras (PR #212) -----------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Stock Report — Cleaner table (no status pills) & optional summary cards$cl$,
  $cl$Stock-Report-only refinements: the top Filters card is gone, the Stock and Need To Order columns are now plain text (dropping the green/amber/out status pills), and the summary cards + "How On Order is calculated" footer are each toggleable from a new Customize Stock Report modal.$cl$,
  $cl$## Summary

Stock-Report-only refinements on top of the products-report redesign, so the
table reads cleanly and its extras are opt-in.

## What changed

- **Removed** the top **Filters** card.
- The **Stock** column is now plain black text (SKU / quantity), dropping the
  green / amber / out **status pills** — low stock is already conveyed by the
  **Min Quantity / Need To Order** columns.
- **Need To Order** is likewise plain text now (drops the amber pill), so the
  table carries **no status pills at all**.
- The **summary cards** and the **"How On Order is calculated"** footer are each
  toggleable via a new **Customize Stock Report** modal (gear beside the Stock
  Report button); choices persist to localStorage.

## Files

- `app/(admin)/admin/products/page.tsx`
- `app/api/admin/products/stock-report/route.ts`
- `lib/admin/stock-report.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Stock Report$cl$, $cl$Products$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #212", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/212"}]$cl$::jsonb,
  $cl$2026-07-17 11:45:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Stock Report — Cleaner table (no status pills) & optional summary cards$cl$ AND author = $cl$Engineering$cl$
);
