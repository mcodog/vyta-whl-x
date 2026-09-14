# Module 5 — Customer Accounts & Auth

This module covers the **customer-facing authentication and account experience** plus the **admin-side customer-management** that creates, edits, onboards, and signs customers in. Authentication is built entirely on **Supabase Auth** (`auth.users`), with every account mirrored 1:1 into a `customers` table row (`customers.id === auth.users.id`). Customers can sign in with email + password or with an emailed passwordless **magic link**, manage their profile/shipping/orders on a dashboard, and finish onboarding via a **Set your password** page. Staff (admin/assistant) manage customers from **Admin → Customers**: create login or guest records, edit profile + credentials, soft/hard delete, toggle admin, toggle delivery options, and email a one-click sign-in link.

> Affiliate note: This app shipped an affiliate program that is **NOT being ported**. Throughout this module, the `'affiliate'` role and affiliate-specific branches are flagged as **STRIP**. The core auth, magic-link, onboarding, and customer-management infrastructure stays.

---

## Data model

The base `customers` table is **not created by any committed `.sql` file** in this repo — it predates the migrations (created directly in the Supabase dashboard). Its canonical shape is documented in `SUPABASE-AUTH-INTEGRATION.md` and the TS interface in `lib/supabase.ts`. The committed SQL files only *alter* it. Reproduce the full table from the consolidated definition below, then apply the migrations.

### `customers` (consolidated)

`customers.id` MUST equal `auth.users.id` for auth-backed accounts (the link mechanism). Guest records have a `customers` row but **no** `auth.users` row.

| Column | Type | Default | Notes / Constraints |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | PK; for real accounts set to `auth.users.id` |
| `email` | `varchar` | — | `UNIQUE NOT NULL`; always stored lowercased |
| `first_name` | `varchar` | — | nullable in practice |
| `last_name` | `varchar` | — | nullable in practice |
| `password_hash` | `text` | — | legacy/unused for new accounts (Supabase Auth hashes passwords); kept on the TS `Customer` interface |
| `phone` | `text` | — | added by `customer-auth-migration.sql` |
| `wallet_address` | `varchar` | — | crypto payout/legacy field |
| `shipping_address` | `text` | — | added by `customer-auth-migration.sql` |
| `shipping_city` | `text` | — | added by `customer-auth-migration.sql` |
| `shipping_state` | `text` | — | added by `customer-auth-migration.sql` (UI labels it "Province") |
| `shipping_postal_code` | `text` | — | added by `customer-auth-migration.sql` |
| `shipping_country` | `text` | `'US'` | added by `customer-auth-migration.sql` (dashboard defaults new edits to `'CA'`) |
| `is_admin` | `boolean` | `false` | added by `admin-migration.sql`; kept in sync with `role === 'admin'` |
| `role` | `user_role` enum | `'customer'` | see enum below |
| `affiliate_id` | `uuid` | `NULL` | **STRIP** — FK → `affiliates(id) ON DELETE SET NULL` (added by `affiliate-program-migration.sql`) |
| `active` | `boolean` | `true` | deactivated accounts cannot log in |
| `allow_pickup` | `boolean` | `true` | per-customer fulfillment option (Delivery column) |
| `allow_shipping` | `boolean` | `true` | per-customer fulfillment option |
| `last_login_at` | `timestamptz` | `NULL` | |
| `email_verified` | `boolean` | `false` | set `true` for admin-created/auto-confirmed accounts |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | API routes set this manually on update |

### `user_role` enum

Defined outside committed SQL (dashboard). `affiliate-program-migration.sql` only *adds* the affiliate value:

```sql
-- Base values (recreate these): 'customer', 'assistant', 'admin'
-- STRIP this line when porting (no affiliate program):
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'affiliate';
```

For the port, create: `CREATE TYPE user_role AS ENUM ('customer', 'assistant', 'admin');`

### Indexes (from migrations)

