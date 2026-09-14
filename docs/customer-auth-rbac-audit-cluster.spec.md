# Customer Auth, Staff/Customer Management, RBAC & Audit — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from the components/files listed in §3. Stack: **Next.js 15 App Router**
> (`app/` route groups, RSC + `"use client"`) + **Supabase** (`@supabase/supabase-js` v2),
> **Tailwind CSS** (custom theme), **framer-motion**, **lucide-react**.
>
> This document describes the code **as it exists today** (it keeps the `affiliate`
> and `warehouse` roles and the guest-customer paths). The companion port guides
> `docs/module-ports/05-customer-accounts-and-auth.md` and `…/06-users-roles-permissions.md`
> are the column-level / UI-string "atlas" and additionally flag what to **STRIP**
> when porting without the affiliate program — that stripping is *out of scope here*.

---

## 0. The single most important finding (read first)

**The `customers` table and the `user_role` enum are NOT in any committed `.sql` file.**
They were created by hand in the Supabase dashboard and predate the migrations. The
committed SQL files only *alter* `customers`. To recreate the database you must:

1. Create the `user_role` enum **first** (see §2).
2. Create the `customers` table from the consolidated definition in §2 (this is the
   exact dashboard DDL the project runs against — reproduced verbatim).
3. Create the dashboard-only trigger `sync_is_admin_on_role_change` →
   `sync_is_admin_with_role()` (also not in committed SQL — see §2).
4. Then apply the four committed migrations in order: `customer-auth-migration.sql`,
   `admin-migration.sql`, `supabase-auth-integration.sql` (RLS), `audit-log-migration.sql`.

**The access-pattern that drives the whole design:** the **browser** uses the anon
client (`lib/supabase.ts` → `supabase`), which is **RLS-bound** — a customer can only
read/update their own row. Every **server** route uses `getSupabase()` (or a
`createClient(url, SERVICE_ROLE_KEY)`), which is the **service-role client and bypasses
RLS entirely**. Because the service-role key ignores RLS, **every admin API route must
re-check the caller's role itself** (`verifyAdmin` / `getCaller`). UI gating is
defense-in-depth, never the security boundary.

---

## 1. Overview

One Postgres table — `public.customers` — holds **every human** in the system
(storefront customers, guests, and staff), mirrored 1:1 to `auth.users`
(`customers.id === auth.users.id`) for every auth-backed account. The cluster spans:

- **Customer auth & account experience** — password login (`/login`), passwordless
  magic-link sign-in, password reset (`/forgot-password`), onboarding
  (`/account/set-password`), and an account dashboard (`/account/dashboard`).
  (`/signup` is implemented but disabled via `notFound()`.)
- **Session hydration** — `CustomerContext` resolves the current `Customer` from the
  Supabase session via `POST /api/auth/customer`; `RouteGuard` optionally gates the
  whole app.
- **RBAC** — `lib/permissions.ts` pure helpers + the admin layout
  (`app/(admin)/admin/layout.tsx`) that gates the admin area, provides the role through
  `UserRoleContext`, and filters the sidebar. Re-enforced server-side on every route.
- **Staff/customer management** — Admin → **Customers** (`/admin/customers`) and Admin →
  **Users** (`/admin/users`): the same table viewed two ways, with create/edit/delete
  modals, soft/hard delete, role & admin toggles, delivery toggles, and a one-click
  magic-link button.
- **Audit** — an append-only `audit_log` written server-side by `logAuditServer()`
  (errors swallowed). No viewer UI; read access is RLS-gated to admin/assistant.

How the pieces connect: `app/layout.tsx` wires `CustomerProvider` → `RouteGuard` →
app. Account pages read `useCustomer()`. The admin area is a nested layout that runs its
own `checkAdmin()` gate and exposes `useUserRole()`. Browser data writes for a customer's
own row go straight through the anon client (RLS-allowed); all staff mutations proxy
through `/api/admin/*` routes that use the service-role key.

---

## 2. Database schema

### `user_role` enum — **dashboard-only, not in committed SQL**

```sql
-- Recreate from scratch (the live enum, in declaration order):
CREATE TYPE public.user_role AS ENUM ('customer', 'affiliate', 'assistant', 'admin', 'warehouse');
```

The TS mirror (`lib/supabase.ts` & `lib/permissions.ts`) is
`'customer' | 'affiliate' | 'assistant' | 'admin' | 'warehouse'`.
(`affiliate-program-migration.sql` is what originally `ALTER TYPE … ADD VALUE 'affiliate'`;
`warehouse` was likewise added in the dashboard.)

### `public.customers` — **dashboard-only base DDL (verbatim, the source of truth)**

```sql
create table public.customers (
  id uuid not null default extensions.uuid_generate_v4 (),
  email character varying not null,
  wallet_address character varying null,
  first_name character varying null,
  last_name character varying null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  password_hash text null,
  phone text null,
  shipping_address text null,
  shipping_city text null,
  shipping_state text null,
  shipping_postal_code text null,
  shipping_country text null default 'US'::text,
  is_admin boolean null default false,
  role public.user_role not null default 'customer'::user_role,
  active boolean not null default true,
  last_login_at timestamp with time zone null,
  email_verified boolean not null default false,
  has_completed_first_order boolean not null default false,
  website_accessed text null,
  allow_pickup boolean null default true,
  allow_shipping boolean null default true,
  affiliate_id uuid null,
  can_send_fulfillment_emails boolean not null default false,
  constraint customers_pkey primary key (id),
  constraint customers_email_key unique (email),
  constraint customers_affiliate_id_fkey foreign KEY (affiliate_id) references affiliates (id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_customers_email on public.customers using btree (email) TABLESPACE pg_default;
create index IF not exists idx_customers_admin on public.customers using btree (is_admin) TABLESPACE pg_default where (is_admin = true);
create index IF not exists idx_customers_role on public.customers using btree (role) TABLESPACE pg_default
  where (role = any (array['admin'::user_role, 'assistant'::user_role]));
create index IF not exists idx_customers_active on public.customers using btree (active) TABLESPACE pg_default;
create index IF not exists idx_customers_email_verified on public.customers using btree (email_verified) TABLESPACE pg_default;
create index IF not exists idx_customers_affiliate_id on public.customers using btree (affiliate_id) TABLESPACE pg_default
  where (affiliate_id is not null);

-- Dashboard-only trigger (function body also dashboard-only):
create trigger sync_is_admin_on_role_change BEFORE INSERT or update on customers
  for EACH row execute FUNCTION sync_is_admin_with_role ();
```

