-- Affiliate program overhaul
-- 1. Adds the 'affiliate' role
-- 2. Binds customers to the affiliate who referred/owns them
-- 3. Links a sales_person record to an affiliate's account (auto-lock on invoices)
-- 4. Adds an affiliate_requests table for the "request to become an affiliate" flow
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction that
-- later uses the value, so run this statement on its own first.

-- 1. New role value (safe to re-run).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'affiliate';

-- 2. Bind a customer to "their" affiliate (first-touch attribution).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_affiliate_id
  ON customers (affiliate_id) WHERE affiliate_id IS NOT NULL;

-- 3. Link a sales_person to an affiliate's auth/customer account so invoices the
-- affiliate creates can auto-assign (and lock) them as the sales person.
ALTER TABLE sales_persons
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES customers (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_persons_user_id
  ON sales_persons (user_id) WHERE user_id IS NOT NULL;

-- 4. Requests to become an affiliate (approve/deny with reviewer tracking).
CREATE TABLE IF NOT EXISTS affiliate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  wallet_address text,
  message text,
  reviewed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one open request per customer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_affiliate_request_pending
  ON affiliate_requests (customer_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_affiliate_requests_status
  ON affiliate_requests (status);

-- RLS: all writes/reads happen via the service-role API (which bypasses RLS).
-- Enabling RLS with only an admin SELECT policy keeps anon/JWT clients out
-- while still allowing the service-role key full access.
ALTER TABLE affiliate_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read affiliate_requests" ON affiliate_requests;
CREATE POLICY "Admins read affiliate_requests"
  ON affiliate_requests FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = auth.uid() AND c.role IN ('admin', 'assistant')
    )
  );
