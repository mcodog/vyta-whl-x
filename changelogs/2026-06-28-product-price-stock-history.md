# Admin Products — Price & Stock Change History

Date: 2026-06-28

The admin Products page now keeps a full audit trail of every **price** and
**stock quantity** change, viewable per product and with one-click revert.

- A new **History** (clock) action on each product row opens a timeline modal
  with **Price** and **Stock** tabs.
- Each entry shows the value it was set to (with the previous value struck
  through), **when** it was set, **how long** that value was held (the gap to
  the next change; the most recent entry is marked *Current* and shows the
  duration "so far"), **who** changed it, and **how** — the change source:
  *Created*, *Inline edit*, *Edit form*, *CSV import*, or *Reverted*.
- **Revert**: any past value can be restored in one click. Reverting writes a
  new history entry tagged *Reverted* rather than rewriting history, so the
  ledger stays append-only.
- Changes are recorded server-side from every mutation path: product create,
  the inline price/stock cell edits, the full edit form, CSV import, and
  reverts. Recording is best-effort and never fails the underlying update.

## Data model

New append-only table `product_change_history` (one row per changed field):
`product_id`, `field` (`price` | `stock_quantity`), `old_value`, `new_value`,
`changed_by` (→ `customers`), `change_source`, `created_at`. Admin/assistant
read access via RLS; writes only via the service-role key. The migration seeds
a baseline `create` row per existing product (dated at its `created_at`) so the
current value has a known start time.

## Files

- `product-price-stock-history-migration.sql` — new table, indexes, RLS, seed.
- `lib/admin/product-history.ts` — `recordProductChanges()` diff-and-insert
  helper.
- `app/api/admin/products/[id]/history/route.ts` — GET timeline with resolved
  actor names.
- `app/api/admin/products/route.ts`, `app/api/admin/products/[id]/route.ts`,
  `app/api/admin/products/import/route.ts` — capture the actor and record
  changes; accept a `change_source` hint.
- `app/(admin)/admin/products/page.tsx` — History button, timeline modal, and
  revert.
