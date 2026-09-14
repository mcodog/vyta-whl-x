-- Hosted-checkout invoices are raised at checkout, not at payment
-- =====================================================================
-- Run this in the Supabase SQL editor (after the other puramass migrations).
--
-- A PuraMass hosted-checkout order used to produce an invoice only once the
-- payment webhook confirmed it. Between clicking "Continue to secure checkout"
-- and paying, the customer had nothing to look at and no way back to their
-- payment link — and if the webhook never arrived, there was no record at all.
--
-- The invoice is now created at hand-off in a new `pending_payment` state and
-- flipped to `paid` when the payment lands. That gives the customer something
-- to see (and a link to finish paying) on their account dashboard.
--
--   1. invoices.status gains 'pending_payment' — raised, awaiting payment at an
--      external checkout. Deliberately NOT 'sent': nothing was emailed, and
--      'sent' is swept to 'overdue' by mark_overdue_invoices(), which would
--      turn every abandoned cart into an overdue receivable.
--
--   2. invoices.checkout_payment_link — the hosted payment link to resume, shown
--      on the customer's dashboard while the invoice is pending.
--
-- IMPORTANT: a `pending_payment` invoice is NOT work for the warehouse — it
-- isn't paid yet. The fulfillment queue filters it out (see
-- app/api/warehouse/queue/route.ts); anything else that treats "not draft" as
-- "ready to pack" needs the same treatment.
--
-- Safe to run more than once.

BEGIN;

-- 1. The new status ---------------------------------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN (
    'draft',
    'pending_payment',
    'sent',
    'partial',
    'paid',
    'overdue',
    'cancelled'
  ));

COMMENT ON COLUMN invoices.status IS
  'draft | pending_payment | sent | partial | paid | overdue | cancelled. "pending_payment" = raised by a hosted checkout and awaiting payment at the gateway: it is not a receivable (never swept to overdue) and not warehouse work (excluded from the fulfillment queue) until it is paid.';

-- 2. The link that lets the customer finish paying ---------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS checkout_payment_link TEXT;

COMMENT ON COLUMN invoices.checkout_payment_link IS
  'Hosted-checkout payment link (app.puramass.com) for an invoice raised at checkout. Shown to the customer while the invoice is pending_payment so they can resume. NULL for invoices raised any other way.';

-- Pending invoices are what the account dashboard reads most often.
CREATE INDEX IF NOT EXISTS idx_invoices_pending_payment
  ON invoices (customer_id, created_at DESC)
  WHERE status = 'pending_payment';

COMMIT;