> **`sync_is_admin_with_role()` trigger:** fires `BEFORE INSERT OR UPDATE` and keeps
> `is_admin` aligned with `role` at the DB layer. Its body is not in committed SQL;
> behaviourally it sets `is_admin = (role = 'admin')`. The application *also* sets
> `is_admin` explicitly on every role write (belt-and-suspenders) — see §5.

**Note on `password_hash`:** present on the table and the TS `Customer` interface but
**legacy/unused** for auth — Supabase Auth stores the real password hash in `auth.users`.

### Committed migration files (apply after the dashboard objects exist)

| File | Adds |
|---|---|
| `customer-auth-migration.sql` | `ALTER TABLE customers ADD COLUMN IF NOT EXISTS` for `password_hash text`, `phone text`, `shipping_address/city/state/postal_code text`, `shipping_country text DEFAULT 'US'`; `CREATE INDEX idx_customers_email`. |
| `admin-migration.sql` | `ADD COLUMN is_admin boolean DEFAULT false`; `CREATE INDEX idx_customers_admin … WHERE is_admin = true`. Bootstrap comment: `UPDATE customers SET is_admin = true WHERE email = '…';` |
| `supabase-auth-integration.sql` | **RLS** on `customers` (3 policies, below) + a `create_user_with_auth(...)` plpgsql function that is **reference-only — it always `RAISE EXCEPTION`** (real auth-user creation happens server-side via the Admin API) + verification SELECTs. |
| `audit-log-migration.sql` | Creates `audit_log` table + 2 indexes + RLS read policy. |

### RLS policies on `customers` (`supabase-auth-integration.sql`)

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Customers can view own profile"
  ON customers FOR SELECT USING (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Customers can update own profile"
  ON customers FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = OLD.role AND is_admin = OLD.is_admin);
CREATE POLICY IF NOT EXISTS "Service role has full access"
  ON customers USING (auth.jwt()->>'role' = 'service_role');
```

So a customer's browser client may read/update only its own row and **cannot** change
its own `role`/`is_admin`. Service-role (server) bypasses all of this.

### `audit_log` (`audit-log-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `actor_id` | `uuid` | — | FK → `customers(id) ON DELETE SET NULL` |
| `action` | `text` | — | `NOT NULL` (e.g. `invoice.create`) |
| `entity_type` | `text` | — | `NOT NULL` |
| `entity_id` | `uuid` | — | nullable |
| `payload` | `jsonb` | — | nullable |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

```sql
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_actor  ON audit_log (actor_id, created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_admin_read ON audit_log FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant')));
-- No client INSERT policy: writes happen only via the service-role key.
```

### Schema usage (table/column → component)

| Table.column | Read/written by |
|---|---|
| `customers.*` | `POST /api/auth/customer` (read), `lib/customer/api.ts` (own row read/write via anon RLS), all `/api/admin/customers*` + `/api/admin/users*` routes (service role read/write), `getUsers`/`getCustomers` (read). |
| `customers.role` + `customers.is_admin` | Written together on every role change (API routes set `is_admin = role==='admin'`; DB trigger also syncs). `toggleCustomerAdmin` flips **only** `is_admin`. RBAC reads `role`. |
| `customers.active` | Login flows re-check it; deactivation sets `active=false` **and** bans the auth user. |
| `customers.allow_pickup` / `allow_shipping` | `updateCustomerFulfillment` (Customers page Delivery toggles). |
| `customers.can_send_fulfillment_emails` | Only writable via `PUT /api/admin/users/[id]` (not surfaced in the modals here). |
| `customers.affiliate_id` | `signUpCustomer` first-touch binding; `/api/admin/customers` GET/POST/PUT (`bound_affiliate` join + auto-bind). |
| `orders` / `order_items` | Dashboard & order pages read via `lib/customer/api.ts` (owned by Orders module). |
| `audit_log` | `logAuditServer()` insert only (called from invoices/pricelists modules; **not** from the user/customer routes here). |

---

## 3. Components

### Foundations (Tier A)

#### `lib/supabase.ts` — clients + DB types
- **Type:** module (no `"use client"`; importable from both).
- `export const supabase = createClient(url, anonKey)` — the shared **browser** client.
  Uses default options, so **`detectSessionInUrl: true`** — magic-link/reset hash tokens
  in the URL are auto-detected and fire `SIGNED_IN`.
- `export function getSupabase()` — **service-role** client:
  `createClient(url, SUPABASE_SERVICE_ROLE_KEY || anonKey, { auth: { autoRefreshToken:false, persistSession:false } })`. Bypasses RLS.
- Exports the `Customer`, `Order`, `UserRole` (`"customer" | "affiliate" | "assistant" | "admin" | "warehouse"`) types and many others.
- URL defaults to `https://wlnygrgwgfhlvhcvhseb.supabase.co` if env unset.

#### `lib/password.ts`
- `generatePassword(length = 16)` — crypto-shuffled; guarantees ≥1 uppercase, lowercase,
  digit, special from `!@#$%^&*-_=+`.
- `validatePassword(pw)` → `{ valid, errors[] }` with messages: `"At least 8 characters"`,
  `"At least one uppercase letter"`, `"At least one lowercase letter"`, `"At least one number"`,
  `"At least one special character (!@#$%^&*-_=+)"`.
- `copyToClipboard(text)` → `boolean`.

