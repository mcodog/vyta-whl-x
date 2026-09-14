-- Migrate Existing Customers to Supabase Auth
-- Run this in Supabase SQL Editor
-- Date: April 2, 2026

-- ============================================================================
-- WARNING: READ BEFORE RUNNING
-- ============================================================================

-- This script creates Supabase Auth users for existing customers who don't
-- have auth accounts yet. This is necessary after integrating auth into the
-- user management system.

-- IMPORTANT NOTES:
-- 1. This must be run AFTER supabase-auth-integration.sql
-- 2. Cannot be done directly in SQL - must use Supabase Admin API
-- 3. This file contains the LOGIC only
-- 4. You need to implement this in a Node.js script using @supabase/supabase-js

-- ============================================================================
-- STEP 1: IDENTIFY CUSTOMERS WITHOUT AUTH USERS
-- ============================================================================

-- Run this query to see which customers need auth users created
SELECT
  c.id,
  c.email,
  c.first_name,
  c.last_name,
  c.role,
  c.active,
  c.created_at,
  CASE
    WHEN au.id IS NULL THEN 'NEEDS AUTH USER'
    ELSE 'HAS AUTH USER'
  END as status
FROM customers c
LEFT JOIN auth.users au ON c.id = au.id
WHERE au.id IS NULL
ORDER BY c.created_at ASC;

-- ============================================================================
-- STEP 2: NODE.JS MIGRATION SCRIPT
-- ============================================================================

-- Copy the following code to a file named `migrate-users.js` or `migrate-users.ts`
-- Then run it with: node migrate-users.js (or ts-node migrate-users.ts)

/*
// migrate-users.js
// =================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function migrateExistingUsers() {
  console.log('🔍 Finding customers without auth users...\n');

  // Get all customers
  const { data: customers, error: customersError } = await supabase
    .from('customers')
    .select('id, email, first_name, last_name, role, active')
    .order('created_at', { ascending: true });

  if (customersError) {
    console.error('Error fetching customers:', customersError);
    return;
  }

  console.log(`Found ${customers.length} total customers\n`);

  // Get all auth users
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    console.error('Error fetching auth users:', authError);
    return;
  }

  const authUserIds = new Set(authData.users.map(u => u.id));

  // Find customers without auth users
  const customersNeedingAuth = customers.filter(c => !authUserIds.has(c.id));

  console.log(`📋 ${customersNeedingAuth.length} customers need auth users created\n`);

  if (customersNeedingAuth.length === 0) {
    console.log('✅ All customers already have auth users!');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const customer of customersNeedingAuth) {
    console.log(`Creating auth user for: ${customer.email}...`);

    // Generate a random temporary password
    const tempPassword = `Temp${Math.random().toString(36).slice(2)}!`;

    try {
      // IMPORTANT: We cannot use the existing customer.id because auth.users
      // generates its own UUID. We need to:
      // 1. Create a NEW auth user (gets new UUID)
      // 2. UPDATE the customer record to use the new auth user's UUID
      // 3. This may break foreign key relationships!

      // Alternative: Skip customers with existing orders/data
      const { data: orderCheck } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', customer.id)
        .limit(1);

      if (orderCheck && orderCheck.length > 0) {
        console.log(`  ⚠️  SKIPPED: Customer has existing orders (ID: ${customer.id})`);
        console.log(`     Manual migration required for this customer\n`);
        errorCount++;
        continue;
      }

      // Create auth user with NEW UUID
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: customer.email.toLowerCase(),
        password: tempPassword,
        email_confirm: false, // They need to reset password
        user_metadata: {
          first_name: customer.first_name,
          last_name: customer.last_name,
          migrated: true,
          original_customer_id: customer.id
        }
      });

      if (authError || !authUser.user) {
        console.log(`  ❌ ERROR: ${authError?.message || 'Unknown error'}\n`);
        errorCount++;
        continue;
      }

      // Update customer record to use new auth user ID
      const { error: updateError } = await supabase
        .from('customers')
        .update({ id: authUser.user.id })
        .eq('id', customer.id);

      if (updateError) {
        console.log(`  ❌ ERROR updating customer: ${updateError.message}`);
        console.log(`     Auth user created (${authUser.user.id}) but customer not updated`);
        console.log(`     Deleting orphaned auth user...\n`);

        // Cleanup: delete the auth user we just created
        await supabase.auth.admin.deleteUser(authUser.user.id);
        errorCount++;
        continue;
      }

      console.log(`  ✅ SUCCESS: Auth user created (${authUser.user.id})`);
      console.log(`     Temp password: ${tempPassword}`);
      console.log(`     Customer should reset password via email\n`);

      // TODO: Send password reset email
      // const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      //   customer.email,
      //   { redirectTo: 'https://yourapp.com/reset-password' }
      // );

      successCount++;

    } catch (err) {
      console.log(`  ❌ EXCEPTION: ${err}\n`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Successfully migrated: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log('='.repeat(60));
}

migrateExistingUsers()
  .then(() => {
    console.log('\n✅ Migration complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });
*/