```sql
-- customer-auth-migration.sql
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
-- admin-migration.sql
CREATE INDEX IF NOT EXISTS idx_customers_admin ON customers(is_admin) WHERE is_admin = true;
-- affiliate-program-migration.sql  (STRIP)
CREATE INDEX IF NOT EXISTS idx_customers_affiliate_id ON customers (affiliate_id) WHERE affiliate_id IS NOT NULL;
```

### RLS policies (`supabase-auth-integration.sql`)

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Customers can read their own record
CREATE POLICY IF NOT EXISTS "Customers can view own profile"
  ON customers FOR SELECT USING (auth.uid() = id);

-- Customers can update their own record, but cannot change role or is_admin
CREATE POLICY IF NOT EXISTS "Customers can update own profile"
  ON customers FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = OLD.role AND is_admin = OLD.is_admin);

-- Service role bypass (admin operations run with the service-role key)
CREATE POLICY IF NOT EXISTS "Service role has full access"
  ON customers USING (auth.jwt()->>'role' = 'service_role');
```

> All admin/staff operations go through API routes using the **service-role key**, which bypasses RLS entirely. The RLS policies above only matter for the customer's own browser client. `supabase-auth-integration.sql` also defines a `create_user_with_auth(...)` plpgsql function that is **reference-only** — it always raises; real auth-user creation happens via the Admin API server-side.

### `orders` / `order_items` (referenced, owned by the Orders module)

The customer dashboard/order pages read `orders` (FK `customer_id → customers.id`) and `order_items` (`order_id`). Full definitions belong to the Orders module; only the read side is used here. Relevant `Order` fields used: `order_number`, `status`, `total`, `crypto`, `tracking_number`, `shipping_address` (jsonb), `created_at`. `OrderItem`: `product_name`, `quantity`, `price_at_time`.

### Migration helper file

`migrate-existing-users-to-auth.sql` contains **no executable schema** — it is a guide + an embedded Node.js script (commented out) for back-filling `auth.users` for pre-existing customers via the Admin API. Useful only when migrating a legacy dataset; not needed for a fresh port.

---

## API endpoints

### `POST /api/auth/customer` — resolve current customer from access token
File: `app/api/auth/customer/route.ts`. Uses the **service-role** client (`getSupabase()`).

- **Request:** `{ accessToken: string }` (the Supabase session access token).
- **Logic:** `auth.getUser(accessToken)` → look up `customers` by `id`; if none and `user.email` present, fall back to lookup by lowercased `email`. If found and `active === false` → `403 {error:'Account deactivated'}`.
- **Response:** `200 { customer }` (customer may be `null`). Errors: `401` (no/invalid token), `403` (deactivated), `500`.
- **Used by:** `CustomerContext.fetchCustomer()` and the admin layout's `checkAdmin()`.

### `GET /api/admin/customers` — list customers
File: `app/api/admin/customers/route.ts`. Service-role client.

- **Auth:** Bearer token → `getCaller()` resolves `{id, role}`. Rejects `role === 'customer'` (or no caller) with `403`.
- **Logic:** selects `*, bound_affiliate:affiliates!customers_affiliate_id_fkey(id, first_name, last_name, email)` ordered by `created_at desc`. **STRIP** the `bound_affiliate` join and the `if (caller.role === 'affiliate') query.eq('affiliate_id', caller.id)` scoping branch.
- **Response:** `{ customers: [...] }`.

### `POST /api/admin/customers` — create customer (login or guest)
- **Auth:** caller must be `admin` (or `affiliate` — **STRIP**); else `403`.
- **Request body:** `{ first_name, last_name, email, phone, password?, create_login?, auto_confirm?, affiliate_id? }`.
- **Logic:**
  - `createLogin = !!create_login || !!password`. `autoConfirm` defaults to `true`.
  - **Login path:** requires `email`; if `password` given it must be ≥ 6 chars. Calls `supabase.auth.admin.createUser({ email, password?, email_confirm: autoConfirm, user_metadata:{first_name,last_name} })`, then inserts a `customers` row with `id = authData.user.id`, `role:'customer'`, `active:true`, `email_verified: autoConfirm`. On profile-insert failure → rolls back by `auth.admin.deleteUser`. Returns `201 { customer }`. Duplicate email → `409`.
  - **Guest path** (no login): requires at least one of name/email; synthesizes `email = guest+<ts>@aminocan.local` when blank. Inserts profile only. `201 { customer }`.
  - **STRIP:** `affiliate_id` binding (`caller.role === 'affiliate' ? caller.id : body.affiliate_id`). Port should always insert `affiliate_id: null` or omit the column.

### `PUT /api/admin/customers/[id]` — update customer
File: `app/api/admin/customers/[id]/route.ts`. **Admin-only** (`verifyAdmin` checks `role === 'admin'`).

- **Request:** any of `{ email, first_name, last_name, phone, role, active, password }`.
- **Logic:** `hasAuthUser(id)` via `auth.admin.getUserById`. For auth-backed customers: `active` → `auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876600h' })`; `email`/`password` → `auth.admin.updateUserById`. Guest customers skip all auth steps. Always updates the `customers` row (`updated_at`, and any provided fields; `role` also sets `is_admin = role === 'admin'`). Returns `{ customer }` (re-selected with `bound_affiliate` — **STRIP** that join). Duplicate email → `409`.