#### `lib/permissions.ts` — RBAC pure functions
- `type UserRole = 'customer' | 'affiliate' | 'assistant' | 'admin' | 'warehouse'`.
- `canAccessAdmin(role)` → true for `admin | assistant | affiliate` (warehouse NOT admitted).
- `canAccessWarehouse(role)` → `warehouse | admin`; `isWarehouse`, `isAffiliate`.
- `AFFILIATE_PAGES` = `['/admin','/admin/orders','/admin/invoices','/admin/customers','/admin/pricing','/admin/products']`.
- `canAccessAdminPage(role, href)` → admin/assistant → all; affiliate → exact match or sub-route of an `AFFILIATE_PAGES` entry; else false.
- `canEdit/canCreate/canDelete(role)` → **`role === 'admin'` only**.
- `canViewInvoices` → `admin | assistant | affiliate`; `canEditInvoice` → `admin | affiliate`.
- `getRoleName(role)` → `Customer | Affiliate | Assistant | Administrator | Warehouse`.
- `getRoleBadgeClasses(role)` → see §4 design tokens.

#### `lib/admin/audit.ts`
- `logAuditServer(supabase, { actor_id, action, entity_type, entity_id, payload? })` →
  inserts into `audit_log`. **Wrapped in try/catch; all errors `console.error`'d and
  swallowed** — never fails the originating mutation. Always called server-side with a
  service-role client. (Not invoked by the user/customer routes in this cluster.)

#### `lib/admin/magic-link.ts`
- `sendSupabaseMagicLink(email, redirectPath = '/account/dashboard')` → `{success, error?}`.
- Builds a **dedicated** anon client with `flowType: 'implicit'`, `persistSession:false`,
  `autoRefreshToken:false`, `detectSessionInUrl:false`. **Why implicit, not PKCE:** the
  link is generated on the customer's behalf by staff, so there's no `code_verifier` in
  the recipient's browser; implicit flow returns the session tokens in the URL hash so
  the link works for whoever clicks it.
- Calls `auth.signInWithOtp({ email, options: { emailRedirectTo: `${BASE_URL}${redirectPath}`, shouldCreateUser: false } })`. **Supabase itself sends the email** (no Resend). `BASE_URL` = `NEXT_PUBLIC_BASE_URL || 'https://aminocan.com'`.
- **Rejects guest addresses:** if email is empty or ends with `@aminocan.local`, returns `{success:false, error:'No real email address on file'}` without calling Supabase.

### Session & gating (Tier B)

#### `contexts/CustomerContext.tsx` — **Client**
- Exposes `{ customer, isLoading, refreshCustomer(), logout() }` via `useCustomer()`.
- `fetchCustomer()`: `supabase.auth.getSession()` → if `access_token`, `POST /api/auth/customer { accessToken }` → returns `customer` (or `null`).
- `useEffect` subscribes to `supabase.auth.onAuthStateChange((event) => …)`:
  - `SIGNED_OUT` → clear customer, `isLoading=false`.
  - `INITIAL_SESSION | SIGNED_IN | USER_UPDATED | PASSWORD_RECOVERY` → `setTimeout(() => void refreshCustomer(), 0)`.
  - **Intricacy (preserve verbatim):** never `await` Supabase calls inside the
    `onAuthStateChange` callback — it holds an internal lock and other Supabase requests
    deadlock. The `setTimeout(…, 0)` deferral is mandatory.
- `logout()` → `supabase.auth.signOut()` then clear state.

#### `components/RouteGuard.tsx` — **Client**
- Reads `auth.config.js`. `PUBLIC_PATHS = ['/login', '/affiliate/login', '/affiliate/signup']`.
- When `requireAuth === false` (the default) → **pure pass-through** (`<>{children}</>`).
- When `true` → after `isLoading`, if no `customer` and path not public, `router.replace('/login')`. Loading renders centered `Loading...` (`text-ink` on `bg-white`).

#### `auth.config.js`
- `export default { requireAuth: false }`. The store is fully public by default; account
  pages self-guard by redirecting to `/login` when there is no customer.

#### `lib/hooks/usePermissions.ts` — **Client**
- `usePermissions()` → `{ userRole: useUserRole(), canEdit, canCreate, canDelete }` (each
  the boolean result of the `lib/permissions` fn applied to the current role).

#### `app/(admin)/admin/layout.tsx` — **Client** (the central admin gate)
- Exports `UserRoleContext` (default `'customer'`) + `useUserRole()`.
- `checkAdmin()` (on mount): `supabase.auth.getSession()` → no session ⇒ `authState='not_logged_in'`
  (renders inline login form); else `POST /api/auth/customer { accessToken }` →
  `role = customer?.role || 'customer'`; if `canAccessAdmin(role)` ⇒ `authState='admin'`,
  `userRole=role`; else `authState='not_admin'`. Non-OK response ⇒ `authState='error'`.
  (Contains `console.log` debug lines.)
- Inline login form (`handleLogin`): `supabase.auth.signInWithPassword`; empty fields ⇒
  `'Enter your email and password'`; on success re-runs `checkAdmin()`.
- A `useEffect` bounces off disallowed pages: `if (authState==='admin' && !canAccessAdminPage(userRole, pathname)) router.replace('/admin')`.
- `navItems` (full list, filtered by `canAccessAdminPage`): Dashboard, Analytics, Orders,
  Invoices, Backorders, Purchase Orders, Products, Stock Requests, Affiliates, Sales People,
  Commissions, Customers, Users, Warehouse, Pricing, Settings.
- Badge counts (admin/assistant only): backorders (`GET /api/admin/backorders/count`) → red;
  low-stock (`getLowStockProducts`) → amber; cap display at `99+`.
- Header role eyebrow: `admin → 'Admin'`, `affiliate → 'Client'`, else `getRoleName(role)`.
  Assistant shows a `Read Only` pill + a read-only banner. Provides `userRole` to children
  via `UserRoleContext.Provider`.

### Auth API (Tier C)

