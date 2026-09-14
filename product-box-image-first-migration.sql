-- Box-image-first storefront product cards (opt-in)
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Lets an admin opt a product into showing its box / packaging image as the
-- primary image on the storefront product cards (home page featured grid, hero
-- and full catalog) instead of the vial shot. When a product is opted in, its
-- card leads with the box image and the vial image moves to the hover position;
-- products that are not opted in keep the current vial-first behaviour.
--
-- Adds:
--   products.box_image_first — when true, the storefront product cards display
--   the box / packaging image first (as the primary image) rather than the vial
--   image. Defaults to false, so the change is opt-in per product.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS box_image_first BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.box_image_first IS
  'When true, the storefront product cards show the box / packaging image first (as the primary image) instead of the vial image. Defaults to false (opt-in).';
