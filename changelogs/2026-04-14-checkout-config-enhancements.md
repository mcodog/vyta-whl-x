# Checkout Configuration Enhancements

**Date:** April 14, 2026
**Type:** Feature
**Status:** Completed ✅

---

## Overview

Three admin-configurable features added to the checkout flow:

1. **Configurable pickup address** — set the local pickup address from admin settings; shown dynamically on checkout
2. **Per-customer fulfillment options** — toggle shipping and/or pickup availability per customer from the customers page
3. **Guest checkout toggle** — disable guest checkout site-wide, prompting unauthenticated users to log in

---

## What Was Changed

### 1. Database Migration
**File:** `migration-checkout-config.sql` *(new)*

```sql
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS pickup_address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_checkout_enabled BOOLEAN DEFAULT true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allow_pickup BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_shipping BOOLEAN DEFAULT true;
```

---

### 2. Settings API
**File:** `app/api/admin/settings/route.ts`

- **GET** now returns `pickup_address` and `guest_checkout_enabled` alongside existing fields
- **PUT** accepts and validates `pickup_address` (string) and `guest_checkout_enabled` (boolean)

---

### 3. Admin Settings Page
**File:** `app/(admin)/admin/settings/page.tsx`

Two new sections added below the existing Checkout Type and Admin Emails sections:

- **Pickup Address** — text input with a Save button. The saved address is displayed on checkout when a customer selects Local Pickup.
- **Guest Checkout** — Enabled / Disabled toggle. When disabled, unauthenticated users attempting to checkout see a login-required card instead of the checkout form.

Both sections are read-only for `assistant` role users, consistent with existing behaviour.

---

### 4. Per-Customer Fulfillment Options
**File:** `lib/admin/api.ts`

New function added:

```ts
updateCustomerFulfillment(customerId, allowPickup, allowShipping)
```

Follows the same pattern as the existing `toggleCustomerAdmin`.

---

### 5. Admin Customers Page
**File:** `app/(admin)/admin/customers/page.tsx`

- New **Delivery** column in the customers table with two toggle badges per row: **Ship** and **Pickup**
- Green badge = option enabled, grey = disabled; click to toggle
- Disabled (view-only) for `assistant` role

---

### 6. Checkout Page
**File:** `app/checkout/page.tsx`

- Removed hardcoded `PICKUP_ADDRESS` constant; pickup address now comes from `/api/admin/settings`
- `CheckoutContent` fetches `pickup_address` and `guest_checkout_enabled` on mount and passes them as props to the active checkout component
- **Guest gate** — both `EmailCheckoutContent` and `CryptoCheckoutContent` show an "Account Required" card (with a sign-in link) if guest checkout is disabled and the user is not logged in
- **Per-customer fulfillment** in `EmailCheckoutContent`:
  - Both options available → shows the normal Ship / Pickup toggle
  - Only one option available → hides the toggle, shows a read-only label, and auto-selects the allowed type
  - Neither available → shows an error message
  - Guest (no account) → always sees both options

---

### 7. Customer Type Definition
**File:** `lib/supabase.ts`

Added `allow_pickup: boolean` and `allow_shipping: boolean` to the `Customer` interface. The `CustomerContext` uses `select('*')` so these fields are included automatically after the migration runs.

---

## Files Modified / Created

| File | Change |
|---|---|
| `migration-checkout-config.sql` | New — DB migration for new columns |
| `app/api/admin/settings/route.ts` | Added `pickup_address` and `guest_checkout_enabled` to GET/PUT |
| `app/(admin)/admin/settings/page.tsx` | Added Pickup Address and Guest Checkout sections |
| `lib/admin/api.ts` | Added `updateCustomerFulfillment()` |
| `app/(admin)/admin/customers/page.tsx` | Added per-customer Ship/Pickup delivery column |
| `app/checkout/page.tsx` | Dynamic address, guest gate, per-customer fulfillment options |
| `lib/supabase.ts` | Added `allow_pickup` and `allow_shipping` to `Customer` interface |