#### `POST /api/auth/customer` — `app/api/auth/customer/route.ts`
- Service-role client (`getSupabase()`). Body `{ accessToken }`.
- `auth.getUser(accessToken)` → 401 if missing token (`'No access token'`) or invalid (`'Invalid token'`).
- Look up `customers` by `id`; if none and `user.email` present, fall back to lookup by
  lowercased `email`.
- If found and `active === false` → `403 { error:'Account deactivated' }`.
- Else `200 { customer }` (may be `null`). `catch` → `500 { error:'Server error' }`.
- Used by `CustomerContext.fetchCustomer()` and the admin layout's `checkAdmin()`.

### Customer pages + data layer (Tier D)

#### `lib/customer/api.ts` (browser, anon RLS-bound)
- `signUpCustomer({email,password,firstName,lastName,phone?,referralCode?})` — `supabase.auth.signUp`
  (metadata `first_name/last_name`); resolves `referralCode → referral_codes.affiliate_id`
  (guards self-referral); inserts a `customers` row with `id = authData.user.id`,
  lowercased email, `affiliate_id`. Profile-insert failure is logged but still returns
  `{success:true}` (profile can be created on first login).
- `signInCustomer(email,password)` — `signInWithPassword`; loads `customers` by id; if
  `active === false` → `signOut()` + `'This account has been deactivated. Please contact support.'`;
  if no profile, inserts one from auth metadata.
- `signOutCustomer()`, `getCurrentSession()`, `getCustomer(id)`,
  `updateCustomer(id, updates)` (sets `updated_at`; RLS-allowed own-row update),
  `getCustomerOrders(id)`, `getOrderWithItems(orderId)`, `createOrder(...)`
  (Orders-module concern; has a referral commission tail).

#### `/login` — `app/(customer)/login/page.tsx` — **Client**
- Wrapped in `<Suspense>` (uses `useSearchParams`). Renders `<Navigation/>` + `<Footer/>`.
- `redirect = searchParams.get('redirect') || '/products'`. **Warehouse** users with no
  explicit redirect go to `/warehouse` (`destinationFor`).
- `handleSubmit`: empty fields → `'Please enter email and password'`; `signInWithPassword`;
  on success re-reads `customers.active, role` by id; if `active===false` → `signOut()` +
  deactivated message; else shows `PeptideLoader` `"Signing you in..."` and `window.location.href = dest` after **2500 ms**.
- A `useEffect` also redirects an already-signed-in `customer` to `destinationFor(role)`.

#### `/signup` — `app/(customer)/signup/page.tsx` — **Client, DISABLED**
- The component calls **`notFound()`** (line 263), so `/signup` 404s. Self-signup is
  intentionally off; account creation is admin-driven (invite + set-password). The form
  (First/Last/Email/Password/Confirm, success "Check Your Email" state) is implemented but
  unreachable. Imports `getStoredReferral`/`clearStoredReferral` from `lib/affiliate/referral`.

#### `/forgot-password` — `app/(customer)/forgot-password/page.tsx` — **Client**
- (Linked from the login page — not listed in the atlas.) Single email field; on submit
  calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/account/set-password` })`.
- **Always shows the success state** regardless of whether the account exists (no account
  enumeration). Empty email → `'Please enter your email address.'`. Icons: `KeyRound`/`Mail`/`Check`/`ArrowLeft`.

#### `/account/set-password` — `app/(customer)/account/set-password/page.tsx` — **Client**
- Four mutually-exclusive states inside one card: **Loading** (`'Verifying your link…'`),
  **No customer** (`AlertCircle`, `'Link invalid or expired'`, `'Go to sign in'` → `/login`),
  **Done** (emerald `Check`, `'Password set'`, redirect after **1500 ms**), and the **Form**.
- Form: `KeyRound`, `'Set your password'`, greeting `Welcome{, FirstName}! Choose a password…`;
  **New password** (`autoComplete="new-password"`, helper `8+ characters with an uppercase
  letter, a lowercase letter, a number, and a symbol.`) + **Confirm password**, both with
  Eye/EyeOff toggles.
- Submit: `validatePassword` (fail → `'Password requirements: ' + errors.join(', ') + '.'`);
  mismatch → `'Passwords do not match.'`; else `supabase.auth.updateUser({ password })` →
  `refreshCustomer()` → redirect to `destination`.
- **`destination = customer?.role === 'affiliate' ? '/admin' : '/account/dashboard'`.**
- Footer micro-copy: `Beaker` + `Research Only · Shipping to Canada`.

#### `/account/dashboard` — `app/(customer)/account/dashboard/page.tsx` — **Client**
- Guard: after `isLoading`, if `!customer` → `router.push('/login?redirect=/account/dashboard')`.
- Loads orders via `getCustomerOrders(customer.id)`; seeds an editable profile form
  (default `shipping_country = 'CA'`).
- **Eyebrow `My Account`**, `Welcome back, {first_name}!`, subtext. If `role ∈ {admin, assistant}`,
  a `Go to Admin Dashboard` button → `/admin`.
- `grid lg:grid-cols-3`: **Your Orders** (col-span-2) with loading/empty/list states + status
  badges (see §4); **Account Info** + **Shipping Address** cards with inline edit (Save/Cancel),
  and a **Sign Out** button that shows `PeptideLoader "Signing you out..."`, waits **2500 ms**,
  `logout()`, then `router.push('/')`.
- **Styling note:** this page uses **`slate-*` / `cyan-*`** Tailwind defaults (legacy palette),
  NOT the `ink`/`bronze` design tokens used elsewhere in the cluster.

### Admin → Customers (Tier E)

#### `/admin/customers` — `app/(admin)/admin/customers/page.tsx` — **Client**
- `userRole = useUserRole()`. `canCreateCustomer = admin | affiliate`;
  `canSendMagicLink = admin | affiliate | assistant`.
- `loadCustomers()` → `GET /api/admin/customers` with bearer token. Client-side filter via
  `rankBySearch` (weights: first/last name 3, full name 2, email 1) + affiliate filter +
  active filter.
