-- Deleted-customer tag on invoices
-- ================================
-- When a customer is deleted, invoices.customer_id is cleared (the FK is
-- ON DELETE SET NULL, see ecommerce-backend-migration.sql). After that a
-- deleted-customer invoice is indistinguishable from a guest invoice: both have
-- customer_id = NULL. Admins want to SEE that an invoice's customer record is
-- gone (in the app UI only — never on the printed document).
--
-- This migration:
--   1. Adds invoices.customer_deleted (boolean, default false).
--   2. Adds a BEFORE DELETE trigger on customers that — for every invoice still
--      linked to the customer being removed — snapshots the customer's
--      name/email/phone into the invoice's denormalized columns (so the invoice
--      keeps showing who it was for) and flips customer_deleted to true.
--
-- The trigger runs BEFORE the row is deleted, so customer_id is still populated
-- when we match on it; the FK's SET NULL then clears customer_id afterwards.
-- Safe to re-run.

------------------------------------------------------------------------------
-- 1. Column
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_deleted boolean NOT NULL DEFAULT false;

------------------------------------------------------------------------------
-- 2. Snapshot + flag trigger on customer deletion
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_invoices_customer_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE invoices
  SET
    -- Preserve whatever the invoice already had; only fill blanks from the
    -- customer record about to be removed.
    customer_name = COALESCE(
      NULLIF(customer_name, ''),
      NULLIF(TRIM(CONCAT_WS(' ', OLD.first_name, OLD.last_name)), '')
    ),
    customer_email = COALESCE(NULLIF(customer_email, ''), OLD.email),
    customer_phone = COALESCE(NULLIF(customer_phone, ''), OLD.phone),
    customer_deleted = true,
    updated_at = now()
  WHERE customer_id = OLD.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_invoices_customer_deleted ON customers;

CREATE TRIGGER trg_mark_invoices_customer_deleted
  BEFORE DELETE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION mark_invoices_customer_deleted();

------------------------------------------------------------------------------
-- 3. Backfill: any existing invoice whose customer link is already gone but
--    that still looks like it once had one (has a stored email but no
--    customer_id) is ambiguous, so we DON'T retroactively flag those — the flag
--    only applies to deletions that happen from here on. No backfill needed.
------------------------------------------------------------------------------
