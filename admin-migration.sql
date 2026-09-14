-- Admin Migration
-- Run this in Supabase SQL Editor

-- Add is_admin column to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create index for admin lookups
CREATE INDEX IF NOT EXISTS idx_customers_admin ON customers(is_admin) WHERE is_admin = true;

-- To make a user an admin, run:
-- UPDATE customers SET is_admin = true WHERE email = 'your-email@example.com';
