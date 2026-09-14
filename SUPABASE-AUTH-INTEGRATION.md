# Supabase Auth Integration - Implementation Guide

**Date:** April 2, 2026
**Status:** ✅ Complete
**Type:** Backend Integration

---

## 📋 Summary

Integrated Supabase Auth into the admin user management system. When admins create or edit users via the admin dashboard, proper Supabase Auth users are now created/updated automatically. This enables users created by admins to login with their credentials.

---

## 🎯 What Changed

### 1. Database Setup

**File:** `supabase-auth-integration.sql`

- **Row Level Security (RLS)** policies added to `customers` table
- Customers can view/update their own profile
- Service role has full access for admin operations
- Helper verification queries to check auth user status

**Key Points:**
- No schema changes needed - existing columns are sufficient
- `customers.id` matches `auth.users.id` for linking
- `role`, `active`, `email_verified`, `last_login_at` already exist

### 2. Backend API Updates

**File:** `lib/admin/api.ts`

#### New Functions Added:

##### `getUsers(filters?)`
- Get all users with optional filtering by role, active status, and search
- Supports searching by name or email
- Returns Customer[] array

##### `createUser(data)`
**Before:**
- Only inserted into `customers` table
- No auth user created
- Users couldn't login

**After:**
- ✅ Creates Supabase Auth user via `supabase.auth.admin.createUser()`
- ✅ Uses auth user's UUID as `customers.id` (linking them)
- ✅ Password hashed automatically by Supabase Auth
- ✅ Auto-confirms email for admin-created users
- ✅ Rollback on failure (deletes auth user if customer creation fails)
- ✅ Users can login immediately

##### `updateUser(userId, updates)`
**Features:**
- Updates both `auth.users` and `customers` tables
- Handles email changes (updates in both places)
- Handles password changes via `supabase.auth.admin.updateUserById()`
- Keeps role and active status synced
- Updates metadata in auth user record

##### `deleteUser(userId, hard?)`
**Two modes:**
- **Soft Delete** (default): Sets `active = false`, user cannot login
- **Hard Delete**: Removes from both `auth.users` and `customers` tables

##### `toggleUserActive(userId, active)`
- Quick status toggle for activating/deactivating users
- Updates `customers.active` field
- When `active = false`, user cannot login

### 3. TypeScript Interface Updates

**File:** `lib/supabase.ts`

```typescript
export type UserRole = 'customer' | 'assistant' | 'admin';

export interface Customer {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  wallet_address: string | null;
  phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  is_admin: boolean;
  role: UserRole;              // ✅ Added
  active: boolean;              // ✅ Added
  last_login_at: string | null; // ✅ Added
  email_verified: boolean;      // ✅ Added
  created_at: string;
  updated_at: string;
}
```

---

## 🔐 How It Works

### User Creation Flow:

1. Admin clicks "Add User" in admin dashboard
2. Admin fills form (email, name, password, role)
3. Frontend calls `createUser()` function
4. Backend:
   - Calls `supabase.auth.admin.createUser()` → Creates auth user
   - Gets auth user's UUID
   - Inserts into `customers` table with `id = auth_user.id`
   - Links auth user to customer profile
5. User can now login with their credentials
6. On login, Supabase Auth validates credentials
7. App fetches customer profile using `auth.users.id`

### User Update Flow:

1. Admin clicks Edit icon in users table
2. Admin modifies email, name, role, or password
3. Frontend calls `updateUser()`
4. Backend:
   - If email/password changed → Updates `auth.users` via Admin API
   - Updates `customers` table with new information
   - Keeps both tables in sync
5. User can login with updated credentials

### User Deletion Flow:

**Soft Delete (Recommended):**
1. Admin clicks Deactivate icon
2. Sets `customers.active = false`
3. User cannot login (auth check fails)
4. Data preserved for reactivation

**Hard Delete:**
1. Admin clicks Delete → Chooses "Permanent Delete"
2. Deletes from `customers` table first
3. Deletes from `auth.users` table
4. All data permanently removed

---

## 🔑 Environment Variables Required

Make sure these are set in your `.env.local`:

```env
# Public (client-side)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-side only (REQUIRED for auth admin operations)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**⚠️ IMPORTANT:** The `SUPABASE_SERVICE_ROLE_KEY` is **required** for admin auth operations. It bypasses Row Level Security (RLS) and allows creating/updating/deleting auth users.

---

## 📁 Files Modified/Created

### New Files:
- ✅ `supabase-auth-integration.sql` - RLS policies and verification queries
- ✅ `migrate-existing-users-to-auth.sql` - Migration guide for existing users
- ✅ `SUPABASE-AUTH-INTEGRATION.md` - This documentation

### Modified Files:
- ✅ `lib/admin/api.ts` - Added 5 new user management functions
- ✅ `lib/supabase.ts` - Updated Customer interface with new fields
- ✅ `lib/supabase.ts` - Exported UserRole type

### Unchanged (Already Compatible):
- ✅ `app/(admin)/admin/users/page.tsx` - Uses new API functions
- ✅ `app/(admin)/admin/users/_components/CreateUserModal.tsx` - Works with new createUser()
- ✅ `app/(admin)/admin/users/_components/EditUserModal.tsx` - Works with new updateUser()
- ✅ `app/(admin)/admin/users/_components/DeleteConfirmDialog.tsx` - Works with new deleteUser()

---

## 🚀 Deployment Steps

### Step 1: Run SQL Migration

In Supabase SQL Editor, run:

```sql
-- File: supabase-auth-integration.sql
```

This sets up RLS policies and verification queries.

### Step 2: Verify Environment Variables

Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in your environment:

```bash
# Check if variable exists
echo $SUPABASE_SERVICE_ROLE_KEY

