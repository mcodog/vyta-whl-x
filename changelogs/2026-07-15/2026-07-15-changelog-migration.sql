-- Admin Changelog — 2026-07-15 feature batch
-- ==========================================
-- Appends changelog_entries rows for the work that landed on main on
-- 2026-07-15 (PRs #187, #188, #191, #193 — the commits were authored late on
-- the 14th and merged in the early hours of the 15th) and does NOT already have
-- a markdown write-up. Mirrors the format of changelog-append-migration.sql:
-- each row is inserted only when an entry with the same title + author
-- ("Engineering") does not already exist, so this file is idempotent and safe
-- to re-run. It never touches entries created through the Admin Changelog UI.
--
-- SCOPE NOTE — three PRs that also merged on 2026-07-15 are ALREADY documented
-- by existing 2026-07-14 write-ups and are deliberately EXCLUDED here:
--   * #189 → aminocan/changelogs/2026-07-14-pack-decrements-stock.md
--   * #190 → aminocan/changelogs/2026-07-14-stock-change-report-and-faster-inline-edit.md
--   * #192 → aminocan/changelogs/2026-07-14-invoice-save-prices-to-customer-pricelist.md
-- Do NOT re-add those here.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping.

-- 1) Easyship shipment record defaults OFF (PR #187) --------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Invoices — Easyship "create shipment record" now defaults OFF$cl$,
  $cl$The create-invoice form used to default the Easyship "create shipment record" toggle to on for fresh shipment invoices. It is now opt-in on both create and edit, so a shipment record is only created when the admin explicitly turns it on.$cl$,
  $cl$## Summary

The create-invoice form previously defaulted the Easyship **"create shipment
record"** toggle to **on** for fresh shipment invoices.

## What changed

- The toggle is now **opt-in on both create and edit** — a shipment record is
  only created when the admin **explicitly turns it on**.

## Files

- `components/admin/InvoiceForm.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Shipping$cl$, $cl$Easyship$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #187", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/187"}]$cl$::jsonb,
  $cl$2026-07-15 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Easyship "create shipment record" now defaults OFF$cl$ AND author = $cl$Engineering$cl$
);

-- 2) Products — editable Stock (boxes) column + progress toast (PR #188/#193) -
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Admin products — Editable Stock (boxes) column with a progress toast$cl$,
  $cl$The products table gains an editable Stock (boxes) column alongside vials — both read/write stock_quantity via the vials-per-box rate so editing either stays in sync — and editing box stock now shows a bottom-right spinner toast that morphs into success/error when the save resolves.$cl$,
  $cl$## Summary

Adds a **boxes** view of stock to the products table and clearer feedback while
saving.

## Editable Stock (boxes) column

- Shows stock in **boxes** alongside the existing vials column. Both columns
  read from and write to `stock_quantity` via the product's **vials-per-box**
  rate, so editing either keeps them in sync — e.g. **5 boxes @ 10 vials/box →
  50 vials**, and setting **20 vials → 2 boxes**.

## Progress toast

- Editing a product's box stock shows a **bottom-right spinner toast** naming the
  product and amount, which becomes a **success or error** once the save
  resolves.
- The toast system was extended with a **sticky loading type**, an **`update()`**
  to morph a toast in place, and **per-toast positioning**.

## Files

- `app/(admin)/admin/products/page.tsx`
- `contexts/ToastContext.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Products$cl$, $cl$Inventory$cl$, $cl$UI$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Products$cl$],
  $cl$[{"label": "PR #188", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/188"}, {"label": "PR #193", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/193"}]$cl$::jsonb,
  $cl$2026-07-15 11:45:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin products — Editable Stock (boxes) column with a progress toast$cl$ AND author = $cl$Engineering$cl$
);

-- 3) Admin commissions — recipient card view (PR #188) -----------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Admin commissions — Per-recipient card view$cl$,
  $cl$The commissions page now defaults to a per-recipient card grid (sales people and affiliates) showing pending/paid totals, recent activity, and quick pay actions. The old table becomes an alternate "All Commissions" tab reachable via the view toggle and each card's Details link.$cl$,
  $cl$## Summary

Reframes the admin **commissions** page around the people being paid.

## What changed

- Defaults to a **per-recipient card grid** (sales people and affiliates) showing
  **pending / paid totals**, **recent activity**, and **quick pay actions**.
- The existing table becomes the alternate **"All Commissions"** tab, reachable
  via the **view toggle** and from each card's **Details** link.

## Files

- `app/(admin)/admin/commissions/page.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Commissions$cl$, $cl$UI$cl$, $cl$Affiliates$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Commissions$cl$],
  $cl$[{"label": "PR #188", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/188"}]$cl$::jsonb,
  $cl$2026-07-15 11:30:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin commissions — Per-recipient card view$cl$ AND author = $cl$Engineering$cl$
);

-- 4) Customers — alternate email (PR #191) -----------------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Customers — Optional alternate (backup) email$cl$,
  $cl$Customers can now carry an optional secondary/backup email (informational only — not used for auth, not unique). It appears in the Create/Edit customer modals and as a searchable column in the customers list.$cl$,
  $cl$## Summary

Adds an optional **secondary / backup email** for customers.

## What changed

- **Migration:** `customer-alternate-email-migration.sql` adds a nullable
  **`alternate_email`** column to `customers` (informational only — **not** used
  for auth, **not** unique).
- **Customer type:** adds the `alternate_email` field.
- **Admin API:** accepts `alternate_email` on create (POST, both login and guest
  paths) and update (PUT), normalized to lowercase / null.
- **UI:** an Alternate Email input in the **Create & Edit customer** modals, and
  an **Alternate Email column** in the customers list that is **included in
  search**.

## Migration (run before deploying)

`customer-alternate-email-migration.sql` — adds `alternate_email` to
`customers`. Idempotent (`ADD COLUMN IF NOT EXISTS`).

## Files

- `app/(admin)/admin/customers/_components/CreateCustomerModal.tsx`
- `app/(admin)/admin/customers/_components/EditCustomerModal.tsx`
- `app/(admin)/admin/customers/page.tsx`
- `app/api/admin/customers/route.ts`, `app/api/admin/customers/[id]/route.ts`
- `lib/admin/api.ts`, `lib/supabase.ts`
- `customer-alternate-email-migration.sql`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Customers$cl$, $cl$Email$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Customers$cl$],
  $cl$[{"label": "PR #191", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/191"}]$cl$::jsonb,
  $cl$2026-07-15 11:15:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Customers — Optional alternate (backup) email$cl$ AND author = $cl$Engineering$cl$
);
