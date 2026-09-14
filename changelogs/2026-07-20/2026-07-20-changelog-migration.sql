-- Admin Changelog — 2026-07-20 feature batch
-- ==========================================
-- Appends the changelog_entries rows for everything committed on 2026-07-20
-- (PRs #217, #219, #220, #221, #222 — several merged to main just after
-- midnight on the 21st, but the work is all dated the 20th). Mirrors the format
-- of changelog-append-migration.sql: each row is inserted only when an entry
-- with the same title + author ("Engineering") does not already exist, so this
-- file is idempotent and safe to re-run. It never touches entries created
-- through the Admin Changelog UI.
--
-- Run this AFTER the base changelog-migration.sql (which creates the table).
-- Run it in the Supabase SQL editor. Values are dollar-quoted ($cl$…$cl$) so
-- arbitrary markdown needs no escaping.
--
-- NOTE: The feature code itself may need its own DB migrations. The
-- per-customer product-label preference ships with
-- `customer-default-with-labels-migration.sql` (adds
-- customers.default_with_labels). The other changes are code-only.

-- 1) Per-invoice courier processing-fee toggle -------------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$admin$cl$,
  $cl$Invoices — Per-invoice courier processing-fee toggle$cl$,
  $cl$The courier processing fee (the global handling-fee markup Settings bakes into every Easyship rate) is now opt-in per invoice. A new toggle in the Easyship shipment section defaults to OFF, so the courier rate is charged with no markup unless you turn it on.$cl$,
  $cl$## Summary

The **courier processing fee** — the global handling-fee markup that Settings
bakes into every Easyship rate — is now **opt-in per invoice** from the admin
invoice create/edit form.

## What changed

- A new **processing-fee toggle** in the Easyship shipment section of the
  invoice form. It **defaults to OFF**, so by default the courier rate is
  charged with **no markup**.
- When turned on, the fee amount is **prefilled from the global default** and
  can be **edited for that invoice only** — the global Settings value is never
  changed.
- Live rates refetch as the toggle / fee change, and the auto-filled shipping
  figure reflects the current choice.

## Functions / API

- `easyship.getEasyshipRates` now accepts an optional per-request
  `HandlingFeeChoice` (apply / value override); global behaviour is unchanged
  when the argument is omitted.
- The invoice **shipping-readiness** endpoint threads the choice through and
  returns the global fee so the form can prefill the override field.

## Files

