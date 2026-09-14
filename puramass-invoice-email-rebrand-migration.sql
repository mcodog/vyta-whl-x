-- PuraMass rebrand — invoice customer email template
-- =============================================================================
-- The invoice customer email subject/body live in site_settings and take
-- precedence over the code defaults at render time. They were originally seeded
-- (invoice-email-migration.sql) with the old "Aminocan" brand name, so an
-- untouched install still emails "Your Aminocan invoice …" / "— Aminocan".
--
-- This migration rebrands those stored templates to PuraMass. It only rewrites
-- rows that still hold the EXACT old default — if an admin has customised the
-- template, their wording is left untouched.
--
-- Safe to run more than once (already-rebranded rows no longer match the WHERE).

UPDATE site_settings
SET invoice_customer_email_subject = 'Your PuraMass invoice {{invoice_number}}'
WHERE invoice_customer_email_subject = 'Your Aminocan invoice {{invoice_number}}';

UPDATE site_settings
SET invoice_customer_email_body = 'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— PuraMass'
WHERE invoice_customer_email_body = 'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— Aminocan';
