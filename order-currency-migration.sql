-- Order currency (CAD / USD)
-- ==========================
-- Records which currency an order was placed and billed in, so USD-tagged
-- customers (customers.price_currency = 'USD') get orders, invoices, and
-- confirmation emails denominated in USD rather than the CAD default.
--
-- Conventions:
--   * orders.currency = the currency the order's `total`, `discount_amount`,
--     and each order_items.price_at_time are stored in. Defaults to 'CAD'.
--   * The auto-created invoice inherits this currency (invoices.currency).
--   * Product prices are the CAD base; the USD amounts are derived at checkout
--     from products.price_usd (explicit override) or price × usd_exchange_rate.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD'
    CHECK (currency IN ('CAD', 'USD'));

COMMENT ON COLUMN orders.currency IS
  'Currency the order total / line prices are stored in. CAD (default) or USD, from the customer''s price_currency tag at checkout.';
