-- Affiliate "manual code only" flag
-- By default, a customer bound to an affiliate (customers.affiliate_id) gets the
-- affiliate discount auto-applied at checkout — the order is "locked" to that
-- affiliate whether or not a referral code is entered.
--
-- Setting manual_code_only = true on an affiliate removes that auto-lock for the
-- customers bound to them: the discount/attribution only applies when the
-- customer supplies the referral code — either by typing it in at checkout or by
-- arriving via a referral link (?ref=CODE, which auto-fills the code). Being
-- bound to the affiliate alone no longer applies the discount.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS manual_code_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN affiliates.manual_code_only IS
  'When true, customers bound to this affiliate do NOT get the affiliate discount auto-applied at checkout. Attribution requires the referral code to be entered manually or supplied via a ?ref= link. Default false (binding auto-applies).';
