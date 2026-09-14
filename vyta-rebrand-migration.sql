-- VYTA Biosciences rebrand — stored branding + email templates
-- =============================================================================
-- The storefront branding (store name/tagline) and the customer email templates
-- live in `site_settings` and take precedence over the code defaults at render
-- time. They were seeded with the earlier "Aminocan" / "PuraMass" brand names,
-- so an untouched install would still show and email the old brand even after
-- the code rebrand.
--
-- This migration rebrands those stored values to VYTA Biosciences. It only
-- rewrites rows that still hold an EXACT earlier default — if an admin has
-- customised a template or set their own store name, their wording is left
-- untouched.
--
-- It does NOT touch the PuraMass / Stealth Health hosted-checkout settings
-- (`puramass_checkout_enabled` and friends): that is the payment partner's
-- name, not ours.
--
-- Safe to run more than once (already-rebranded rows no longer match the WHERE).

------------------------------------------------------------------------------
-- 1. Storefront branding (nav, footer, page title)
------------------------------------------------------------------------------
UPDATE site_settings
SET store_name = 'VYTA Biosciences'
WHERE store_name IN ('Aminocan Peptides', 'Aminocan', 'PuraMass', 'PuraMass Peptides');

------------------------------------------------------------------------------
-- 2. Invoice customer email (subject + body)
------------------------------------------------------------------------------
UPDATE site_settings
SET invoice_customer_email_subject = 'Your VYTA Biosciences invoice {{invoice_number}}'
WHERE invoice_customer_email_subject IN (
  'Your PuraMass invoice {{invoice_number}}',
  'Your Aminocan invoice {{invoice_number}}'
);

UPDATE site_settings
SET invoice_customer_email_body = 'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— VYTA Biosciences'
WHERE invoice_customer_email_body IN (
  'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— PuraMass',
  'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— Aminocan'
);

------------------------------------------------------------------------------
-- 3. Payment-request email (body)
------------------------------------------------------------------------------
UPDATE site_settings
SET payment_email_body = 'Hi {{customer_first_name}},

Your order is ready for payment. Invoice {{invoice_number}} has a balance of ${{amount_due}} {{currency}}.

Review your order and pay securely here:
{{payment_url}}

You can pay by crypto or by Visa / Mastercard — pick whichever you prefer on that page.

If anything looks off, just reply to this email and we''ll sort it out.

— VYTA Biosciences'
WHERE payment_email_body IN (
  'Hi {{customer_first_name}},

Your order is ready for payment. Invoice {{invoice_number}} has a balance of ${{amount_due}} {{currency}}.

Review your order and pay securely here:
{{payment_url}}

You can pay by crypto or by Visa / Mastercard — pick whichever you prefer on that page.

If anything looks off, just reply to this email and we''ll sort it out.

— PuraMass',
  'Hi {{customer_first_name}},

Your order is ready for payment. Invoice {{invoice_number}} has a balance of ${{amount_due}} {{currency}}.

Review your order and pay securely here:
{{payment_url}}

You can pay by crypto or by Visa / Mastercard — pick whichever you prefer on that page.

If anything looks off, just reply to this email and we''ll sort it out.

— Aminocan'
);
