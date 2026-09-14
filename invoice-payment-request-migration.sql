-- Invoice payment requests — "Pay this invoice" emails, hosted page, methods
-- =============================================================================
-- Run this in the Supabase SQL editor.
--
-- Adds a SECOND customer email alongside the existing invoice-PDF email. The
-- invoice email (invoice-email-migration.sql) is unchanged: it still just
-- attaches the PDF. The new *payment* email carries a link to a hosted page on
-- our own site — /pay/<token> — that shows the customer their order and asks
-- them to pay one of two ways:
--
--   * Crypto        → an instructions page rendered from the receiving wallets
--                     configured in admin Settings → "Crypto Payments".
--   * Visa/Mastercard → the PuraMass (Stealth Health) hosted checkout; we hand
--                     the invoice's line items off and redirect to the returned
--                     payment_link. Payment status comes back over the existing
--                     /api/webhooks/stealth-health webhook.
--
-- Everything the customer does on that page is recorded so the admin invoices
-- screens can show which method was chosen, when, the PuraMass payment link (for
-- resending) and the date it was created, plus live payment status.

BEGIN;

------------------------------------------------------------------------------
-- 1. invoices: payment-request token, email tracking, chosen method
------------------------------------------------------------------------------
ALTER TABLE invoices
  -- Unguessable public token in the emailed link (/pay/<token>). Minted on the
  -- first payment-email send and reused on every resend, so an already-delivered
  -- link keeps working.
  ADD COLUMN IF NOT EXISTS payment_token text,
  ADD COLUMN IF NOT EXISTS payment_token_created_at timestamptz,
  -- Payment-email delivery tracking (mirrors invoices.last_emailed_* for the
  -- invoice-PDF email, kept separate so the two sends never overwrite each
  -- other's history).
  ADD COLUMN IF NOT EXISTS payment_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_email_sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_email_sent_by_email text,
  ADD COLUMN IF NOT EXISTS payment_email_to text,
  ADD COLUMN IF NOT EXISTS payment_email_count integer NOT NULL DEFAULT 0,
  -- What the customer picked on the hosted page: 'crypto' | 'card'.
  ADD COLUMN IF NOT EXISTS payment_method_selected text,
  ADD COLUMN IF NOT EXISTS payment_method_selected_at timestamptz,
  -- Crypto path: the wallet we told them to send to, and the transaction
  -- reference they submitted back (pending admin verification until a payment
  -- is recorded against the invoice).
  ADD COLUMN IF NOT EXISTS crypto_wallet_id text,
  ADD COLUMN IF NOT EXISTS crypto_payment_reference text,
  ADD COLUMN IF NOT EXISTS crypto_payment_declared_at timestamptz;

-- One invoice per token; the partial index keeps NULLs (the common case) out.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_token
  ON invoices (payment_token) WHERE payment_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_payment_method_selected
  ON invoices (payment_method_selected) WHERE payment_method_selected IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE invoices
    ADD CONSTRAINT invoices_payment_method_selected_check
    CHECK (payment_method_selected IN ('crypto', 'card'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN invoices.payment_token IS
  'Unguessable token for the public payment page (/pay/<token>). Minted on the first payment-email send and reused on resends.';
COMMENT ON COLUMN invoices.payment_email_sent_at IS
  'When the payment-request email was last successfully sent. Separate from last_emailed_at, which tracks the invoice-PDF email.';
COMMENT ON COLUMN invoices.payment_method_selected IS
  'Method the customer chose on the payment page: ''crypto'' or ''card'' (PuraMass / Stealth Health hosted checkout). NULL until they choose.';
COMMENT ON COLUMN invoices.crypto_payment_reference IS
  'Transaction hash / reference the customer submitted on the crypto instructions page. Informational until an admin records the payment.';

------------------------------------------------------------------------------
-- 2. site_settings: receiving crypto wallets + payment-email template
------------------------------------------------------------------------------
ALTER TABLE site_settings
  -- [{ id, label, network, address, memo, enabled }] — the wallets a customer
  -- may send to, configured in admin Settings → "Crypto Payments".
  ADD COLUMN IF NOT EXISTS crypto_wallets jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Free-text shown above the wallet on the crypto instructions page.
  ADD COLUMN IF NOT EXISTS crypto_payment_instructions text,
  -- Payment-request email template ({{merge_vars}} — see
  -- lib/payment-email-templates.ts). Independent of the invoice-PDF email
  -- template fields added by invoice-email-migration.sql.
  ADD COLUMN IF NOT EXISTS payment_email_subject text,
  ADD COLUMN IF NOT EXISTS payment_email_body text,
  -- Which methods the payment page offers. Both default on; turning one off
  -- hides it from the page and rejects it server-side.
  ADD COLUMN IF NOT EXISTS payment_crypto_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_card_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN site_settings.crypto_wallets IS
  'Receiving crypto wallets offered on the invoice payment page: [{ id, label, network, address, memo, enabled }].';
COMMENT ON COLUMN site_settings.payment_card_enabled IS
  'Whether the payment page offers Visa/Mastercard via the PuraMass hosted checkout. Also requires the PuraMass credentials + config switch.';

-- Seed the default template on the singleton row when still NULL. The app also
-- falls back to the same defaults at render time, so this is mainly so the
-- Settings editor opens pre-filled.
UPDATE site_settings
SET
  payment_email_subject = COALESCE(
    payment_email_subject,
    'Payment for invoice {{invoice_number}}'
  ),
  payment_email_body = COALESCE(
    payment_email_body,
    'Hi {{customer_first_name}},

Your order is ready for payment. Invoice {{invoice_number}} has a balance of ${{amount_due}} {{currency}}.

Review your order and pay securely here:
{{payment_url}}

You can pay by crypto or by Visa / Mastercard — pick whichever you prefer on that page.

If anything looks off, just reply to this email and we''ll sort it out.

— PuraMass'
  )
WHERE TRUE;

------------------------------------------------------------------------------
-- 3. invoice_payment_email_log: history of every payment-email send
------------------------------------------------------------------------------
-- Deliberately a separate table from invoice_email_log so the invoice-PDF email
-- history and the payment-request history stay independently readable.
CREATE TABLE IF NOT EXISTS invoice_payment_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  to_email text NOT NULL,
  bcc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  payment_url text,
  message_id text,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_email_log_invoice
  ON invoice_payment_email_log (invoice_id, created_at DESC);

COMMENT ON TABLE invoice_payment_email_log IS
  'Audit trail of every payment-request email send (success or failure). The invoice-PDF email has its own log in invoice_email_log.';

------------------------------------------------------------------------------
-- 4. invoice_payment_events: what happened on the payment page
------------------------------------------------------------------------------
-- Append-only timeline backing the "Payment Request" panel on the invoice
-- screen: page views, method choices, hosted-checkout hand-offs, crypto
-- declarations and the paid callback. Diagnostic — writes are best-effort and
-- never block the customer.
CREATE TABLE IF NOT EXISTS invoice_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  -- link_created | email_sent | page_viewed | method_selected |
  -- checkout_created | crypto_declared | paid | failed
  event_type text NOT NULL,
  method text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_events_invoice
  ON invoice_payment_events (invoice_id, created_at DESC);

COMMENT ON TABLE invoice_payment_events IS
  'Append-only timeline of the customer-facing invoice payment page (method chosen, checkout created, crypto declared, paid).';

------------------------------------------------------------------------------
-- 5. puramass_orders: mark hand-offs that came from an invoice
------------------------------------------------------------------------------
-- puramass_orders.invoice_id already exists (puramass-fulfillment-invoice-
-- migration.sql), where it means "the fulfillment invoice this PAID order
-- produced". `origin` disambiguates the new direction: 'invoice' means the
-- hand-off was created FOR an existing invoice from the payment page, so the
-- webhook records a payment against that invoice instead of creating a new one.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'storefront';

CREATE INDEX IF NOT EXISTS idx_puramass_orders_origin
  ON puramass_orders (origin);

COMMENT ON COLUMN puramass_orders.origin IS
  'Where the hand-off came from: ''storefront'' (cart checkout — a paid order creates a fulfillment invoice) or ''invoice'' (invoice payment page — a paid order records a payment on invoice_id).';

------------------------------------------------------------------------------
-- 6. payments.method: allow the methods the app already sends
------------------------------------------------------------------------------
-- The original CHECK only allowed card/e-transfer/cash/other, but the record-
-- payment API has long accepted 'crypto' too, and the payment page now records
-- 'card' (PuraMass) and 'crypto' automatically. Widen the constraint so those
-- inserts can't fail on a database still carrying the original check.
DO $$
BEGIN
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
  ALTER TABLE payments
    ADD CONSTRAINT payments_method_check
    CHECK (method IN ('card', 'credit_card', 'e-transfer', 'etransfer', 'cash', 'crypto', 'other'));
END $$;

------------------------------------------------------------------------------
-- 7. RLS — both new tables are written server-side (service role) only
------------------------------------------------------------------------------
ALTER TABLE invoice_payment_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payment_email_log_admin_read ON invoice_payment_email_log;
CREATE POLICY invoice_payment_email_log_admin_read ON invoice_payment_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

ALTER TABLE invoice_payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payment_events_admin_read ON invoice_payment_events;
CREATE POLICY invoice_payment_events_admin_read ON invoice_payment_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

COMMIT;