### `DELETE /api/admin/customers/[id]` — hard delete
- **Admin-only.** Deletes the `customers` row first, then best-effort `auth.admin.deleteUser` (skipped for guests / missing auth users). `{ success: true }`.

### `POST /api/admin/customers/magic-link` — email a passwordless sign-in link
File: `app/api/admin/customers/magic-link/route.ts`. Service-role client.

- **Auth:** caller must not be `customer` (admin/assistant; affiliate **STRIP**).
- **Request:** `{ customer_id, redirect_path? }`.
- **Logic:** looks up the customer; rejects if not found (`404`), deactivated (`400 "This account is deactivated."`), or no real email / `@aminocan.local` (`400`). **STRIP** the affiliate-binding check (`caller.role === 'affiliate' && customer.affiliate_id !== caller.id`). `redirect_path` is whitelisted to one of `/account/dashboard`, `/admin`, `/account/set-password` (default `/account/dashboard`). Calls `sendSupabaseMagicLink(email, redirectPath)`.
- **Errors mapped:** no auth account → `400 "This customer doesn't have a login account yet."`; rate limit → `429 "Too many sign-in emails requested for this account. Please wait a minute and try again."`; else `500`.
- **Response:** `{ success: true }`.

### `POST /api/admin/users` & `PUT/DELETE /api/admin/users/[id]`
Documented in **Module 6** (these are the staff/user-management endpoints). They share the same `customers` table and Supabase Auth pattern.

### `GET /api/orders/my-orders` (referenced)
The order-history page (`/account/orders`) fetches this. Belongs to the Orders module; returns the signed-in customer's orders.

---

## Frontend

All customer auth UI lives under the `app/(customer)/` route group. Global providers are wired in `app/layout.tsx`: `CustomerProvider` wraps `RouteGuard` wraps the app.

### Session/state management — `contexts/CustomerContext.tsx`
- Exposes `{ customer, isLoading, refreshCustomer(), logout() }` via `useCustomer()`.
- `fetchCustomer()`: `supabase.auth.getSession()` → `POST /api/auth/customer { accessToken }` → returns `customer`.
- Subscribes to `supabase.auth.onAuthStateChange`: on `SIGNED_OUT` clears the customer; on `INITIAL_SESSION | SIGNED_IN | USER_UPDATED` it defers (`setTimeout(…,0)`) a `refreshCustomer()`. **Important gotcha (preserve verbatim):** never `await` Supabase calls *inside* the `onAuthStateChange` callback — it holds an internal lock and will deadlock other Supabase requests. That is why refresh is deferred.
- `logout()`: `supabase.auth.signOut()` then clears state.
- The shared browser client `lib/supabase.ts` uses default options (which include `detectSessionInUrl: true`), so magic-link hash tokens in the URL are auto-detected and trigger `SIGNED_IN`.

