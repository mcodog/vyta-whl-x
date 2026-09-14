-- Free shipping threshold
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Lets the store offer free shipping once an order's (discounted) product
-- subtotal reaches a configurable amount. The storefront shows a "spend $X more
-- for free shipping" progress bar, and checkout actually zeroes the shipping
-- charge when the threshold is cleared.
--
-- Adds:
--   site_settings.free_shipping_threshold — CAD-base subtotal at/above which
--   shipping is free. 0 (the default) disables the feature entirely.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS free_shipping_threshold NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN site_settings.free_shipping_threshold IS
  'Free shipping threshold: shipping is free once the discounted product subtotal (CAD) reaches this amount. 0 disables free shipping.';
