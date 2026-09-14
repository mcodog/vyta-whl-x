-- Storefront categories — a controlled, editable taxonomy
--
-- Until now the storefront's category list lived in two hardcoded arrays:
--   * app/products/page.tsx  — the /products filter bar (9 categories + "All")
--   * components/Features.tsx — the homepage "Browse by Application" grid (a
--                               curated subset of 6, with marketing labels)
--
-- This migration lifts that list into a `store_categories` table so admins can
-- rename, reorder, re-icon, show/hide, and feature categories from the backend
-- (/admin/categories) without a code change. The rows below reproduce EXACTLY
-- what the storefront shows today.
--
-- Model:
--   slug        Stable key. Matches products.category, so it is NOT edited from
--               the UI (renaming a category changes `name`, not `slug`).
--   name        Label shown in the /products filter bar.
--   home_label  Optional label shown on the homepage grid (falls back to `name`
--               when null). Lets the homepage keep its punchier marketing names.
--   description Optional homepage subtitle (e.g. "GLP-1 Agonists").
--   icon        Lucide icon key, mapped to a component on the client
--               (see lib/categories.ts). Falls back to "Beaker" if unknown.
--   sort_order  Ordering for both surfaces (ascending).
--   active      Show in the /products filter bar.
--   featured    Show on the homepage "Browse by Application" grid.

CREATE TABLE IF NOT EXISTS store_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  home_label  text,
  description text,
  icon        text NOT NULL DEFAULT 'Beaker',
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  featured    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_categories_sort ON store_categories (sort_order);
CREATE INDEX IF NOT EXISTS idx_store_categories_active ON store_categories (active);
CREATE INDEX IF NOT EXISTS idx_store_categories_featured ON store_categories (featured);

-- Categories are public catalog data: readable by everyone. All writes go
-- through the service-role admin API (which bypasses RLS), so no write policy is
-- needed here — mirrors the products table.
ALTER TABLE store_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store categories are viewable by everyone" ON store_categories;
CREATE POLICY "Store categories are viewable by everyone" ON store_categories
  FOR SELECT USING (true);

-- Seed the current storefront taxonomy. Idempotent: re-running updates the
-- descriptor columns in place but never clobbers a slug's identity. `sort_order`
-- and the featured/home_label/description values reproduce today's exact display
-- (products filter order 1..9; homepage grid = the 6 featured rows in the same
-- order, showing home_label + description).
INSERT INTO store_categories (slug, name, home_label, description, icon, sort_order, active, featured) VALUES
  ('Weight Loss / Metabolic', 'Metabolic',      'Metabolic',    'GLP-1 Agonists',   'TestTube', 1, true, true),
  ('Healing / Recovery',      'Healing',        'Regenerative', 'Tissue Repair',    'Heart',    2, true, true),
  ('Anti-Aging / Beauty',     'Anti-Aging',     'Longevity',    'Cellular Health',  'Sparkles', 3, true, true),
  ('Bodybuilding / Fitness',  'Performance',    'Performance',  'Growth Factors',   'Dna',      4, true, true),
  ('Cognitive / Focus',       'Cognitive',      'Nootropic',    'Neuropeptides',    'Brain',    5, true, true),
  ('Sexual Health',           'Sexual Health',  NULL,           NULL,               'Zap',      6, true, false),
  ('General Health',          'General Health', 'Therapeutic',  'Clinical Peptides','Pill',     7, true, true),
  ('Hormonal / Fertility',    'Hormonal',       NULL,           NULL,               'Scale',    8, true, false),
  ('Beauty / Tanning',        'Tanning',        NULL,           NULL,               'Sparkles', 9, true, false)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  home_label  = EXCLUDED.home_label,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active,
  featured    = EXCLUDED.featured,
  updated_at  = now();