### `lib/customer/api.ts` (data layer, customer-side)
- `signUpCustomer({email,password,firstName,lastName,phone?,referralCode?})` — `supabase.auth.signUp` then inserts `customers` row with `id = authData.user.id`. **STRIP** the `referralCode → referral_codes → affiliate_id` first-touch binding block.
- `signInCustomer(email,password)` — password sign-in; blocks `active === false` (signs out, returns deactivated error); creates a profile from auth metadata if missing.
- `signOutCustomer()`, `getCurrentSession()`, `getCustomer(id)`, `updateCustomer(id, updates)`, `getCustomerOrders(id)`, `getOrderWithItems(orderId)`.
- `createOrder(...)` lives here too but belongs to the Orders module; its trailing **commission/referral** block is **STRIP**.

### `components/RouteGuard.tsx`
- Reads `auth.config.js` (`requireAuth`, default **false**). When `requireAuth === false` it is a pass-through (all pages public). When `true`, unauthenticated users on non-public paths are `router.replace('/login')`. `PUBLIC_PATHS = ['/login', '/affiliate/login', '/affiliate/signup']` — **STRIP** the two affiliate entries, leaving `['/login']`.
- Loading state renders a centered `Loading...`.

### Pages

| Route | File | Purpose |
|---|---|---|
| `/login` | `app/(customer)/login/page.tsx` | Email+password sign-in |
| `/signup` | `app/(customer)/signup/page.tsx` | Sign-up form — **currently disabled**: the page component calls `notFound()`, so `/signup` 404s. (The form is implemented but unreachable.) |
| `/account/set-password` | `app/(customer)/account/set-password/page.tsx` | Onboarding "Set your password" after clicking an invite link |
| `/account/dashboard` | `app/(customer)/account/dashboard/page.tsx` | Account home: orders list + profile + shipping + logout |
| `/account/orders` | `app/(customer)/account/orders/page.tsx` | Full order history (fetches `/api/orders/my-orders`) |
| `/account/orders/[id]` | `app/(customer)/account/orders/[id]/page.tsx` | Single order detail (reads via `getOrderWithItems`, enforces `order.customer_id === customer.id`) |

Login/signup/set-password wrap content in `<Suspense>` (they use `useSearchParams`) and render `<Navigation/>` + `<Footer/>`. Login uses a `redirect` query param (default `/products`); after a successful sign-in it verifies `active`, shows a `PeptideLoader` ("Signing you in..."), then `window.location.href = redirect` after 2.5s.

