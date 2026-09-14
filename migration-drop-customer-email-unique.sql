-- Allow duplicate customer emails
-- ================================
-- Drops the UNIQUE constraint on customers.email so more than one customer
-- record can share the same email address. This is primarily useful for guest
-- records (no login) — e.g. two invoice quick-adds that reuse the same contact
-- email, or a reseller and their client sharing an inbox.
--
-- NOTE: accounts that have a real login are still backed by Supabase Auth
-- (auth.users), which enforces unique emails independently of this table. So
-- this change only enables duplicate emails for GUEST customers; you still
-- cannot create two login accounts with the same email.
--
-- A non-unique lookup index (idx_customers_email) already exists and is kept,
-- so email lookups stay fast.

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_email_key;
