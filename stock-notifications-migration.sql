-- Stock notification requests ("Notify me when back in stock")
-- Stores customer requests to be emailed when an out-of-stock product is
-- restocked. When a product's stock_quantity transitions from 0 to > 0 the
-- pending requests are emailed and marked as 'notified'.

CREATE TABLE IF NOT EXISTS stock_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'notified' | 'cancelled'
  created_at TIMESTAMPTZ DEFAULT now(),
  notified_at TIMESTAMPTZ
);

-- One active (pending) request per product/email pair. Emails are stored
-- lower-cased by the API so this also dedupes case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_notifications_pending
  ON stock_notifications (product_id, email)
  WHERE status = 'pending';

-- Fast lookups for the admin waitlist view and the restock trigger.
CREATE INDEX IF NOT EXISTS idx_stock_notifications_product
  ON stock_notifications (product_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_stock_notifications_status
  ON stock_notifications (status);
