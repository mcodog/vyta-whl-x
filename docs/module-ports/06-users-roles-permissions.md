# Module 6 — Users, Roles & Permissions

This module covers the **role-based access control (RBAC)** that gates the admin area, the **staff/user management** screen (`Admin → Users`), the **admin gating + route guards** (admin layout + page-level access checks), and the **append-only audit log** that records sensitive admin mutations. Roles live on `customers.role` (a Postgres enum) and are enforced both client-side (admin layout + `lib/permissions.ts`) and server-side (each API route re-verifies the caller's role with the service-role key). Users and customers are the **same table** (`customers`) and the same Supabase Auth users — "Users" is just the staff-oriented view of that table.

> Affiliate note: The original app has an `'affiliate'` role that is **NOT being ported**. This doc documents only the **customer + assistant + admin** roles and flags every place the `'affiliate'` value and affiliate permission checks must be removed (**STRIP**). The core RBAC helpers, route guard, admin gating, and audit infrastructure all stay.

---

## Data model

### `customers.role` (the role column)
Roles are stored on `customers.role` of type `user_role`. See **Module 5** for the full `customers` table. The relevant columns for RBAC:

| Column | Type | Default | Notes |
|---|---|---|---|
| `role` | `user_role` enum | `'customer'` | source of truth for RBAC |
| `is_admin` | `boolean` | `false` | legacy boolean, kept in sync: API routes set `is_admin = (role === 'admin')` |
| `active` | `boolean` | `true` | inactive users are banned in Supabase Auth and cannot sign in |

### `user_role` enum
Created in the Supabase dashboard (not committed SQL). For the port:
```sql
CREATE TYPE user_role AS ENUM ('customer', 'assistant', 'admin');
-- STRIP: the original additionally runs (affiliate-program-migration.sql):
-- ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'affiliate';
```

### `admin-migration.sql`
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_customers_admin ON customers(is_admin) WHERE is_admin = true;
-- Bootstrap the first admin manually:
-- UPDATE customers SET is_admin = true WHERE email = 'your-email@example.com';
```
To bootstrap the first admin in the ported app, also set the role:
`UPDATE customers SET role = 'admin', is_admin = true WHERE email = '…';`

### `audit_log` (`audit-log-migration.sql`)
Append-only ledger of admin actions. Written only by API routes via `logAuditServer()` (service-role); never updated or deleted by app code.

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `actor_id` | `uuid` | — | FK → `customers(id) ON DELETE SET NULL` |
| `action` | `text` | — | `NOT NULL` (e.g. `invoice.create`) |
| `entity_type` | `text` | — | `NOT NULL` (e.g. `invoice`) |
| `entity_id` | `uuid` | — | nullable |
| `payload` | `jsonb` | — | nullable, arbitrary context |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log (actor_id, created_at DESC);
```

RLS:
```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_admin_read ON audit_log;
CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );
-- Writes happen only via the service-role key (API routes); no client INSERT policy.
```

> There is no admin-facing audit-log *viewer page* in this repo — the table is read by SQL/RLS only and written by API routes. The RLS read policy grants `admin`/`assistant` SELECT for future tooling.

---

## API endpoints

All staff-management routes use the **service-role** Supabase client and re-verify the caller's role from the `Authorization: Bearer <access_token>` header. The shared pattern (`verifyAdmin`): `auth.getUser(token)` → look up `customers.role` by `id`, fall back to lookup by lowercased `email`, return whether `role === 'admin'`.

### `POST /api/admin/users` — create a staff/user account
File: `app/api/admin/users/route.ts`.
- **Auth:** `verifyAdmin` returns `{authorized, email, role}`; **admin only** → else `403 {error:'Forbidden'}`. (Extra console logging present in original; optional.)
- **Request:** `{ email, first_name, last_name, role, password, phone?, active? }`. Missing any of email/first_name/last_name/role/password → `400 "Missing required fields"`.
- **Logic:** `supabase.auth.admin.createUser({ email:lowercased, password, email_confirm:true, user_metadata:{first_name,last_name} })`. On error → `500`. Then insert `customers` row: `{ id: authUser.id, email, first_name, last_name, phone||null, role, is_admin: role==='admin', active: active ?? true, email_verified:true }`. If the insert fails, **roll back** the auth user (`auth.admin.deleteUser`) and return `500`.
- **Response:** `{ success: true }`.

### `PUT /api/admin/users/[id]` — update a user
File: `app/api/admin/users/[id]/route.ts`. **Admin only.**
- **Request:** any of `{ email, first_name, last_name, phone, role, active, password }`.
- **Logic (order matters):**
  1. If `active !== undefined`: `auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876600h' })` (≈100-year ban deactivates login). Error → `500`.
  2. If `email || password`: `auth.admin.updateUserById(id, { email?, password? })`. Error → `500`.
  3. Update `customers` row: always `updated_at`; conditionally `email`(lowercased), `first_name`, `last_name`, `phone`, `role` (also sets `is_admin = role==='admin'`), `active`.
- **Response:** `{ success: true }`.

### `DELETE /api/admin/users/[id]` — hard delete
**Admin only.** Deletes the `customers` row first, then `auth.admin.deleteUser(id)` (logged but non-fatal if it fails). `{ success: true }`.

> `lib/admin/api.ts` wrappers call these: `getUsers(filters?)` (reads `customers` directly via the service/anon client, ordered by `created_at desc`, supports role/active/search filters via `.or(email/first_name/last_name ilike)`), `createUser`, `updateUser`, `deleteUser(hard)` (hard → DELETE; soft → PUT `{active:false}`), `toggleUserActive(id, active)` → PUT `{active}`. All attach the current session's bearer token.

### Audit-log writer — `lib/admin/audit.ts`
`logAuditServer(supabase, { actor_id, action, entity_type, entity_id, payload? })`. Inserts into `audit_log`. **Failures are swallowed and logged** — an audit-write error must never fail the originating mutation. Always called server-side with a service-role client.

Currently invoked from (Invoices & Pricelists modules):
- `app/api/admin/invoices/route.ts` (`invoice.create`)
- `app/api/admin/invoices/[id]/route.ts`
- `app/api/admin/invoices/[id]/email/route.ts`
- `app/api/admin/invoices/[id]/payments/route.ts`
- `app/api/admin/pricelists/route.ts`
- `app/api/admin/pricelists/[id]/route.ts`

Example call:
```ts
await logAuditServer(supabase, {
  actor_id: userId,
  action: "invoice.create",
  entity_type: "invoice",
  entity_id: invoice.id,
  payload: { invoice_number: invoice.invoice_number, total, status, is_backorder },
});
```
The user-management routes here do **not** currently write audit entries (an opportunity, not a requirement).

---

## Frontend

### RBAC helpers — `lib/permissions.ts`
Pure functions exported for use across admin pages. `export type UserRole = 'customer' | 'affiliate' | 'assistant' | 'admin'` — **STRIP `'affiliate'`** in the port.

| Function | Behavior (port version after STRIP) |
|---|---|
| `canAccessAdmin(role)` | `true` for `admin`, `assistant` (orig. also `affiliate` — STRIP) |
| `canAccessAdminPage(role, href)` | `admin`/`assistant` → all pages. (Affiliate subset logic — STRIP.) |
| `canEdit(role)` | `role === 'admin'` |
| `canCreate(role)` | `role === 'admin'` |
| `canDelete(role)` | `role === 'admin'` |
| `canViewInvoices(role)` | `admin` or `assistant` (orig. + affiliate — STRIP) |
| `canEditInvoice(role)` | `admin` (orig. + affiliate — STRIP) |
| `getRoleName(role)` | display name: `customer→'Customer'`, `assistant→'Assistant'`, `admin→'Administrator'` (drop affiliate) |
| `getRoleBadgeClasses(role)` | Tailwind badge classes (see below) |
| `isAffiliate(role)` | **STRIP** entirely |
| `AFFILIATE_PAGES` const | **STRIP** entirely |

Role badge classes (`getRoleBadgeClasses`):
- `customer`: `bg-gray-500/10 text-ink-muted`
- `assistant`: `bg-blue-500/10 text-blue-400`
- `admin`: `bg-vital/10 text-vital`
- ~~`affiliate`: `bg-emerald-500/10 text-emerald-500`~~ (STRIP)

### Permission hook — `lib/hooks/usePermissions.ts`
```ts
export function usePermissions() {
  const userRole = useUserRole();           // from admin layout context
  return { userRole, canEdit, canCreate, canDelete };  // each = fn(userRole)
}
```

### Admin gating + layout — `app/(admin)/admin/layout.tsx`
This is the central admin gate and provides the role to all admin pages.
- Exports `UserRoleContext` + `useUserRole()` (default `'customer'`).
- `checkAdmin()`: `supabase.auth.getSession()` → if no session, show an **inline login form**; else `POST /api/auth/customer { accessToken }` → `role = customer?.role || 'customer'`. If `canAccessAdmin(role)` → `authState='admin'`, `userRole=role`; else `authState='not_admin'`.
- A `useEffect` bounces users off pages they can't access: `if (authState==='admin' && !canAccessAdminPage(userRole, pathname)) router.replace('/admin')`. With affiliate stripped, this only ever no-ops for admin/assistant, but **keep it** as the page-level guard skeleton.
- `navItems`: the full sidebar list (Dashboard, Analytics, Orders, Invoices, Backorders, Purchase Orders, Products, Stock Requests, Affiliates*, Sales People*, Commissions*, Customers, Users, Pricing, Settings). The nav is filtered by `canAccessAdminPage`. (*Affiliate/Commissions/Sales-People entries belong to the stripped affiliate program — remove those nav items in the port; keep Users/Customers/etc.)
- Badge counts: backorder count (`/api/admin/backorders/count`) and low-stock count (`getLowStockProducts`) are fetched for `admin`/`assistant` only (belong to other modules).

### Users page — `app/(admin)/admin/users/page.tsx`
- Reads `useUserRole()`; lists via `getUsers()`.
- Client-side filters: search (name/email), role filter (`all/customer/assistant/admin`), status filter (`all/active/inactive`). Computes stats: total / active / inactive.
- **Add User** button visible when `canCreate(userRole)`. Row actions (Edit, toggle active via `toggleUserActive`, Delete) visible when `canEdit`/`canDelete`.
- Renders three modals: `CreateUserModal`, `EditUserModal`, `DeleteConfirmDialog` (under `_components/`). After any mutation, `loadUsers()` re-fetches.

### State management
- No React Query / Redux. Admin role flows through React **Context** (`UserRoleContext`). Lists use local `useState` + manual reload. Customer session via `CustomerContext` (Module 5).

---

## UI/UX specification

Same design tokens as Module 5 (`ink`, `ink-muted`, `surface`, `line`, `vital`; emerald/red/amber accents; `lucide-react` icons).

### Admin shell (layout)
- **Checking state:** centered **"Loading admin panel..."**.
- **Not logged in:** inline login card — title **"VYTA"**, eyebrow **"ADMIN PANEL"**, Email + Password fields, **"Sign In"** button (`LogIn`); error banner shows Supabase message or **"Enter your email and password"** / **"Something went wrong"**. On success it re-runs `checkAdmin()`.
- **Not admin / error:** centered **"Access Denied"**; subtext **"Your account does not have admin privileges."** (not_admin) or **"Something went wrong. Try refreshing."** (error); **"Go Home"** button → `/`.
- **Authenticated shell:** white header with **VYTA** logo, a `|` divider, and a role eyebrow — for admin it reads **"Admin"**, otherwise `getRoleName(role)`. **Assistant** users get a small amber **"Read Only"** pill next to the role and a banner above content: *"You have read-only access. Contact an administrator to make changes."* (`Info` icon, amber). A **"Back to Store"** link (`ArrowLeft`) sits at the right.
- **Nav:** desktop = wrapping pill buttons; mobile = a compact toggle button showing the active page label that opens a 2/3-column grid drawer (`Menu`/`X`). Active pill = `bg-ink text-white`; inactive = white bordered. Badge counts render as colored pills (red for backorders, amber for low-stock; `99+` cap).

### Users page
- **Stats row:** three bordered chips — `{n} total` (`Users` icon), green-dot `{n} active`, red-dot `{n} inactive`.
- **Filters row:** search input (**"Search users by name or email..."**), Role select (`All Roles` / Customer / Assistant / Admin), Status select (`All Statuses` / Active / Inactive), and **"Add User"** button (`Plus`) — only if `canCreate`.
- **Table** titled **"Users"** with "{n} shown". Columns: **User** (name + email), **Phone** (`-` if none), **Role** (badge via `getRoleBadgeClasses`/`getRoleName`), **Status** (Active = emerald pill / Inactive = red pill), **Joined** (locale date), **Actions** (only if canEdit||canDelete).
  - Actions: **Edit** (`Pencil`), **toggle active** (`Power`; amber when active→deactivate, emerald when inactive→activate; disabled while toggling), **Delete** (`Trash2`, red).
- **Empty state:** **"No users match your filters"** (when filtered) or **"No users yet"**.

### Create User modal (`CreateUserModal.tsx`)
- Header **"Add User"**. Fields: First Name* (`Jane`), Last Name* (`Doe`), Email* (`user@example.com`), Phone (`+1 234 567 8900`), **Role** select (Customer / Assistant / Admin), **Password*** with:
  - show/hide eye toggle, a **Copy** button (turns to a green `Check` for 2s), and a **"Generate secure password"** link (`RefreshCw`) → `generatePassword(16)` (auto-reveals).
  - **Active (can log in)** checkbox (default checked).
- Validation: missing email/first/last/password → **"Email, first name, last name, and password are required."**; password must pass `validatePassword` else **"Password requirements: …"**.
- Buttons: **Cancel** / **Create User** (**"Creating..."** while loading).

### Edit User modal (`EditUserModal.tsx`)
- Header **"Edit User"**. Same fields pre-filled. Password field labeled **"New Password (leave blank to keep current)"** with the same show/copy/generate controls. **Active (can log in)** checkbox.
- Validation: email/first/last required → **"Email, first name, and last name are required."**; if a password is entered it must pass `validatePassword`.
- Buttons: **Cancel** / **Save Changes** (**"Saving..."**).

### Delete confirm dialog (`DeleteConfirmDialog.tsx`)
- Header **"Remove User"**, shows full name + email. Two cards:
  - **Deactivate** (amber `PowerOff`): *"User cannot log in, but all data is preserved. Can be reactivated later."* → `deleteUser(id, false)`.
  - **Delete Permanently** (red `Trash2`): *"Permanently removes the user and all associated data. This cannot be undone."* → `deleteUser(id, true)`.
- **Cancel** button. Buttons show **"Processing..."** while running; errors render in a red banner.

### Password utilities (`lib/password.ts`)
- `generatePassword(length=16)`: cryptographically-shuffled, guarantees ≥1 uppercase, lowercase, digit, special (`!@#$%^&*-_=+`).
- `validatePassword(pw)`: returns `{valid, errors[]}`; rules → **"At least 8 characters"**, **"At least one uppercase letter"**, **"At least one lowercase letter"**, **"At least one number"**, **"At least one special character (!@#$%^&*-_=+)"**.
- `copyToClipboard(text)`.

### Tests (`lib/permissions.test.ts`)
Vitest suite pinning the `canAccessAdminPage` security boundary and `canAccessAdmin`/`isAffiliate`. Most assertions exercise the affiliate subset — when stripping affiliate, **rewrite** the suite to assert admin/assistant reach everything and customers reach nothing; drop the affiliate-specific cases. Keep at least the admin/assistant/customer coverage.

---

## Permissions reference

### Roles (after stripping affiliate)

| Role | Enum value | Admin area | Mutations (create/edit/delete) | Notes |
|---|---|---|---|---|
| Customer | `customer` | ❌ no admin access | ❌ | Default role; storefront + own account only |
| Assistant | `assistant` | ✅ read-only (all pages) | ❌ | Sees "Read Only" pill + banner; cannot create/edit/delete |
| Administrator | `admin` | ✅ full access | ✅ | Full RBAC; `is_admin = true` |
| ~~Affiliate~~ | ~~`affiliate`~~ | ~~minimized admin subset~~ | ~~limited~~ | **STRIP — do not port** |

### Permission matrix

| Capability / `lib/permissions.ts` fn | customer | assistant | admin |
|---|---|---|---|
| `canAccessAdmin` (reach `/admin`) | ❌ | ✅ | ✅ |
| `canAccessAdminPage` (any admin page) | ❌ | ✅ | ✅ |
| `canCreate` (Add User / create records) | ❌ | ❌ | ✅ |
| `canEdit` (edit/toggle/update) | ❌ | ❌ | ✅ |
| `canDelete` (delete/deactivate) | ❌ | ❌ | ✅ |
| `canViewInvoices` | ❌ | ✅ | ✅ |
| `canEditInvoice` | ❌ | ❌ | ✅ |
| Manage users (create/edit/delete) | ❌ | ❌ | ✅ |
| Read audit log (RLS) | ❌ | ✅ | ✅ |

### Server-side enforcement
Every admin write API independently calls `verifyAdmin` (role = `admin` from the bearer token) before mutating — the UI gating is **defense-in-depth**, not the security boundary. The service-role key bypasses RLS, so server-side role checks are mandatory.

### Deactivation semantics
`active:false` → Supabase Auth ban (`ban_duration:'876600h'`) + `customers.active=false`. Sign-in flows also re-check `active` and force sign-out. `active:true` lifts the ban (`ban_duration:'none'`).

### Role ↔ is_admin sync
Every route that sets `role` also sets `is_admin = (role === 'admin')`. The Customers page "Make Admin / Remove Admin" toggle flips `is_admin` directly (without changing `role`) — keep both columns; treat `role` as authoritative for RBAC and `is_admin` as the legacy mirror.

---

## Dependencies

- **npm:** `@supabase/supabase-js` ^2.83.0, `next` ^15.5.4, `react` ^19.2.0, `lucide-react` ^0.546.0, `vitest` ^2.1.8 (tests). (`framer-motion` for the broader admin UI.)
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (required for `auth.admin.*` and bypassing RLS on writes).
- **Internal modules:** `lib/supabase.ts` (`getSupabase()` service client, `Customer`/`UserRole` types), `lib/permissions.ts`, `lib/hooks/usePermissions.ts`, `lib/admin/audit.ts`, `lib/admin/api.ts` (user CRUD wrappers), `lib/password.ts`, `app/(admin)/admin/layout.tsx` (UserRoleContext), `POST /api/auth/customer` (resolves role for the layout). Depends on the `customers` table + `user_role` enum from Module 5.

---

## Porting notes

**What to STRIP (affiliate):**
1. `UserRole` type: drop `'affiliate'`.
2. `lib/permissions.ts`: remove `isAffiliate`, `AFFILIATE_PAGES`, the affiliate branch in `canAccessAdmin`/`canAccessAdminPage`/`canViewInvoices`/`canEditInvoice`, and the affiliate entries in `getRoleName`/`getRoleBadgeClasses`.
3. `lib/permissions.test.ts`: rewrite to drop affiliate cases (keep admin/assistant/customer assertions).
4. Admin layout `navItems`: remove `Affiliates`, `Sales People`, `Commissions` (affiliate-program pages); keep Users/Customers/etc. Keep the `canAccessAdminPage` bounce `useEffect` as the page-guard skeleton.
5. `set-password` destination and customer-management affiliate branches (covered in Module 5).

**Gotchas:**
- The base `customers` table + `user_role` enum are not in committed SQL — recreate them (Module 5) before this module works.
- UI permission checks are not security — every admin API route must re-verify the caller server-side with the service-role key.
- `verifyAdmin` looks up role by `id` then falls back to `email` (handles cases where `customers.id` doesn't yet match `auth.users.id`). Preserve that fallback.
- Keep `role` and `is_admin` in sync on every write.
- Audit writes must never throw into the caller — keep the try/catch swallow in `logAuditServer`.
- The audit log has a read RLS policy but no UI viewer; if the porting target wants one, build it for `admin`/`assistant` (RLS already permits SELECT).
- Bootstrap the first admin manually via SQL (no UI can create the first admin since the Users page itself requires admin).

**Suggested order of implementation:**
1. SQL: `user_role` enum, `customers.role`/`is_admin` (admin-migration), `audit-log-migration.sql`.
2. `lib/permissions.ts` (+ rewritten test), `lib/hooks/usePermissions.ts`, `lib/admin/audit.ts`, `lib/password.ts`.
3. `app/(admin)/admin/layout.tsx` (gating + `UserRoleContext` + inline login + nav filtering).
4. User API: `POST /api/admin/users`, `PUT/DELETE /api/admin/users/[id]`; `lib/admin/api.ts` user fns.
5. `/admin/users` page + `CreateUserModal` / `EditUserModal` / `DeleteConfirmDialog`.
6. Bootstrap the first admin via SQL; wire `logAuditServer` into sensitive mutations as desired.
