-- Per-customer storefront currency conversion
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- `customers.price_currency` says which currency a customer is billed in. Until
-- now a USD customer's storefront prices were always CONVERTED into USD at the
-- store's `usd_exchange_rate`, so a price list configured at 156 was shown and
-- charged as ~113 USD.
--
-- That is wrong for price lists that were already negotiated in the customer's
-- own currency: the figure in the list IS the price, and converting it quietly
-- discounts every line. This adds a per-customer switch:
--
--   convert_storefront_prices = false (DEFAULT)
--     Show the configured figure as-is and bill it in `price_currency`.
--     A list configured at 156 reads "$156.00 USD" and is charged as 156 USD.
--
--   convert_storefront_prices = true
--     The previous behaviour: convert the configured CAD figure into
--     `price_currency` at the store rate (and honour a product's explicit
--     `price_usd`).
--
-- SCOPE: the storefront only — product pages, cart, both checkouts, the
-- storefront order email, and the amounts sent to the PuraMass hosted checkout.
-- Admin-created invoices are NOT affected: the admin invoice form keeps its own
-- currency handling, so nothing about back-office invoicing changes.
--
-- NOTE ON THE DEFAULT: `false` means existing USD customers stop seeing
-- converted storefront prices as soon as this runs. That is the intended
-- behaviour — flip the toggle on for any customer whose list really is in CAD
-- and should be converted.
--
-- Safe to run more than once. Code reads a missing column as `false`, so the
-- new (as-is) behaviour applies even before this runs.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS convert_storefront_prices BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN customers.convert_storefront_prices IS
  'Storefront only. When false (default), the customer''s configured prices are shown and charged as-is but denominated in price_currency — a list configured at 156 is billed as 156 USD. When true, those figures are converted into price_currency at site_settings.usd_exchange_rate (the legacy behaviour). Admin-created invoices ignore this column.';