- `app/api/admin/invoices/shipping-readiness/route.ts`
- `components/admin/InvoiceForm.tsx`
- `lib/admin/api.ts`
- `lib/shipping/easyship.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Shipping$cl$, $cl$Easyship$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #222", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/222"}]$cl$::jsonb,
  $cl$2026-07-20 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Per-invoice courier processing-fee toggle$cl$ AND author = $cl$Engineering$cl$
);

-- 2) List search & filters persist in the URL --------------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$ui$cl$,
  $cl$Admin — Search & filters persist in the URL (Back restores the view)$cl$,
  $cl$List views used to keep their search / filter / tab state in local state, so opening a detail page and hitting Back reset everything. Filter state now lives in the URL query string, so Back, refresh and bookmarks all restore exactly what you were looking at.$cl$,
  $cl$## Summary

List views kept their search / filter / tab state in local component state, so
clicking into a detail page and hitting **Back** re-mounted the list and reset
everything (e.g. searching "forza" in admin/invoices, opening an invoice, then
going Back lost the search).

## What changed

- Filter state now **seeds from the URL query string** and is written back with
  `router.replace` (scroll:false), matching the existing admin/orders pattern.
  **Back / refresh / bookmark** all restore the view.
- Applied to the major list pages:
  - **admin/invoices** (q, status, tab)
  - **products** — client catalog (q, category, coa)
  - **admin/products** (q)
  - **admin/purchase-orders** (q, status) + **suppliers** (q) +
    **supplier-pricelists** (supplier, q)
  - **admin/customers** (q, affiliate, active, roles)
  - **admin/pricing** — Price Lists & Customer Pricing views + workspace tab
  - **warehouse queue** (q, type, label, view)
- Each page reads `useSearchParams`, so its client component is wrapped in a
  **Suspense boundary** as Next.js requires.$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Admin$cl$, $cl$UI$cl$, $cl$Navigation$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Storefront$cl$, $cl$Warehouse$cl$],
  $cl$[{"label": "PR #222", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/222"}]$cl$::jsonb,
  $cl$2026-07-20 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Admin — Search & filters persist in the URL (Back restores the view)$cl$ AND author = $cl$Engineering$cl$
);

-- 3) Per-customer product-label preference -----------------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Invoices — Remember each customer's product-label preference$cl$,
  $cl$Customers now carry a default product-label preference (the sticker applied to each vial — NOT the shipping label). New invoices default their With/Without labels toggle from it, and flipping that toggle on an invoice writes the choice back to the customer so it sticks.$cl$,
  $cl$## Summary

Adds a per-customer **default_with_labels** preference — the sticker applied to
each vial (**not** the shipping label). New invoices no longer need the
With/Without labels toggle set by hand every time.

## What changed

- **Migration:** `customer-default-with-labels-migration.sql` adds
  `customers.default_with_labels BOOLEAN NOT NULL DEFAULT true`.
- **Create / Edit customer modals** gain a **With labels / Without labels**
  toggle (mirrors the Price Currency control). The customer type and the
  create/update APIs (client + server) carry the field.
- **New invoices:** when a customer is selected, the form adopts their label
  preference and re-prices product-bound lines with the labeled / unlabeled
  price accordingly. Editing an existing invoice keeps that invoice's own saved
  `with_labels`.
- **Write-back:** flipping the With/Without labels toggle on an invoice for a
  linked customer saves that choice as the customer's `default_with_labels`, so
  future invoices start from it. Guarded so it only writes when the admin
  actually flipped the toggle **and** the value differs from what's stored;
  adopting a preference on selection or a plain save never mutates it, and the
  write is non-fatal (a failure never blocks the invoice save).

## Files

- `app/(admin)/admin/customers/_components/CreateCustomerModal.tsx`
- `app/(admin)/admin/customers/_components/EditCustomerModal.tsx`
- `app/api/admin/customers/route.ts`, `app/api/admin/customers/[id]/route.ts`
- `components/admin/InvoiceForm.tsx`
- `lib/admin/api.ts`, `lib/supabase.ts`
- `customer-default-with-labels-migration.sql`

## Migration (run before deploying)

`customer-default-with-labels-migration.sql` — adds `default_with_labels` to
`customers`. Idempotent (`ADD COLUMN IF NOT EXISTS`).$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Customers$cl$, $cl$Invoices$cl$, $cl$Labels$cl$, $cl$Pricing$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Customers$cl$, $cl$Invoices$cl$],
  $cl$[{"label": "PR #222", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/222"}]$cl$::jsonb,
  $cl$2026-07-20 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Remember each customer's product-label preference$cl$ AND author = $cl$Engineering$cl$
);

-- 4) Fulfillment queue — bulk Pack & Ship (PR #221) --------------------------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Fulfillment queue — Bulk Pack & Ship actions$cl$,
  $cl$The fulfillment queue's bulk actions now go beyond remove/restore: ticking a set of active orders exposes Pack and Ship so the warehouse team can advance many orders at once, with the bulk-action panel reworked for clearer spacing.$cl$,
  $cl$## Summary

Extended the fulfillment queue's bulk actions beyond remove/restore so the
warehouse team can advance many orders at once. Ticking a set of active orders
now exposes **Pack** and **Ship** alongside **Remove from queue**.

## Bulk Pack & Ship

- **Pack** marks every selected order as *Packed* — which decrements stock
  server-side exactly as the per-order flow does.
- **Ship** advances every selected order to its terminal step: shipments become
  **Shipped** and self-pickups become **Picked up**, so the API never rejects a
  mismatched pairing.
- A still-pending order is **packed first** on the Ship path, so the stock
  decrement (which only fires on the pack transition) is never skipped.
- Actions run optimistically — packed orders stay in the active queue while
  shipped / picked-up orders drop into the archive, reconciled by a refetch.
  Partial failures surface a message and the queue reloads.

## Interface

- The bulk-action panel leads with an **N selected** header, places **Pack** and
  **Ship** side by side as the primary flow, and sets destructive **Remove from
  queue** apart on its own full-width row.
- Each button shows an inline spinner while it runs and locks the others out.
- **Clear** moved up next to **Select all** for a tidier layout.$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Warehouse$cl$, $cl$Fulfillment$cl$],
  ARRAY[$cl$Warehouse$cl$],
  $cl$[{"label": "PR #221", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/221"}]$cl$::jsonb,
  $cl$2026-07-20 12:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Fulfillment queue — Bulk Pack & Ship actions$cl$ AND author = $cl$Engineering$cl$
);

-- 5) Fulfillment queue — product-label badge & bulk remove/restore -----------
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$feature$cl$,
  $cl$Fulfillment queue — Product-label badge & bulk remove/restore$cl$,
  $cl$The warehouse queue now shows the invoice's With-labels flag as its own Labeled / Unlabeled badge (the shipping badge was relabeled Ship label to remove the ambiguity), and gains multi-select with a bulk action bar for removing from / restoring to the queue.$cl$,
  $cl$## Summary

The warehouse queue only ever showed the Easyship shipping label
("Label" / "No label"), so orders created **With labels** on the invoice read
as unlabeled. This surfaces the product-label status distinctly and adds
multi-select bulk actions — the groundwork the later bulk **Pack & Ship** flow
builds on.

## What changed

- **Product-label badge:** the invoice's `with_labels` flag now shows as a
  distinct **Labeled / Unlabeled** badge (both the row and the detail), and the
  Easyship badge was relabeled **Ship label** to remove the ambiguity.
- **Multi-select + bulk bar:** the queue gains multi-select with a bulk action
  bar — **bulk remove from queue** (active view) and **bulk restore** (archive
  view), plus **select-all** across the filtered set.
- **Layout fix:** on the narrow left column the customer name and the badges
  were crammed onto one row; the name now gets its own line and the badges wrap
  beneath it, with fulfillment status anchored to the right.

## Files

- `app/(warehouse)/warehouse/_components/QueueRow.tsx`
- `app/(warehouse)/warehouse/_components/QueueDetail.tsx`
- `app/(warehouse)/warehouse/page.tsx`
- `app/api/warehouse/queue/route.ts`
- `lib/warehouse/api.ts`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Warehouse$cl$, $cl$Fulfillment$cl$, $cl$Labels$cl$],
  ARRAY[$cl$Warehouse$cl$],
  $cl$[{"label": "PR #217", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/217"}, {"label": "PR #219", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/219"}]$cl$::jsonb,
  $cl$2026-07-20 11:30:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Fulfillment queue — Product-label badge & bulk remove/restore$cl$ AND author = $cl$Engineering$cl$
);

-- 6) Never save 100%-discounted invoice lines to customer pricing (PR #220) ---
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  $cl$bugfix$cl$,
  $cl$Invoices — Never save 100%-discounted lines to customer pricing$cl$,
  $cl$When the invoice create flow offers to save entered line prices as the customer's per-customer price overrides, lines with a 100% discount (giveaways) are now excluded — their entered price isn't what the customer actually pays.$cl$,
  $cl$## Summary

The invoice create flow offers to save entered line prices as the customer's
per-customer price overrides (**Pricing → Customer Pricing**), gated behind a
confirmation dialog.

## What changed

- A line with a **100% discount** is a giveaway — its entered price isn't what
  the customer actually pays — so those lines are now **excluded from the
  eligible price saves entirely**, keeping accidental $0 overrides out of the
  customer's price list.

## Files

- `components/admin/InvoiceForm.tsx`$cl$,
  $cl$Engineering$cl$,
  NULL::text,
  $cl$minor$cl$,
  ARRAY[$cl$Invoices$cl$, $cl$Pricing$cl$, $cl$Customers$cl$],
  ARRAY[$cl$Admin$cl$, $cl$Invoices$cl$, $cl$Pricing$cl$],
  $cl$[{"label": "PR #220", "url": "https://github.com/thepuragroup-droid/aminocan-whl/pull/220"}]$cl$::jsonb,
  $cl$2026-07-20 11:00:00$cl$::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = $cl$Invoices — Never save 100%-discounted lines to customer pricing$cl$ AND author = $cl$Engineering$cl$
);