### Data flow summary
1. User signs in (password on `/login` or `/admin`, or via magic link landing on any allowed redirect).
2. Supabase stores the session; `onAuthStateChange` fires → `CustomerContext` calls `POST /api/auth/customer` to hydrate the `customer` profile.
3. Account pages read `useCustomer()`; if `!customer` after `isLoading`, they `router.push('/login?redirect=…')`.
4. Profile edits call `lib/customer/api.updateCustomer` (customer's own row, RLS-allowed), then `refreshCustomer()`.

---

## UI/UX specification

Design tokens (Tailwind): `ink` (near-black primary), `ink-muted`, `surface` (light gray field bg), `line` (border), `bronze` (accent), plus emerald/red/amber for status. Cards: `bg-white rounded-xl border border-line shadow-sm`. Primary button: `bg-ink hover:bg-ink/90 text-white font-semibold rounded-lg`. Inputs: `bg-surface rounded-lg border border-line focus:ring-2 focus:ring-bronze/40`. Icons from `lucide-react`. Animations via `framer-motion` (cards fade/slide in: `initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}`).

### Login page (`/login`)
- Centered card, max-w-md. Header: `Beaker` icon in an `bg-ink` rounded square; **"Welcome Back"** heading; subtext **"Sign in to your account"**.
- Error banner (when set): red box `bg-red-50 border border-red-200` with `AlertCircle` + message text.
- Fields: **Email Address** (Mail icon, placeholder `you@example.com`), **Password** (Lock icon, placeholder `Enter your password`).
- Submit button: idle shows `LogIn` icon + **"Sign In"** + `ArrowRight`; loading shows **"Signing in..."**; disabled while loading.
- Validation: empty email/password → inline error **"Please enter email and password"**. Auth errors surface Supabase's `error.message`. Deactivated → **"This account has been deactivated. Please contact support."**
- Footer note: **"Looking for affiliate login? Click here"** linking `/affiliate/login` — **STRIP** (and the commented-out "Create one" signup link).
- On success: `PeptideLoader` overlay **"Signing you in..."** then hard redirect after ~2.5s.

### Signup page (`/signup`) — implemented but disabled
- (Reachable only if you remove the `notFound()`.) Card with `Beaker` icon, **"Create Account"**, subtext **"Join us for exclusive access and order tracking"**.
- Fields: First Name (`John`), Last Name (`Doe`), Email Address (`you@example.com`), Password (`Min. 6 characters`), Confirm Password (`Confirm your password`). Confirm-password input border turns emerald when matching, red when not, with a `Check` icon when matched.
- Validation messages: **"Please enter your full name"**, **"Please enter a valid email address"**, **"Password must be at least 6 characters"**, **"Passwords do not match"**.
- Submit: `UserPlus` + **"Create Account"** + `ArrowRight`; loading **"Creating account..."**.
- Success state replaces the form: emerald `Check` icon, **"Check Your Email"**, copy: *"We sent a confirmation link to {email}. Click the link to verify your account."*, link **"Go to Login"**.
- Footer links **"Already have an account? Sign in"** and **"Want to become an affiliate? Apply here"** — **STRIP** the affiliate line.

### Set password page (`/account/set-password`)
- Four mutually-exclusive states inside the card:
  1. **Loading** (`isLoading`): centered **"Verifying your link…"**.
  2. **No customer** (link invalid/expired): `AlertCircle`, heading **"Link invalid or expired"**, copy *"This set-up link is no longer valid. Ask an administrator to send you a new sign-in link, or sign in if you already have a password."*, button **"Go to sign in"** → `/login`.
  3. **Done**: emerald `Check`, **"Password set"**, **"Taking you to your account…"** (redirect after 1.5s).
  4. **Form**: `KeyRound` icon, **"Set your password"**, greeting *"Welcome{, FirstName}! Choose a password to finish setting up your account."* Fields: **New password** (placeholder `Choose a password`, `autoComplete="new-password"`) with helper *"8+ characters with an uppercase letter, a lowercase letter, a number, and a symbol."*; **Confirm password** (`Re-enter password`). Button: **"Set password & continue"** + `ArrowRight`; saving → **"Saving…"**.
- Validation uses `validatePassword()` from `lib/password.ts`; on failure error reads **"Password requirements: " + errors.join(', ') + "."**; mismatch → **"Passwords do not match."**
- On submit: `supabase.auth.updateUser({ password })`, then `refreshCustomer()`, then redirect to `destination`. `destination = customer.role === 'affiliate' ? '/admin' : '/account/dashboard'` — **STRIP** the affiliate branch (always `/account/dashboard`).
- Footer micro-copy: `Beaker` + **"Research Only · Shipping to Canada"**.

### Account dashboard (`/account/dashboard`)
- Top eyebrow **"MY ACCOUNT"**, heading **"Welcome back, {first_name}!"**, subtext **"Manage your orders and account settings"**.
- If `role` is `admin` or `assistant`: a **"Go to Admin Dashboard"** button (`LayoutDashboard` icon) → `/admin`.
- Two-column (lg) layout:
  - **Your Orders** card (`Package` icon header). Loading: **"Loading orders..."**. Empty: `Beaker` icon, **"You haven't placed any orders yet"**, link **"Browse Products"** → `/products`. Each row: `Order #{order_number}`, formatted date, a colored status badge (icons/colors per status: pending=amber clock, paid=blue check, processing=purple package, shipped=indigo truck, delivered=emerald check, cancelled=red x), total `$X.XX`, chevron link to `/account/orders/{id}`. Mobile hides the inline badge and shows it below.
  - **Account Info** card (`User` icon): shows name, email, phone; **"Edit Profile"** toggles inline edit (First/Last name + phone), with **Save**/**Cancel** (Save button is a cyan→blue gradient). **Shipping Address** card (`MapPin`): street, city/province/postal, country; empty → **"No address saved"**; edit mode adds street/city/province/postal/country inputs (placeholders: `Street Address`, `City`, `Province`, `Postal Code`, `Country`). Default country in edit form is `'CA'`.
  - **Sign Out** button (`LogOut`) — on click shows `PeptideLoader` **"Signing you out..."**, then logs out and routes to `/`.

### Order history (`/account/orders`)
- Back arrow to `/account/dashboard`; heading **"Order History"**, subtext **"View all your past orders"**.
- Spinner (`Loader2`) while loading. Empty: `Package` icon, **"No orders yet"**, *"Your order history will appear here after your first purchase."*, **"Browse Products"** button.
- Each order card links to `/order/track?order={order_number}`: shows order number, date, a rounded status pill (statuses incl. received/confirmed/expired), crypto in uppercase, optional `| Tracking: {n}`, and total `$X.XX CAD`.

### Order detail (`/account/orders/[id]`)
- Loading **"Loading..."**. Not-found / not-yours: `Beaker` icon, **"Order Not Found"**, *"This order doesn't exist or you don't have access to it."*, **"Back to Dashboard"**. (Ownership enforced: redirect to dashboard if `order.customer_id !== customer.id`.)
- Header card: eyebrow **"ORDER DETAILS"**, `#{order_number}`, *"Placed on {date, time}"*, status badge via `statusConfig` (labels: Pending / Payment Received / Confirmed / Processing / Shipped / Delivered / Cancelled). Optional **Tracking Number** row (mono).
- **Order Items** list (Beaker thumbnail, name, optional strength, `Qty: n`, line total + per-unit). **Order Summary** card: Subtotal, **Shipping: Free** (emerald), **Total**. **Shipping Address** card if present (`whitespace-pre-line`).

### Admin → Customers page (`/admin/customers`)
- Toolbar: search input (**"Search customers..."**), an affiliate filter select (`All customers` / `Affiliate customers` / `Direct (no affiliate)`) — **STRIP** entirely, a status select (`Any status` / `Active` / `Inactive`), and (admin/affiliate) a **"New Customer"** button (`UserPlus`).
- Table card titled **"Customers"** (affiliate view title is "Your Customers" — STRIP), with "{n} shown". Columns: **Customer** (name + email), **Phone**, **Affiliate** (STRIP — shows bound affiliate as emerald badge), **Joined**, **Role** (badge), **Delivery**, **Actions**.
  - **Delivery** cell: when editable, two toggle buttons — **Ship** (`Truck`) and **Pickup** (`Store`) — green when enabled, gray when off; clicking toggles via `updateCustomerFulfillment`. Read-only roles see static badges.
  - **Actions** cell: **Login Link** button (`KeyRound`, blue) for admin/assistant/affiliate — shows **"Sending..."** then **"Sent"** with a `Check` (green) for 3s; on failure `alert()`s the error. **Edit** (`Pencil`), **Make Admin / Remove Admin** (`Shield`/`ShieldOff`, toggles `is_admin`), **Delete** (`Trash2`, red) — these three gated by `canEdit`/`canDelete` (admin only). If a role can neither edit nor send links: **"View only"**.
- Empty state: **"No customers yet"** or **"No customers match your filters"**.

### New Customer modal (`CreateCustomerModal.tsx`)
- Header `UserPlus` + **"New Customer"**. Fields: First name / Last name (grid), Email, Phone (optional). Checkbox **"Create a login & email a set-up link"** (default **on**).
  - With login: helper *"The customer gets an email with a sign-in link. Clicking it signs them in and prompts them to choose their own password."* Validation: email required → **"Email is required to create a login."**
  - Without login: helper *"Without a login, this creates a record you can invoice — they can claim the account later by signing up with the same email."*
- Submit button: **"Create"**; while saving with login **"Creating & sending…"** (spinner). On success the modal swaps to a result view:
  - Sent OK: emerald `Check` **"Customer created"**, then `Mail` box *"A set-up link was emailed to {email}. They'll click it to sign in and choose their own password."*, **"Done"** button.
  - Send failed (account still created): amber box *"Customer created, but the set-up link couldn't be emailed: {error}. You can resend it from the Customers list (the Login Link button)."*
- Flow: `POST /api/admin/customers { create_login:true }` (passwordless), then `POST /api/admin/customers/magic-link { customer_id, redirect_path:'/account/set-password' }`.

### Edit Customer modal (`EditCustomerModal.tsx`)
- Header **"Edit Customer"**. Fields: First/Last name, Email, Phone, **Role** select (Customer/Assistant/Admin), **New Password** (with show/hide eye, **Copy** button, **"Generate new password"** link calling `generatePassword(16)`) with note *"Only applies to customers with a login account."*, **Active (can log in)** checkbox.
- Validation: requires at least one of name/email → **"Enter a name or email for the customer."**; if a password is typed it must pass `validatePassword`. Save → `updateCustomer` → `PUT /api/admin/customers/[id]`. Button: **"Save Changes"** / **"Saving..."**.

### Delete Customer dialog (`DeleteCustomerDialog.tsx`)
- Header **"Remove Customer"**, target name + email. Two options:
  - **Deactivate** (amber `PowerOff`): *"Customer cannot log in, but all data (orders, invoices) is preserved. Can be reactivated later."* → soft delete (`PUT {active:false}`).
  - **Delete Permanently** (red `Trash2`): *"Permanently removes the customer and their login. This cannot be undone."* → `DELETE`.
- Plus a **Cancel** button. Buttons show **"Processing..."** while running.

### Toasts/feedback
- The Customers page uses native `alert()` for magic-link errors and inline button state changes ("Sending…/Sent"); there is **no toast library**. Modals show inline error strings.

### Responsive
- All cards are single-column on mobile and grid on `lg`. Tables are wrapped in `overflow-x-auto` with `min-w` set (customers `min-w-[860px]`). Forms use `grid-cols-1 sm:grid-cols-2`. Dashboard order rows hide the status badge inline on mobile and show it on a second line.

---

## Permissions reference

(Full role matrix is in **Module 6**.) Relevant to this module:

| Capability | customer | assistant | admin | affiliate (STRIP) |
|---|---|---|---|---|
| Sign in / manage own profile | ✅ | ✅ | ✅ | ✅ |
| Access `/account/dashboard` | ✅ | ✅ | ✅ | ✅ |
| See "Go to Admin Dashboard" link | ❌ | ✅ | ✅ | n/a |
| View Admin → Customers list | ❌ | ✅ (all) | ✅ (all) | ✅ (own only) |
| Send customer magic link | ❌ | ✅ | ✅ | ✅ (own) |
| Create customer (login/guest) | ❌ | ❌ | ✅ | ✅ |
| Edit / make-admin / delete customer | ❌ | ❌ | ✅ | ❌ |
| Toggle delivery (ship/pickup) | ❌ | ❌ | ✅ | ❌ |

Notes: `canEdit`/`canDelete`/`canCreate` (`lib/permissions.ts`) are **admin-only**. `getRoleBadgeClasses`/`getRoleName` render role badges.

---

## Dependencies

- **npm:** `@supabase/supabase-js` ^2.83.0, `next` ^15.5.4, `react` ^19.2.0, `framer-motion` ^12.23.24, `lucide-react` ^0.546.0. (`resend` ^6.9.2 is used for *other* emails, not sign-in links.)
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only; required for all admin auth ops), `NEXT_PUBLIC_BASE_URL` (builds magic-link `emailRedirectTo`, defaults to `https://aminocan.com`).
- **Internal modules:** `lib/supabase.ts` (`supabase` browser client + `getSupabase()` service client + `Customer`/`Order` types), `lib/password.ts` (generate/validate/copy), `lib/admin/magic-link.ts`, `lib/admin/api.ts` (customer CRUD wrappers), `contexts/CustomerContext.tsx`, shared `components/Navigation`, `components/Footer`, `components/PeptideLoader`, `components/RouteGuard`. The Orders module (`orders`/`order_items`, `/api/orders/my-orders`).
- **Supabase dashboard config (magic links):** custom SMTP, the "Magic Link" email template with `{{ .ConfirmationURL }}`, and a redirect allowlist including `/account/set-password`, `/account/dashboard`, `/admin` (prod + localhost). See `MAGIC-LINK-SETUP.md`.

### Magic-link mechanism (`lib/admin/magic-link.ts`)
`sendSupabaseMagicLink(email, redirectPath)` builds a dedicated anon Supabase client with `flowType:'implicit'` (NOT PKCE — links are generated on the customer's behalf by staff, so there's no `code_verifier` in the recipient's browser), `persistSession:false`, `detectSessionInUrl:false`. Calls `auth.signInWithOtp({ email, options:{ emailRedirectTo: BASE_URL+redirectPath, shouldCreateUser:false } })`. Supabase itself sends the email. Rejects `@aminocan.local` (guest) addresses. The recipient's browser (shared client, `detectSessionInUrl:true`) picks up the hash tokens on landing.

---

## Porting notes

**What to STRIP (affiliate):**
1. `user_role` enum: create without `'affiliate'`; drop the `ALTER TYPE ... ADD VALUE 'affiliate'` line.
2. `customers.affiliate_id` column + its index + the `bound_affiliate` joins in `/api/admin/customers` GET/PUT.
3. `getCaller()` / authorization branches that grant or scope by `'affiliate'` in `/api/admin/customers/*` (the list scoping, the create binding, the magic-link binding check). Keep admin/assistant logic.
4. `RouteGuard` `PUBLIC_PATHS` → drop `/affiliate/login`, `/affiliate/signup`.
5. `set-password` `destination` → always `/account/dashboard` (drop the `role==='affiliate' ? '/admin'` branch).
6. Login footer "affiliate login" link; signup footer "become an affiliate" link.
7. `signUpCustomer`'s referral-code → affiliate binding block; `createOrder`'s commission block.
8. The magic-link redirect whitelist may keep `/admin` (still valid for staff) but it's only reached by affiliates in the original — safe to leave or trim.

**Gotchas:**
- The base `customers` table and `user_role` enum are **not** in any committed SQL — recreate them from the consolidated definition above before running the alter-migrations.
- `customers.id` must equal `auth.users.id`. Always create the auth user first, then insert the profile with that id, and roll back the auth user if the insert fails (mirrors `POST /api/admin/users` and `POST /api/admin/customers`).
- Never `await` Supabase calls inside `onAuthStateChange` (deadlock) — keep the `setTimeout(…,0)` deferral.
- Deactivation uses Supabase Auth ban (`ban_duration: '876600h'` ≈ 100 years) **and** `active:false`; login flows also re-check `active` client-side and sign the user back out if deactivated.
- `/signup` is intentionally disabled via `notFound()`; account creation is admin-driven (invite + set-password). Decide whether the porting target wants self-signup re-enabled.
- `auth.config.js` `requireAuth` defaults to `false` (whole store is public). Account pages self-guard by redirecting to `/login` when there's no customer.
- Guest customers (no auth user, `@aminocan.local` email) must be handled everywhere auth operations run (`hasAuthUser` checks; magic-link refuses them).

**Suggested order of implementation:**
1. SQL: create `user_role` enum + `customers` table, then apply `customer-auth-migration.sql`, `admin-migration.sql`, RLS from `supabase-auth-integration.sql`.
2. `lib/supabase.ts` (clients + types), `lib/password.ts`, `lib/admin/magic-link.ts`.
3. `contexts/CustomerContext.tsx` + `components/RouteGuard.tsx` + `auth.config.js`.
4. `POST /api/auth/customer`.
5. Customer pages: `/login`, `/account/set-password`, `/account/dashboard`, `/account/orders`, `/account/orders/[id]`.
6. Admin customer mgmt: `/api/admin/customers` (+ `[id]`, `magic-link`), `lib/admin/api.ts` customer fns, `/admin/customers` page + 3 modals.
7. Configure Supabase SMTP + redirect allowlist; smoke-test create→invite→set-password and the Login Link button.
