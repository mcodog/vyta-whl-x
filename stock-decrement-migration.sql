-- =====================================================================
-- Stock decrement on payment
-- ---------------------------------------------------------------------
-- When an order's crypto payment is CONFIRMED, or an invoice becomes
-- fully PAID, the purchased products' stock_quantity is decremented by
-- the quantities on the order/invoice line items.
--
-- Idempotency: a `stock_adjusted` flag on orders/invoices guarantees the
-- decrement runs at most once per order/invoice, even if a payment is
-- detected by both the polling route and the cron job, or an invoice's
-- status is toggled paid -> unpaid -> paid.
--
-- Safe to run multiple times.
-- =====================================================================

-- 1. Idempotency flags ------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

-- 2. Order stock adjustment ------------------------------------------
-- order_items.product_id is TEXT (it stores the product UUID as a
-- string), so we cast it to uuid, guarding against non-uuid/null values.
CREATE OR REPLACE FUNCTION adjust_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Claim the adjustment atomically; bail if it already ran (or no order).
  UPDATE orders
     SET stock_adjusted = true
   WHERE id = p_order_id
     AND stock_adjusted = false;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE products p
     SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - agg.qty)
    FROM (
      SELECT oi.product_id::uuid AS pid, SUM(oi.quantity) AS qty
        FROM order_items oi
       WHERE oi.order_id = p_order_id
         AND oi.product_id IS NOT NULL
         AND oi.product_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       GROUP BY oi.product_id
    ) agg
   WHERE p.id = agg.pid;
END;
$$;

-- 3. Invoice stock adjustment ----------------------------------------
-- invoice_line_items.product_id is already uuid.
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE invoices
     SET stock_adjusted = true
   WHERE id = p_invoice_id
     AND stock_adjusted = false;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE products p
     SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - agg.qty)
    FROM (
      SELECT li.product_id AS pid, SUM(li.qty) AS qty
        FROM invoice_line_items li
       WHERE li.invoice_id = p_invoice_id
         AND li.product_id IS NOT NULL
       GROUP BY li.product_id
    ) agg
   WHERE p.id = agg.pid;
END;
$$;
