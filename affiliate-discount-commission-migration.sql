-- Affiliate discount + commission on customer orders.
--
-- When an order is attributed to an affiliate (either the customer is bound to
-- the affiliate via customers.affiliate_id, or a referral code was used), the
-- customer gets a discount on the product subtotal and the affiliate earns a
-- commission on the discounted subtotal. We store the discount on the order so
-- the order summary and the generated invoice can reflect it, and so the total
-- the customer paid stays auditable.
--
-- Safe to re-run.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;
