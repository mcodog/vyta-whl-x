-- Products cell-edit grid: allow change_source = 'cell-grid'
-- ==========================================================
-- The Products screen's cell-edit grid (a spreadsheet for bulk price/stock
-- edits) saves each dirty row through PATCH /api/admin/products/[id], the same
-- route the single-cell inline editor uses. It tags its writes
-- `change_source: 'cell-grid'` so the product history timeline can tell a bulk
-- grid save apart from a one-off inline edit.
--
-- product_change_history.change_source is CHECK-constrained, so the new value
-- has to be admitted before those history rows can be written.
--
-- Safe to re-run. Until this migration is applied, grid saves still succeed
-- (recordProductChanges is best-effort and never fails the update) but their
-- history rows are rejected — so run it alongside the deploy, not after it.

-- Rebuild the CHECK to the full set of sources so this migration is
-- self-contained regardless of which earlier history migrations ran.
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_change_source_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_change_source_check
  CHECK (change_source IN (
    'create', 'inline', 'form', 'import', 'revert', 'api',
    'order', 'invoice', 'restock', 'invoice_cancel', 'cell-grid'
  ));
