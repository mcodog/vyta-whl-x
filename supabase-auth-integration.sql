-- Supabase Auth Integration for User Management
-- Run this in Supabase SQL Editor
-- Date: April 2, 2026

-- ============================================================================
-- PART 1: VERIFY EXISTING SCHEMA
-- ============================================================================

-- The customers table already has the necessary columns:
-- - id (uuid) - This will match auth.users.id
-- - role (user_role enum) - Already exists
-- - active (boolean) - Already exists
-- - email_verified (boolean) - Already exists
-- - last_login_at (timestamptz) - Already exists

-- Verify current schema
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- ============================================================================
-- PART 2: RLS (Row Level Security) POLICIES
-- ============================================================================

-- Enable RLS on customers table if not already enabled
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Policy: Customers can read their own record
CREATE POLICY IF NOT EXISTS "Customers can view own profile"
ON customers FOR SELECT
USING (auth.uid() = id);

-- Policy: Customers can update their own record (except role and is_admin)
CREATE POLICY IF NOT EXISTS "Customers can update own profile"
ON customers FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND role = OLD.role  -- Cannot change own role
  AND is_admin = OLD.is_admin  -- Cannot change own admin status
);

-- Policy: Service role can do everything (for admin operations)
CREATE POLICY IF NOT EXISTS "Service role has full access"
ON customers
USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- PART 3: HELPER FUNCTION FOR USER MANAGEMENT
-- ============================================================================

-- Function to create auth user and customer profile in one transaction
CREATE OR REPLACE FUNCTION create_user_with_auth(
  p_email TEXT,
  p_password TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_role user_role DEFAULT 'customer',
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Note: This function is a placeholder
  -- The actual auth user creation must be done via Supabase Admin API
  -- from the application server (using service role key)

  -- This function is here for reference only
  -- DO NOT use this from client code

  RAISE EXCEPTION 'This function is for reference only. Use Supabase Admin API from server.';
END;
$$;

-- ============================================================================
-- PART 4: VERIFICATION QUERIES
-- ============================================================================

-- Check for customers without auth users
SELECT
  c.id,
  c.email,
  c.first_name,
  c.last_name,
  c.role,
  c.active,
  CASE
    WHEN au.id IS NULL THEN 'NO AUTH USER'
    ELSE 'HAS AUTH USER'
  END as auth_status
FROM customers c
LEFT JOIN auth.users au ON c.id = au.id
ORDER BY c.created_at DESC;

-- Count customers by auth status
SELECT
  COUNT(*) as total_customers,
  COUNT(au.id) as with_auth,
  COUNT(*) - COUNT(au.id) as without_auth
FROM customers c
LEFT JOIN auth.users au ON c.id = au.id;

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. The customers.id must match auth.users.id for proper linking
-- 2. Auth user creation must be done via Supabase Admin API (server-side)
-- 3. Use SUPABASE_SERVICE_ROLE_KEY for admin operations
-- 4. Email confirmation can be auto-set for admin-created users
-- 5. The sync_admin_role_trigger keeps is_admin and role in sync

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Next step: Run migrate-existing-users-to-auth.sql to create auth users
-- for existing customers
