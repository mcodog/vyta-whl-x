-- Supabase Storage Setup for Product Images
-- IMPORTANT: Do NOT run this SQL file!
-- Instead, use the Supabase Dashboard UI to create the bucket.
-- Date: 2026-03-31

-- ============================================================================
-- MANUAL SETUP INSTRUCTIONS (Use Supabase Dashboard)
-- ============================================================================
--
-- 1. Go to: Storage > Create a new bucket
-- 2. Bucket name: products
-- 3. Toggle "Public bucket" to ON
-- 4. Click "Create bucket"
--
-- That's it! The service role key in your API route will handle uploads.
-- No RLS policies needed because service role bypasses RLS.
-- ============================================================================

-- ============================================================================
-- FOR REFERENCE ONLY - What this would do if you had superuser access:
-- ============================================================================

-- Create the 'products' storage bucket
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('products', 'products', true)
-- ON CONFLICT (id) DO UPDATE
-- SET public = true;

-- Verify the bucket (you can run this to check if bucket exists)
SELECT * FROM storage.buckets WHERE id = 'products';
