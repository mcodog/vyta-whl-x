-- Sales-person line-item discount presets
-- =======================================
-- Each sales person (rep or affiliate — the base sales_persons row per ADR 0003)
-- can carry a default per-line discount that PRE-FILLS the Disc % field when a
-- line item is added on one of their invoices. Two presets, one per line type:
--
--   * default_box_discount_pct  — % pre-filled on BOX (pack-of-10) lines.
--   * default_vial_discount_pct — % pre-filled on single-VIAL lines.
--
-- These are only defaults: the admin/affiliate can change or clear the discount
-- on any line. They are percentages (0–100), matching the existing per-line
-- discount_pct field. 0 (the default) means "no preset".
--
-- Run this in the Supabase SQL editor. Safe to run multiple times.

ALTER TABLE sales_persons
  ADD COLUMN IF NOT EXISTS default_box_discount_pct  numeric(5,2) NOT NULL DEFAULT 0
    CHECK (default_box_discount_pct  >= 0 AND default_box_discount_pct  <= 100),
  ADD COLUMN IF NOT EXISTS default_vial_discount_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (default_vial_discount_pct >= 0 AND default_vial_discount_pct <= 100);

COMMENT ON COLUMN sales_persons.default_box_discount_pct IS
  'Default discount % pre-filled on box (pack-of-10) invoice lines for this sales person. 0 = no preset. Just a default — editable/removable per line.';
COMMENT ON COLUMN sales_persons.default_vial_discount_pct IS
  'Default discount % pre-filled on single-vial invoice lines for this sales person. 0 = no preset. Just a default — editable/removable per line.';

-- ---------------------------------------------------------------------------
-- getatkat: default a 50% discount on VIAL lines.
--   Her sales-person row is matched either by its affiliate link (user_id =
--   her customers/auth id) or, for a contact-only "Rep" row, by her email.
--   Box preset is left at 0 (unchanged). This is a preset only — it can be
--   removed per line at invoice time.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  updated int;
BEGIN
  UPDATE sales_persons
     SET default_vial_discount_pct = 50,
         updated_at = now()
   WHERE user_id = '3ccf26f2-61b8-4013-8027-ddf783795d11'
      OR lower(email) = 'getatkat@gmail.com';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RAISE NOTICE 'getatkat vial preset: % sales_persons row(s) set to 50%%.', updated;
  IF updated = 0 THEN
    RAISE NOTICE 'No sales_persons row matched getatkat (user_id or email). She must be set up as a sales person/affiliate for the preset to apply.';
  END IF;
END $$;
