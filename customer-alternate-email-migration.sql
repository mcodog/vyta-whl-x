-- Customer alternate email
-- Adds an optional secondary email address for a customer, alongside the
-- primary `email` used for their login/account. The alternate email is purely
-- informational (a backup contact / CC address) — it is NOT used for auth and
-- is not required to be unique.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS alternate_email TEXT;

COMMENT ON COLUMN customers.alternate_email IS
  'Optional secondary/backup email for the customer. Informational only — not used for authentication and not required to be unique.';