- Toolbar: search (`Search customers...`), affiliate `<select>` (`All customers`/`Affiliate
  customers`/`Direct (no affiliate)`, hidden for affiliate role), status `<select>`
  (`Any status`/`Active`/`Inactive`), **Download Report** (`GET /api/admin/customers/report`,
  opens blob), and **New Customer** (`UserPlus`, when `canCreateCustomer`).
- Table `min-w-[860px]`, title `Customers` (or `Your Customers` for affiliate) + `{n} shown`.
  Columns: **Customer**, **Phone**, **Affiliate** (hidden for affiliate role; emerald badge),
  **Joined**, **Role** (`getRoleBadgeClasses`), **Delivery**, **Actions**.
  - **Delivery:** if `canEdit`, two toggle buttons **Ship** (`Truck`) / **Pickup** (`Store`),
    green when enabled, calling `updateCustomerFulfillment`. Read-only roles see static badges.
  - **Actions:** **Login Link** (`KeyRound`, blue; `Sending...` → `Sent` green `Check` for 3 s;
    `alert()` on error) for `canSendMagicLink`; **Edit** (`Pencil`), **Make Admin / Remove
    Admin** (`Shield`/`ShieldOff`, `toggleCustomerAdmin`), **Delete** (`Trash2`, red) gated by
    `canEdit`/`canDelete` (admin). If neither edit nor link → `View only`.
- Empty: `No customers yet` / `No customers match your filters`. Loading row: spinner + `Loading customers…`.
- Renders `CreateCustomerModal`, `EditCustomerModal`, `DeleteCustomerDialog`; each re-loads on success.

#### `CreateCustomerModal` — `…/customers/_components/CreateCustomerModal.tsx` — **Client**
- Fields: First/Last (grid), Email, Phone (optional). Checkbox **"Create a login for this
  customer"** (default **on**).
- When login on, a **radio group** picks how the password is established (this is richer
  than the atlas): **"Set the password now"** (default; reveals a `Password (min. 6 characters)`
  input) or **"Let the customer set their own"** (emails a set-up link).
- Submit: if creating login & no email → `'Email is required to create a login.'`; if set-now
  & password < 6 → `'Password must be at least 6 characters.'`.
  `POST /api/admin/customers { create_login:true, password? }`; when "self", follows with
  `POST /api/admin/customers/magic-link { customer_id, redirect_path:'/account/set-password' }`.
- Result view: `mode:'set'` → `Customer created` + share-the-password note (`KeyRound`);
  `mode:'self'` → emailed-link note (`Mail`); `linkError` → amber "couldn't be emailed" note.
  Submit label: `Creating & sending…` (self) / `Creating…` / `Create`.

#### `EditCustomerModal` — `…/customers/_components/EditCustomerModal.tsx` — **Client**
- Fields: First/Last, Email, Phone, **Role** `<select>` (`Customer`/`Warehouse`/`Assistant`/`Admin`),
  **New Password** (mono input, Eye toggle, Copy button → green `Check` 2 s, `Generate new
  password` link → `generatePassword(16)`, note `Only applies to customers with a login account.`),
  **Active (can log in)** checkbox.
- Validation: needs ≥1 of name/email → `'Enter a name or email for the customer.'`; password
  (if typed) must pass `validatePassword`. Save → `updateCustomer` → `PUT /api/admin/customers/[id]`.

