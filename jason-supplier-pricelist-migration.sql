-- Jason Supplier Pricelist
-- ========================
-- Sets supplier "Jason" (a1376c91-2ad1-4d79-bbf5-da7c302d7ef5) prices for every
-- active product using the agreed cost formula:
--
--     jason_price = ROUND(products.price * 0.65 + 5.00, 2)
--
-- Creates a supplier_prices row for each active product Jason does not yet have,
-- and updates any existing Jason row to the formula price. products.price is the
-- box (pack-of-10) price in decimal dollars; supplier_prices.price is numeric(10,2).
--
-- Safe to run multiple times.

INSERT INTO supplier_prices (supplier_id, product_id, price)
SELECT
  'a1376c91-2ad1-4d79-bbf5-da7c302d7ef5'::uuid AS supplier_id,
  p.id                                          AS product_id,
  ROUND(COALESCE(p.price, 0) * 0.65 + 5.00, 2)  AS price
FROM products p
WHERE p.active = true
ON CONFLICT (supplier_id, product_id) DO UPDATE
  SET price = EXCLUDED.price,
      updated_at = now();