# Or in .env.local
cat .env.local | grep SUPABASE_SERVICE_ROLE_KEY
```

### Step 3: Deploy Code Changes

```bash
# Commit changes
git add .
git commit -m "Integrate Supabase Auth with user management"

# Deploy to production
git push origin main
```

### Step 4: Test User Creation

1. Login to admin dashboard
2. Go to Users page
3. Click "Add User"
4. Create a test user
5. Logout
6. Try logging in as the new user
7. ✅ Should work!

### Step 5: Migrate Existing Users (Optional)

⚠️ **Only if you have existing customers without auth users**

See `migrate-existing-users-to-auth.sql` for detailed instructions.

---

## 🧪 Testing Checklist

- [x] Create new user via admin panel → Can login ✅
- [x] Edit user email → Login with new email works ✅
- [x] Reset user password → Login with new password works ✅
- [x] Deactivate user → Cannot login ✅
- [x] Activate user → Can login again ✅
- [x] Delete user (hard) → Auth user removed ✅
- [x] Existing auth signup flow still works ✅
- [x] Customer signup creates both auth + customer ✅
- [x] Role permissions still work (admin, assistant, customer) ✅

---

## 🔒 Security Considerations

### ✅ Good Security Practices Implemented:

1. **Service Role Key** - Only used server-side, never exposed to client
2. **RLS Policies** - Customers can only access their own data
3. **Email Confirmation** - Admin-created users have auto-confirmed emails
4. **Password Hashing** - Supabase Auth handles hashing automatically (bcrypt)
5. **Rollback on Failure** - If customer creation fails, auth user is deleted
6. **Active Status** - Deactivated users cannot login

### ⚠️ Recommended Improvements:

1. **API Route Protection** - Add role checks to API routes:
   ```typescript
   // Example for /api/admin/users route
   const { data: customer } = await supabase
     .from('customers')
     .select('role')
     .eq('id', user.id)
     .single();

   if (customer.role !== 'admin') {
     return Response.json({ error: 'Forbidden' }, { status: 403 });
   }
   ```

2. **Rate Limiting** - Add rate limiting to user creation endpoint

3. **Audit Logging** - Log all user management actions for compliance

4. **Two-Factor Authentication** - Enable 2FA for admin users

---

## 📊 Database Schema Reference

### customers table (existing):

```sql
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email varchar UNIQUE NOT NULL,
  first_name varchar,
  last_name varchar,
  password_hash text,
  phone text,
  wallet_address varchar,
  shipping_address text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text DEFAULT 'US',
  is_admin boolean DEFAULT false,
  role user_role DEFAULT 'customer',
  active boolean DEFAULT true,
  last_login_at timestamptz,
  email_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### auth.users (Supabase managed):

```sql
-- Managed by Supabase Auth
-- customers.id references auth.users.id
```

---

## 🐛 Troubleshooting

### Error: "Failed to create auth user"

**Cause:** Service role key not set or invalid

**Fix:**
```bash
# Check .env.local has service role key
SUPABASE_SERVICE_ROLE_KEY=your-key-here
```

### Error: "Email already exists"

**Cause:** User with that email already exists in `auth.users`

**Fix:**
1. Check Supabase Dashboard → Auth → Users
2. Delete existing auth user if it's a duplicate
3. Or use a different email

### User created but cannot login

**Possible causes:**
1. `active = false` → Check Users table, activate user
2. Email not confirmed → Should be auto-confirmed for admin-created users
3. Wrong password → Admin should reset user's password

**Fix:**
```sql
-- Check user status
SELECT id, email, active, email_verified, role
FROM customers
WHERE email = 'user@example.com';

-- Activate user
UPDATE customers SET active = true WHERE email = 'user@example.com';
```

### RLS policy errors

**Error:** "new row violates row-level security policy"

**Cause:** Missing service role key, using anon key instead

**Fix:** Make sure `SUPABASE_SERVICE_ROLE_KEY` is used in `lib/admin/api.ts` functions

---

## 📞 Support

For issues or questions:
1. Check this documentation
2. Review `lib/admin/api.ts` for function signatures
3. Check Supabase Dashboard → Auth → Users for auth user status
4. Check Supabase Dashboard → Database → customers for customer records
5. Verify both tables are in sync (same UUIDs)

---

## 🔮 Future Enhancements

1. **Email Invitations** - Send invite emails when creating users
2. **Password Reset Flow** - Self-service password reset for users
3. **Email Verification** - Verify email addresses on signup
4. **Audit Log** - Track all user management actions
5. **Bulk Operations** - Create/update multiple users at once
6. **OAuth Integration** - Allow login with Google, GitHub, etc.
7. **Session Management** - View active sessions, force logout
8. **User Activity Tracking** - Track login history, last seen

---

## ✅ Summary

**What works now:**
- ✅ Create users via admin panel → They can login
- ✅ Update user credentials → Changes reflected immediately
- ✅ Deactivate users → They cannot login
- ✅ Delete users → Removed from auth system
- ✅ Existing customer signup flow unchanged
- ✅ Role-based permissions working (admin, assistant, customer)

**Key benefits:**
- 🔐 Secure password management (Supabase Auth handles hashing)
- 🔗 Proper linking between auth users and customer profiles
- 🛡️ Row Level Security policies protecting customer data
- ♻️ Automatic rollback on failures
- 📧 Email confirmation handled automatically

All user management operations are now fully integrated with Supabase Auth!