-- ============================================================================
-- STEP 3: ALTERNATIVE - MANUAL MIGRATION FOR CUSTOMERS WITH DATA
-- ============================================================================

-- For customers who have existing orders/relationships, you need to:
-- 1. Create auth user manually in Supabase Dashboard (Auth > Users > Add User)
-- 2. Copy the generated UUID
-- 3. Update customer record to use that UUID:

-- UPDATE customers
-- SET id = '<NEW_AUTH_USER_UUID>'
-- WHERE email = 'customer@example.com';

-- WARNING: This will break foreign key relationships if customer_id is referenced
-- in other tables (orders, etc.). You'll need to update those too.

-- ============================================================================
-- STEP 4: SEND PASSWORD RESET EMAILS
-- ============================================================================

-- After migration, send password reset emails to all migrated users:

/*
// send-reset-emails.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function sendResetEmails() {
  const { data: customers } = await supabase
    .from('customers')
    .select('email')
    .eq('email_verified', false);

  for (const customer of customers) {
    await supabase.auth.resetPasswordForEmail(customer.email, {
      redirectTo: 'https://yourapp.com/reset-password'
    });
    console.log(`Sent reset email to ${customer.email}`);
  }
}
*/

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- After migration, verify all customers have auth users:
SELECT
  COUNT(*) as total_customers,
  COUNT(au.id) as with_auth,
  COUNT(*) - COUNT(au.id) as without_auth
FROM customers c
LEFT JOIN auth.users au ON c.id = au.id;

-- Expected result: without_auth should be 0

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. Cannot create auth users directly in SQL (must use Admin API)
-- 2. Auth user UUIDs are generated by Supabase, cannot be manually set
-- 3. This creates a challenge for existing customers with data
-- 4. Best approach: Create auth users FIRST, then link customers to them
-- 5. For this migration, we need to UPDATE customer IDs (risky!)
-- 6. Consider creating a "customer_auth_id" column instead of changing "id"
-- 7. Or, accept that old customers won't have auth and create new accounts

-- ============================================================================
-- RECOMMENDED APPROACH FOR PRODUCTION
-- ============================================================================

-- Instead of migrating existing customers:
-- 1. Add a new column: customer_auth_id (nullable UUID)
-- 2. Link existing customers to new auth users via this column
-- 3. Keep original customer.id for foreign key integrity
-- 4. Update queries to check both id and customer_auth_id for auth lookups
-- 5. Gradually migrate customers as they log in

-- Schema change:
-- ALTER TABLE customers ADD COLUMN customer_auth_id UUID REFERENCES auth.users(id);
-- CREATE INDEX idx_customers_auth_id ON customers(customer_auth_id);

-- Then customers can either:
-- - Have customer.id = auth_user.id (new customers)
-- - Have customer.customer_auth_id = auth_user.id (migrated old customers)
