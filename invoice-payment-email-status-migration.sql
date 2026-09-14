-- Invoice payment — customer email opt-in + delivery status
-- =============================================================================
-- When an admin records a payment against an invoice, a confirmation modal now
-- offers to email the customer a "payment received" notice. These columns
-- capture the admin's choice and the outcome of the send, per payment, so the
-- Payment History can show whether the customer was notified.
--
--   * email_requested — the admin's toggle at record time:
--                         NULL  → the payment predates this feature (untracked),
--                         false → the admin chose NOT to email the customer,
--                         true  → the admin asked us to email the customer.
--   * email_sent_at   — when the confirmation email was successfully sent
--                       (NULL when it wasn't requested, or the send failed).
--   * email_error     — the failure reason when a requested send did not go out.
--   * email_to        — the address the confirmation was (or would be) sent to.
--   * email_sent_by       — the admin (customers.id) who triggered the send.
--   * email_sent_by_email — that admin's email, denormalised for display so the
--                           Payment History can show "Emailed by …" without a
--                           join, mirroring invoices.last_emailed_by_email.
--
-- email_requested is intentionally left NULLABLE with no default so existing
-- rows read as "untracked" rather than "chose not to send" — a lot of invoices
-- were paid before this feature shipped and may or may not have been emailed.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS email_requested     boolean,
  ADD COLUMN IF NOT EXISTS email_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS email_error         text,
  ADD COLUMN IF NOT EXISTS email_to            text,
  ADD COLUMN IF NOT EXISTS email_sent_by       uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_sent_by_email text;

COMMENT ON COLUMN payments.email_requested IS 'Admin''s email toggle when recording the payment: NULL = untracked (pre-feature), false = chose not to email, true = requested a customer email.';
COMMENT ON COLUMN payments.email_sent_at IS 'When the payment-received confirmation email was successfully sent to the customer.';
COMMENT ON COLUMN payments.email_error IS 'Failure reason when a requested payment-received email did not send.';
COMMENT ON COLUMN payments.email_to IS 'Recipient address the payment-received confirmation was (or would have been) sent to.';
COMMENT ON COLUMN payments.email_sent_by IS 'Admin (customers.id) who triggered the payment-received email.';
COMMENT ON COLUMN payments.email_sent_by_email IS 'Denormalised email of the admin who triggered the send, for display without a join.';
