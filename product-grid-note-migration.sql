-- Products cell-edit grid: a free-text note column
-- ================================================
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- WHY
--   The cell-edit grid gained a blank gutter column between Stock (cases) and
--   Case price. It is now a real, typeable column: somewhere to jot what you
--   are looking at while you work a row — "waiting on Jason", "check lot",
--   "price agreed w/ Kat" — sitting right next to the stock and price it
--   refers to.
--
--   It saves with the same Save button as every other cell, so it needs
--   somewhere to live. Anything less (browser-local storage) would silently
--   lose what an operator typed and would be invisible to everyone else.
--
-- WHAT
--   One nullable text column. NULL and '' both mean "no note" — the grid
--   writes NULL when a note is cleared, so an empty note never differs from
--   never having had one.
--
--   This is an INTERNAL note. It is never rendered outside the admin grid — not
--   on the storefront, an invoice, a price sheet, or any customer-facing
--   document — and the public products API strips it from its payload, which
--   selects `*`. Only an admin can write it (analytics accounts, which may edit
--   descriptor fields, cannot).
--
--   It is not a secret from staff: the admin invoice form loads products with
--   `select('*')`, so an affiliate could see the column in that response even
--   though nothing displays it. Don't put anything in a note you wouldn't show
--   a partner.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS grid_note text;

COMMENT ON COLUMN products.grid_note IS
  'Internal free-text note shown in the admin products cell-edit grid, between Stock (cases) and Case price. NULL = no note. Never surfaced to customers.';

-- Sanity check (informational)
-- SELECT count(*) FILTER (WHERE grid_note IS NOT NULL) AS products_with_a_note,
--        count(*)                                      AS products
-- FROM products;
