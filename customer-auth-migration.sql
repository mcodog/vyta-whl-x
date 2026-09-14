-- Customer Authentication Migration
-- Run this in Supabase SQL Editor

-- Add authentication and profile fields to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_country TEXT DEFAULT 'US';

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Verify the changes
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customers';
