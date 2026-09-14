-- USD pricing for products
-- =========================
-- Adds a USD price alongside the existing CAD `price` column and a global
-- CAD→USD exchange multiplier so the admin can show/charge prices in either
-- currency.
--
-- Conventions:
--   * products.price          — the CAD price (pack of 10 / box). Base price.
--   * products.price_usd       — an OPTIONAL explicit USD override. When NULL,
--                                the USD price is computed on the fly as
--                                ROUND(price * usd_exchange_rate, 2). Mirrors
--                                how vial_price falls back to price / 10.
--   * site_settings.usd_exchange_rate — the CAD→USD multiplier used for the
--                                auto USD price. Admin-editable in Site Settings
--                                (with an optional "fetch live rate" helper) so
--                                the multiplier can be kept up to date.
--
-- Run this in the Supabase SQL editor.

------------------------------------------------------------------------------
-- 1. Optional per-product USD override.
------------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_usd numeric;

COMMENT ON COLUMN products.price_usd IS
  'Optional explicit USD price. When NULL the USD price is computed as ROUND(price * site_settings.usd_exchange_rate, 2).';

------------------------------------------------------------------------------
-- 2. Global CAD→USD multiplier.
------------------------------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS usd_exchange_rate numeric NOT NULL DEFAULT 0.73;

COMMENT ON COLUMN site_settings.usd_exchange_rate IS
  'CAD→USD multiplier. USD price = CAD price * this rate. Kept up to date by the admin (Site Settings).';
