-- Invoice "Email Customer" quick actions — who/when tracking
-- =============================================================================
-- The invoice detail page can email the customer an order confirmation or a
-- shipping notification. Those sends previously went through the shared,
-- unauthenticated /api/email route and left no record. They now run through an
-- authenticated admin endpoint that stamps who sent each one and when, so the
-- "Email Customer" panel can show "Sent {when} by {who}" — mirroring the
-- existing invoices.last_emailed_* tracking for the invoice PDF email.
--
-- These are the invoice-screen customer touches; the warehouse packed/shipped
-- notifications keep their own separate tracking (packed_emailed_at /
-- shipped_emailed_at + fulfillment_email_log).
--
-- Run this in the Supabase SQL editor.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS order_confirmation_emailed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS order_confirmation_emailed_by        uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_confirmation_emailed_by_email  text,
  ADD COLUMN IF NOT EXISTS shipping_notification_emailed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_notification_emailed_by       uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_notification_emailed_by_email text;

COMMENT ON COLUMN invoices.order_confirmation_emailed_at IS 'When the order-confirmation email was last sent from the invoice screen.';
COMMENT ON COLUMN invoices.order_confirmation_emailed_by IS 'Admin (customers.id) who last sent the order-confirmation email.';
COMMENT ON COLUMN invoices.order_confirmation_emailed_by_email IS 'Denormalised email of the admin who last sent the order-confirmation email.';
COMMENT ON COLUMN invoices.shipping_notification_emailed_at IS 'When the shipping-notification email was last sent from the invoice screen.';
COMMENT ON COLUMN invoices.shipping_notification_emailed_by IS 'Admin (customers.id) who last sent the shipping-notification email.';
COMMENT ON COLUMN invoices.shipping_notification_emailed_by_email IS 'Denormalised email of the admin who last sent the shipping-notification email.';