#### `DeleteCustomerDialog` — `…/customers/_components/DeleteCustomerDialog.tsx` — **Client**
- Header `Remove Customer`. **Deactivate** (amber `PowerOff`; "Customer cannot log in, but all
  data … is preserved.") → `deleteCustomer(id, false)` (soft, via PUT `{active:false}`).
  **Delete Permanently** (red `Trash2`; "This cannot be undone.") → `deleteCustomer(id, true)`
  (DELETE). Plus Cancel. Buttons show `Processing...` while running.

### Admin → Users (Tier F)

#### `/admin/users` — `app/(admin)/admin/users/page.tsx` — **Client**
- `getUsers()` (reads `customers` directly via anon client, newest first). Client filters:
  `rankBySearch` + role filter (`all/customer/warehouse/assistant/admin`) + status filter.
- **Stats row:** `{total}` (`Users` icon), green-dot `{active}`, red-dot `{inactive}`.
- **Filters row:** search (`Search users by name or email...`), Role `<select>`
  (`All Roles`/Customer/Warehouse/Assistant/Admin), Status `<select>`, **Add User** (`Plus`,
  when `canCreate`).
- Table `min-w-[720px]`, title `Users` + `{n} shown`. Columns: **User**, **Phone** (`-`),
  **Role** (badge), **Status** (Active emerald / Inactive red pill), **Joined**, **Actions**
  (only if `canEdit || canDelete`).
  - Actions: **Edit** (`Pencil`), **toggle active** (`Power`; amber when active, emerald when
    inactive; `toggleUserActive`), **Delete** (`Trash2`, red).
- Empty: `No users match your filters` / `No users yet`. Loading row spinner `Loading users…`.

#### `CreateUserModal` — `…/users/_components/CreateUserModal.tsx` — **Client**
- Fields: First* (`Jane`), Last* (`Doe`), Email* (`user@example.com`), Phone (`+1 234 567 8900`),
  **Role** `<select>` (Customer/Warehouse/Assistant/Admin), **Password*** (mono, Eye, Copy →
  `Check` 2 s, `Generate secure password` → `generatePassword(16)`), **Active (can log in)**
  checkbox (default checked).
- Validation: missing email/first/last/password → `'Email, first name, last name, and password
  are required.'`; password must pass `validatePassword`. Submit → `createUser({…, password_hash:
  password})` (the wrapper maps `password_hash → password` in the POST body) → `POST /api/admin/users`.
  Buttons: `Cancel` / `Create User` (`Creating...`).

#### `EditUserModal` — `…/users/_components/EditUserModal.tsx` — **Client**
- Same fields pre-filled; password labeled **"New Password (leave blank to keep current)"**.
  Validation: email/first/last required → `'Email, first name, and last name are required.'`;
  password (if entered) must pass `validatePassword`. Submit → `updateUser(id, {…})` →
  `PUT /api/admin/users/[id]`. Buttons: `Cancel` / `Save Changes` (`Saving...`).

#### `DeleteConfirmDialog` — `…/users/_components/DeleteConfirmDialog.tsx` — **Client**
- Identical layout to the customer dialog: **Deactivate** (`deleteUser(id, false)`) / **Delete
  Permanently** (`deleteUser(id, true)`) / Cancel. Copy: "User cannot log in, but all data is
  preserved." / "Permanently removes the user and all associated data. This cannot be undone."

### Admin API routes (service role)

| Route | File | Auth helper | Behavior |
|---|---|---|---|
| `GET /api/admin/customers` | `…/customers/route.ts` | `getCaller` (rejects `customer`/none → 403) | Selects `*, bound_affiliate:affiliates!customers_affiliate_id_fkey(…)`, newest first; affiliate caller scoped to `affiliate_id = caller.id`. |
| `POST /api/admin/customers` | same | `getCaller` (admin or affiliate) | `createLogin = !!create_login || !!password`; `autoConfirm` default true. **Login path:** requires email; password (if given) ≥6; `auth.admin.createUser({email,password?,email_confirm,user_metadata})`; insert `customers` row `id = authData.user.id`, `role:'customer'`, `active:true`, `email_verified:autoConfirm`; **rolls back** auth user if insert fails; dup email → 409; 201. **Guest path:** needs ≥1 of name/email; synth email `guest+<ts>@aminocan.local`; 201. Affiliate callers auto-bind `affiliate_id`; `applyAffiliatePricelist` best-effort. |
| `PUT /api/admin/customers/[id]` | `…/customers/[id]/route.ts` | `verifyAdmin` (**admin only**) | `hasAuthUser(id)` via `auth.admin.getUserById`. Auth-backed: `active` → `updateUserById(ban_duration: active?'none':'876600h')`; `email`/`password` → `updateUserById`. Guests skip auth. Always updates `customers` (`updated_at`; provided fields; `role` also sets `is_admin = role==='admin'`). Re-selects with `bound_affiliate`. Dup → 409. |
| `DELETE /api/admin/customers/[id]` | same | `verifyAdmin` | Deletes `customers` row first, then best-effort `auth.admin.deleteUser` (skipped for guests). `{success:true}`. |
| `POST /api/admin/customers/magic-link` | `…/customers/magic-link/route.ts` | `getCaller` (not `customer`) | Loads customer (404 if missing); affiliate bound-check; `active===false` → 400 `'This account is deactivated.'`; empty/`@aminocan.local` email → 400; whitelists `redirect_path` to `{/account/dashboard,/admin,/account/set-password}` (default dashboard); `sendSupabaseMagicLink`. Errors mapped: no-account → 400 `"…doesn't have a login account yet."`; rate limit → 429 `"Too many sign-in emails…"`; else 500. |
| `POST /api/admin/users` | `…/users/route.ts` | `verifyAdmin` returns `{authorized,email,role}` (**admin only**) | Requires email/first/last/role/password → else 400 `'Missing required fields'`. `auth.admin.createUser({email:lower,password,email_confirm:true,user_metadata})`; insert `customers` `{id, role, is_admin: role==='admin', active: active ?? true, email_verified:true}`; **rolls back** auth user on insert failure. `{success:true}`. (Contains verbose `console.log`s.) |
| `PUT /api/admin/users/[id]` | `…/users/[id]/route.ts` | `verifyAdmin` (admin only) | Order matters: (1) `active` → ban toggle; (2) `email`/`password` → `updateUserById`; (3) update `customers` (`updated_at`; conditional `email`(lower)/`first_name`/`last_name`/`phone`/`role`(+`is_admin`)/`active`/**`can_send_fulfillment_emails`**). |
| `DELETE /api/admin/users/[id]` | same | `verifyAdmin` | If a bound `affiliates` row shares the id, deletes its `commissions`, `referral_codes`, `affiliates` rows first; deletes any `sales_persons` with `user_id=id`; deletes `customers` row; then `auth.admin.deleteUser` (non-fatal). |

`lib/admin/api.ts` browser wrappers (attach the session bearer token):
`getUsers(filters?)`, `createUser` (maps `password_hash`→`password`), `updateUser`,
`deleteUser(id, hard)` (hard → DELETE; **soft → PUT `{active:false}` server-side**, so the
auth ban is applied), `toggleUserActive(id, active)` → PUT `{active}`, `toggleCustomerAdmin(id,
isAdmin)` → **direct anon update of `is_admin` only**, `updateCustomer`/`deleteCustomer` →
proxy the customer routes, `updateCustomerFulfillment(id, allowPickup, allowShipping)` → direct
anon update of `allow_pickup`/`allow_shipping`.

---

## 4. UI/UX design overview

### Design tokens

Defined in `tailwind.config.ts` (`theme.extend.colors`) and mirrored as CSS vars in
`app/globals.css`. The cluster lives under `app/` and uses `@tailwind base/components/utilities`.

| Token (Tailwind class) | Hex | Use |
|---|---|---|
| `ink` (`text-ink`, `bg-ink`) | `#1A1A1A` | Primary text, primary buttons, active nav pill |
| `ink-muted` | `#6E6E6E` | Secondary text, icons, placeholders |
| `ink-light` | `#8A8A8A` | Tertiary |
| `bronze` | `#9C8B5A` | Accent: eyebrows, links, focus ring, admin badge |
| `bronze-light` | `#B8A876` | — |
| `bronze-dark` | `#7D6F48` | Link hover |
| `surface` | `#F7F7F7` | Page bg of admin shell, input bg, ghost buttons |
| `surface-2` | `#F2F2F2` | — |
| `line` | `#C9CCD1` | All borders & dividers |
| `--success` (globals) | `#22c55e` | — |

Status / accent colors are Tailwind defaults: `emerald-500 #10b981`, `red-500 #ef4444`,
`red-400 #f87171`, `amber-500 #f59e0b`, `amber-600 #d97706`, `blue-500 #3b82f6`,
`blue-400 #60a5fa`, `indigo-500 #6366f1`, `purple` (dashboard), `cyan-500 #06b6d4` /
`cyan-600 #0891b2` (dashboard legacy), `slate-*` (dashboard legacy).

**Role badge classes** (`getRoleBadgeClasses`):
- `customer` → `bg-gray-500/10 text-ink-muted`
- `affiliate` → `bg-emerald-500/10 text-emerald-500`
- `assistant` → `bg-blue-500/10 text-blue-400`
- `admin` → `bg-bronze/10 text-bronze`
- `warehouse` → `bg-indigo-500/10 text-indigo-500`

**Typography:** headings via `font-heading` (Plus Jakarta Sans) where set, body via system
sans stack (`tailwind.config` `fontFamily.sans`). Card/section headings `text-lg font-bold
text-ink`; table headers `text-xs font-semibold text-ink-muted uppercase tracking-wider`;
eyebrows `text-xs font-semibold uppercase tracking-[0.15em]` (admin) / `tracking-[0.2em]`
(dashboard). Body text `text-sm`, helper `text-xs` / `text-[10px]`/`text-[11px]`.

**Reusable primitives (exact recipes):**
- **Card:** `bg-white rounded-xl border border-line` (modals `rounded-xl shadow-lg` or
  `rounded-2xl`; auth cards add `shadow-sm`).
- **Primary button:** `bg-ink hover:bg-ink/90 text-white font-semibold rounded-lg … disabled:opacity-50`.
- **Ghost/secondary button:** `bg-surface border border-line text-ink hover:bg-line/20`.
- **Input:** `bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted
  focus:outline-none focus:ring-2 focus:ring-bronze/40` (auth pages add `focus:border-transparent`
  and an inline left icon at `absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted`).
- **Modal overlay:** `fixed inset-0 bg-black/50 flex items-center justify-center p-4` (`z-50`,
  create-customer uses `z-[60]`); panel `max-w-md`/`max-w-sm`, `max-h-[90vh] overflow-y-auto`.
- **Icons:** `lucide-react`, typically `w-4 h-4` (`w-3.5 h-3.5` in dense table actions).
- **Motion:** auth/dashboard cards `framer-motion` `initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}`;
  dashboard order rows stagger `transition={{delay: index*0.05}}`.

### Per-screen layout notes

- **Auth cards** (`/login`, `/account/set-password`, `/forgot-password`): centered `max-w-md`
  on `bg-white`, padding `pt-32 sm:pt-36 md:pt-44 pb-16…`; header = icon in a `w-12 sm:w-14
  h-12 sm:h-14 bg-ink rounded-xl` square (`Beaker` for login, `KeyRound` for set-password),
  bold heading, muted subtext; error banner `bg-red-50 border border-red-200 rounded-lg` with
  `AlertCircle text-red-500` + `text-red-700` message; full-width primary submit with leading
  icon + `ArrowRight`.
- **Admin shell** (`layout.tsx`): `min-h-screen bg-surface`; white header (`bg-white border-b
  border-line`, `max-w-7xl` container) with `AMINOCAN` logo, `|` divider, role eyebrow, optional
  amber `Read Only` pill, and a right-aligned `Back to Store` link. Nav: desktop = wrapping pill
  buttons (active `bg-ink text-white font-medium`, inactive `bg-white border border-line
  text-ink-muted hover:text-ink hover:border-ink/20`); mobile = a full-width toggle button
  opening a `grid grid-cols-2 sm:grid-cols-3` drawer (`Menu`/`X`). Badge pills:
  `bg-red-500`/`bg-amber-500`, `text-white text-[11px] font-bold`, `99+` cap.
- **Customers / Users tables:** toolbar `flex flex-col sm:flex-row gap-3 mb-6`; table card
  `bg-white rounded-xl border border-line overflow-hidden`, header row `p-5 md:p-6 border-b
  border-line` with title + `{n} shown`; `overflow-x-auto` wrapper, `min-w-[860px]`/`[720px]`;
  rows `hover:bg-surface`, `divide-y divide-line/50`; cells `px-5 py-4`.
- **Dashboard** (`/account/dashboard`): **legacy slate/cyan palette** — cards `bg-white
  rounded-xl border border-slate-200`; headings `text-slate-900`; accent icons/links
  `text-cyan-600`; profile Save button `bg-gradient-to-r from-cyan-500 to-blue-500 … shadow-lg
  shadow-cyan-500/25`; Sign Out hovers to `bg-red-50 text-red-600 border-red-200`.

### Status & state colors

- **Order status badges** (dashboard, `statusColors`/`statusIcons`):
  `pending` amber (`bg-amber-50 text-amber-700 border-amber-100`, `Clock`),
  `paid` blue (`CheckCircle`), `processing` purple (`Package`), `shipped` indigo (`Truck`),
  `delivered` emerald (`CheckCircle`), `cancelled` red (`XCircle`). Mobile hides the inline
  badge and shows it on a second line.
- **User status pill:** Active `bg-emerald-500/10 text-emerald-400`; Inactive `bg-red-500/10 text-red-400`.
- **Delivery toggles:** enabled `bg-green-500/10 border border-green-500/20 text-green-600`;
  disabled `bg-line border border-line text-ink-muted`.
- **Login Link button:** idle `bg-blue-500/10 border-blue-500/20 text-blue-600`; sent
  `bg-green-500/10 … text-green-600`.
- **Make/Remove Admin:** make `bg-bronze/10 border-bronze/20 text-bronze`; remove
  `bg-red-500/10 border-red-500/20 text-red-400`.

### Responsive

All cards single-column on mobile, `grid`/`flex-wrap` from `sm:`/`lg:`. Tables scroll
horizontally (`overflow-x-auto` + `min-w`). Forms `grid-cols-1 sm:grid-cols-2`. Admin nav
collapses to the mobile drawer below `lg`.

---

## 5. Data flow & behavior

### Session hydration
1. User authenticates (password on `/login` or the admin inline form, or a magic/reset link
   landing on an allowed redirect).
2. Supabase stores the session; the shared client's `detectSessionInUrl:true` picks up hash
   tokens; `onAuthStateChange` fires → `CustomerContext` defers `refreshCustomer()` →
   `POST /api/auth/customer` hydrates the `Customer`.
3. Account pages read `useCustomer()`; the admin layout runs its own `checkAdmin()`.

### Invite → set-password (admin-driven onboarding)
`CreateCustomerModal` (mode "self") → `POST /api/admin/customers {create_login:true}` (passwordless,
`email_confirm:true`) → `POST /api/admin/customers/magic-link {redirect_path:'/account/set-password'}`
→ Supabase emails an implicit-flow link → recipient clicks → browser detects tokens →
`SIGNED_IN` → lands on `/account/set-password` → `supabase.auth.updateUser({password})` →
`refreshCustomer()` → redirect (`/admin` for affiliate, else `/account/dashboard`).

### Login
`signInWithPassword` → re-read `customers.active, role` → if deactivated, `signOut()` + message;
else `PeptideLoader` then hard redirect after 2.5 s (warehouse → `/warehouse`).

### Deactivation (the 876600h ban)
Setting `active:false` does **two** things for auth-backed accounts:
`auth.admin.updateUserById(id, { ban_duration: '876600h' })` (~100 years) **and**
`customers.active = false`. Reactivation passes `ban_duration: 'none'`. Login flows *also*
re-check `active` client-side and force `signOut()`. Guests (no auth user) only get the
column flip. Soft-delete in both dialogs routes through `PUT … {active:false}` so the ban
is applied (not a bare client update).

### Role ↔ is_admin sync
Every API route that writes `role` also writes `is_admin = (role === 'admin')`. The DB trigger
`sync_is_admin_on_role_change` enforces the same invariant at the database layer. The Customers
page "Make Admin / Remove Admin" button flips **`is_admin` only** (via `toggleCustomerAdmin`,
direct anon update) **without** changing `role`. Treat `role` as authoritative for RBAC and
`is_admin` as the legacy mirror — they can momentarily diverge through that toggle.

### Audit
`logAuditServer()` appends to `audit_log` server-side; errors are swallowed. It is wired into
the Invoices/Pricelists modules — **not** into the user/customer routes documented here. There
is no audit viewer page; the RLS read policy grants admin/assistant SELECT for future tooling.

### Authorization (server)
`verifyAdmin` / `getCaller`: `auth.getUser(bearerToken)` → look up `customers.role` by `id`,
**fall back to lookup by lowercased `email`** when no row matches the id (covers cases where
`customers.id` doesn't yet equal `auth.users.id`). `verifyAdmin` authorizes only `role==='admin'`;
`getCaller` returns `{id, role}` and routes decide (e.g. magic-link rejects only `customer`).

---

## 6. Edge cases & states

- **Empty:** Customers → `No customers yet` / `No customers match your filters`; Users →
  `No users yet` / `No users match your filters`; dashboard orders → `Beaker` + "You haven't
  placed any orders yet" + Browse Products link.
- **Loading:** RouteGuard centered `Loading...`; admin shell `Loading admin panel...`
  (`animate-pulse`); tables show a spinner row; dashboard `Loading...` / `Loading orders...`.
- **Error:** API errors surface as inline red banners in modals, native `alert()` for the
  magic-link button, and Supabase `error.message` on login. `POST /api/auth/customer` → 401/403/500.
- **Unauthorized / not-admin:** admin layout renders `Access Denied` ("Your account does not
  have admin privileges." / "Something went wrong. Try refreshing.") + `Go Home`. Customers/
  Users pages additionally hide create/edit/delete by role; a no-permission Customers row shows
  `View only`.
- **Deactivated:** login & `/api/auth/customer` block with deactivated messaging; magic-link
  route returns `This account is deactivated.`
- **Guest customers** (`@aminocan.local`, no `auth.users` row): all auth steps are skipped
  (`hasAuthUser` guards in PUT/DELETE), magic-link refuses them, and they cannot log in.
- **Disabled signup:** `/signup` returns Next's 404 via `notFound()`.

---

## 7. Open questions & unverified items

- **`sync_is_admin_with_role()` body is not in the repo** (dashboard-only). Assumed to set
  `is_admin = (role = 'admin')` on insert/update; confirm against the live function before
  relying on edge behaviour (e.g. whether it also resets `is_admin` to false for non-admins).
- **`user_role` enum value order/`warehouse` origin** is inferred from the TS unions and the
  `affiliate-program-migration.sql` `ADD VALUE`; the exact dashboard `CREATE TYPE` (and where
  `warehouse` was added) is not in committed SQL.
- **`PeptideLoader`, `Navigation`, `Footer`** are referenced but outside this cluster — their
  internals were not examined here (only their props/usage: `PeptideLoader message/type`,
  `Navigation showTicker?`).
- **`rankBySearch` / `byNewest`** (`lib/search.ts`) behaviour is used as-is; only its call
  signature (weighted fields + tiebreaker) was verified, not its internals.
- **`/account/orders` and `/account/orders/[id]`** exist and belong to this route group but
  were not re-read in full for this spec (they read `orders`/`order_items` via
  `lib/customer/api.ts` and enforce `order.customer_id === customer.id`); treat the atlas
  (`docs/module-ports/05`) descriptions of them as secondary.
- **`applyAffiliatePricelist`** touches `affiliate_price_overrides` / `customer_price_overrides`
  (Pricing module) — out of scope here; documented only as a side effect of customer creation.
- **`MAGIC-LINK-SETUP.md` / Supabase dashboard config** (custom SMTP, the "Magic Link" template,
  and the redirect allowlist that must include `/account/set-password`, `/account/dashboard`,
  `/admin` for prod + localhost) is required for delivery but is environment config, not code.
- Env vars required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server-only), `NEXT_PUBLIC_BASE_URL`.
