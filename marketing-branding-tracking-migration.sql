-- Marketing: site branding + web tracking (GA4 / Meta Pixel) + consent
--
-- Adds storefront-facing branding fields and web-analytics tracking IDs to the
-- singleton `site_settings` row, plus a consent toggle. These are managed from
-- the new /admin/marketing page by admins and the analytics/marketing role, and
-- read publicly by the storefront (branding for the header/footer/metadata; the
-- tracking IDs are embedded in client-side pixel scripts, so they are public by
-- nature — no secrets are stored here).
--
-- Idempotent — safe to re-run.

ALTER TABLE site_settings
  -- Branding (store identity). NULL = fall back to the built-in defaults.
  ADD COLUMN IF NOT EXISTS store_name    text,
  ADD COLUMN IF NOT EXISTS store_tagline text,
  ADD COLUMN IF NOT EXISTS logo_url      text,
  ADD COLUMN IF NOT EXISTS favicon_url   text,
  -- Web tracking. NULL/empty = that pixel is simply not injected.
  ADD COLUMN IF NOT EXISTS ga4_measurement_id text,  -- e.g. G-XXXXXXXXXX
  ADD COLUMN IF NOT EXISTS meta_pixel_id       text,  -- numeric Meta Pixel ID
  -- When true, the storefront shows a cookie-consent banner and only loads the
  -- pixels after the visitor accepts (GDPR-friendly). When false, pixels load
  -- on every page (use only where you have another lawful basis).
  ADD COLUMN IF NOT EXISTS tracking_consent_required boolean NOT NULL DEFAULT true;
