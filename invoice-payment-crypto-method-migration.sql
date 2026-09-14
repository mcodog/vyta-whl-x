-- Invoice payments — allow the 'crypto' method
-- =============================================================================
-- Recording a crypto payment from admin → Invoices → Record Payment failed with
-- a check-constraint violation ("new row for relation \"payments\" violates
-- check constraint \"payments_method_check\"").
--
-- The Record Payment dialog, the `PaymentMethod` type and the POST
-- /api/admin/invoices/:id/payments guard all accept
-- 'card' | 'e-transfer' | 'cash' | 'crypto' | 'other', but the constraint
-- created in ecommerce-backend-migration.sql only ever listed
-- 'card','e-transfer','cash','other' — so every crypto payment was rejected by
-- the database after passing the app-level checks.
--
-- This widens the constraint to include 'crypto'. The existing constraint is
-- dropped by lookup rather than by name so the migration works regardless of
-- what Postgres (or an earlier hand-edit) named it, and re-running it is safe.
--
-- Run this in the Supabase SQL editor.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%method%'
  LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('card', 'e-transfer', 'cash', 'crypto', 'other'));

COMMENT ON CONSTRAINT payments_method_check ON public.payments IS
  'Recorded payment method: card | e-transfer | cash | crypto | other. Must stay in sync with PaymentMethod in lib/supabase.ts and ALLOWED_METHODS in the payments API route.';
