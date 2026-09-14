# Cluster 1 — Identity, Accounts & Access (RBAC): Code Extraction Guide

> **What this document is.** A definitive, file-by-file walkthrough of Cluster 1 so you can
> go through the code in the right order and extract everything completely. For each piece:
> *what to open*, *what it does*, *its intricacies*, and *exactly how it touches the database*.
>
> **Companion deep specs** (column-level DDL, full request/response, every UI string):
> `docs/module-ports/05-customer-accounts-and-auth.md` and
> `docs/module-ports/06-users-roles-permissions.md`. This guide is the *map*; those are the *atlas*.

---

## 1. What the cluster is / does

The entire **identity layer**. One table — `customers` — holds **every human**: storefront
shoppers, staff (admin/assistant), warehouse, and affiliates. Each real account is mirrored
**1:1 onto Supabase `auth.users`** (`customers.id === auth.users.id`). It provides:

- **Customer-facing auth:** email/password signup* + login, forgot/reset password, passwordless
  **magic-link** onboarding (set-password), and a self-service account dashboard.
- **Staff/customer management:** admins create login or guest records, edit credentials/role,
  soft- or hard-delete, toggle delivery options, and email one-click sign-in links.
- **RBAC:** `customers.role` drives every access decision, enforced **server-side** in each API
  route (the security boundary) and **client-side** for UX (route guard + admin layout gating).
- **Audit:** an append-only `audit_log` of sensitive admin mutations.

\* Self-signup is **implemented but disabled** (`app/(customer)/signup/page.tsx:263` calls
`notFound()`); account creation is admin-driven (invite → set-password).

**Why it ports first:** `customers` is referenced by **21 foreign keys** across the schema;
nothing else compiles without it.

---

## 2. Database schema — what exists and where it comes from

### The hidden foundation (NOT in committed SQL — create by hand first)
Two objects predate the migrations and live only in the Supabase dashboard:

1. **`user_role` enum** — `CREATE TYPE user_role AS ENUM ('customer','assistant','admin','warehouse','affiliate');`
   (drop `warehouse`/`affiliate` if not porting those clusters).
2. **`customers` base table** — reconstruct from the consolidated column list in module-port
   doc 05 (and the TS `Customer` interface in `lib/supabase.ts:63`). `customers.id` must equal
   `auth.users.id` for real accounts.

### Then apply these migration files (in order)
| File | What it adds |
|------|--------------|
| `customer-auth-migration.sql` | profile/shipping columns: `phone`, `shipping_address/city/state/postal_code/country` (default `'US'`); index `idx_customers_email`. |
| `admin-migration.sql` | `is_admin boolean default false` + partial index `idx_customers_admin`. The legacy mirror of `role==='admin'`. |
| `supabase-auth-integration.sql` | **RLS** on `customers` (own-row read; own-row update that can't change `role`/`is_admin`; service-role bypass) + a reference-only `create_user_with_auth()` that always raises. |
| `audit-log-migration.sql` | `audit_log` table + 2 indexes + RLS (admin/assistant SELECT; writes service-role only). |

> Other clusters also `ALTER customers` (affiliate adds `affiliate_id`; warehouse adds
> `can_send_fulfillment_emails`). Those columns appear on the `Customer` type but belong to
> Clusters 8/6 — strip if not porting them.

### The 3 tables this cluster owns
- **`customers`** — identity hub. Key columns to know: `id` (=auth uid), `email` (unique,
  lowercased), `role`, `is_admin`, `active`, `email_verified`, `allow_pickup`/`allow_shipping`,
  `last_login_at`, shipping fields. `password_hash` and `wallet_address` are **vestigial**
  (Supabase hashes passwords; wallet is legacy crypto).
- **`audit_log`** — `actor_id → customers(id) ON DELETE SET NULL`, `action`, `entity_type`,
  `entity_id`, `payload jsonb`, `created_at`.
- **`auth.users`** — Supabase-managed; not yours to create, but every login flow reads/writes it
  via the Admin API.

### How the DB is reached (the access pattern — memorize this)
- **Browser** uses the **anon client** (`lib/supabase.ts:9`, `export const supabase`). It is
  subject to RLS, so it can only touch the customer's **own** row.
- **Server / API routes** use the **service-role client** (`lib/supabase.ts:12`, `getSupabase()`,
  `persistSession:false, autoRefreshToken:false`). It **bypasses RLS entirely** — which is *why*
  every admin route must re-verify the caller's role itself.

---

## 3. The reading map (open files in this order)

### Tier A — Foundations (read first; everything imports these)

**`lib/supabase.ts`** — *the client + type bedrock.*
- `supabase` (anon, line 9) vs `getSupabase()` (service-role, line 12).
- `UserRole` (line 55) and the full `Customer` interface (line 63) — the canonical column list.
- Intricacy: this one file also exports types for *every* other cluster (Order, Invoice,
  PurchaseOrder…). For Cluster 1 you only need `Customer`, `UserRole`, `AuditLogEntry` (line 341).

**`lib/password.ts`** — *credential helpers.*
- `generatePassword(16)` (guarantees upper/lower/digit/special), `validatePassword()` →
  `{valid, errors[]}` (rules: 8+ chars, upper, lower, number, special `!@#$%^&*-_=+`),
  `copyToClipboard()`. Used by every create/edit modal and the set-password page.

**`lib/permissions.ts`** — *the RBAC contract.* (Read in full — it's small.)
- `canAccessAdmin`, `canAccessAdminPage(role, href)`, `canCreate/canEdit/canDelete`
  (**admin-only**), `canViewInvoices`, `canEditInvoice`, `getRoleName`, `getRoleBadgeClasses`.
- Intricacy: `AFFILIATE_PAGES` + `isAffiliate` scope affiliates to a page subset — strip if no
  affiliate cluster. **No DB access** — pure functions over a role string.
- Tests: `lib/permissions.test.ts` pins the `canAccessAdminPage` boundary.

**`lib/admin/audit.ts`** — *audit writer (whole file is ~30 lines).*
- `logAuditServer(supabase, {actor_id, action, entity_type, entity_id, payload?})` → inserts one
  `audit_log` row. **Intricacy: it swallows all errors** (try/catch + console) so an audit
  failure can never break the originating mutation. Always called with the service-role client.

**`lib/admin/magic-link.ts`** — *passwordless invites.*
- `sendSupabaseMagicLink(email, redirectPath)` builds a **dedicated anon client** with
  `flowType:'implicit'` (NOT PKCE — staff generate the link, so there's no `code_verifier` in the
  recipient's browser), `persistSession:false`, `detectSessionInUrl:false`. Calls
  `auth.signInWithOtp({ email, options:{ emailRedirectTo: BASE_URL+redirectPath, shouldCreateUser:false }})`.
- Intricacy: **rejects `@aminocan.local` guest emails**; Supabase itself sends the email. The
  recipient's normal browser client (`detectSessionInUrl:true`) picks up the hash tokens on landing.

### Tier B — Session & gating (the runtime backbone)

**`contexts/CustomerContext.tsx`** — *client session → profile hydration.*
- Exposes `{customer, isLoading, refreshCustomer(), logout()}`.
- Flow: `supabase.auth.getSession()` → `POST /api/auth/customer {accessToken}` → sets `customer`.
- **CRITICAL intricacy:** inside `supabase.auth.onAuthStateChange`, it **never `await`s** Supabase
  calls — it defers with `setTimeout(refreshCustomer, 0)`. Awaiting inside the callback deadlocks
  Supabase's internal lock. Preserve verbatim. Handles `SIGNED_OUT` (clear), `SIGNED_IN /
  INITIAL_SESSION / USER_UPDATED` (deferred refresh).

**`auth.config.js`** + **`components/RouteGuard.tsx`** — *global gate (currently a pass-through).*
- `requireAuth:false` → the whole store is public, so RouteGuard no-ops. When `true`, it redirects
  unauthenticated users off non-`PUBLIC_PATHS` to `/login`. Account pages self-guard regardless.

**`app/(admin)/admin/layout.tsx`** — *the admin gate + role provider.* (Read carefully — central.)
- Exports `UserRoleContext` + `useUserRole()`.
- `checkAdmin()`: `getSession()` → if none, render an **inline login card**; else
  `POST /api/auth/customer` → `role = customer?.role || 'customer'` → `canAccessAdmin(role)` decides
  `admin` vs `not_admin`.
- A `useEffect` bounces users off pages `canAccessAdminPage` denies (`router.replace('/admin')`).
- `navItems` array is filtered by role; assistants get a **"Read Only"** pill + banner.
- DB touch: indirect (via `/api/auth/customer`). Also fetches badge counts (backorders/low-stock)
  for admin/assistant — those belong to other clusters.

**`lib/hooks/usePermissions.ts`** — thin wrapper: `useUserRole()` + `canEdit/canCreate/canDelete`.

### Tier C — Auth API (server)

**`app/api/auth/customer/route.ts`** (`POST`) — *resolve current customer from a token.*
- Service-role. `auth.getUser(accessToken)` → look up `customers` by `id`; **fallback by
  lowercased `email`** (handles id/auth mismatches). `active===false` → `403` "Account
  deactivated". Returns `{customer}` (may be null).
- **This is the hydration endpoint** used by both `CustomerContext` and the admin layout.
- Tables: `customers` (read).

### Tier D — Customer-facing pages (`app/(customer)/`)

Each wraps content in `<Suspense>` (they use `useSearchParams`) + `<Navigation/>` + `<Footer/>`.

| Open | What it does | DB / auth touch |
|------|--------------|-----------------|
| `login/page.tsx` | Email+password sign-in via `signInCustomer`; `?redirect=` (default `/products`); re-checks `active`; `PeptideLoader` then hard redirect after ~2.5s. | `auth.signInWithPassword`, reads `customers.active` |
| `signup/page.tsx` | Full signup form — **disabled** (`notFound()` at line 263). Calls `signUpCustomer` when enabled. | `auth.signUp` + insert `customers` |
| `forgot-password/page.tsx` | Sends Supabase recovery email; always shows success (never reveals account existence). | `auth.resetPasswordForEmail` |
| `account/set-password/page.tsx` | 4 states (loading / invalid-link / done / form). Validates with `validatePassword`; `auth.updateUser({password})` → `refreshCustomer()` → redirect. | `auth.updateUser`, then re-reads `customers` |
| `account/dashboard/page.tsx` | Account home: orders list + editable profile + editable shipping address + "Go to Admin Dashboard" (if admin/assistant) + logout. Edits call `updateCustomer`. | reads `orders`/`order_items` (Cluster 4); updates **own** `customers` row via anon client (RLS-allowed) |

**`lib/customer/api.ts`** — *the customer-side data layer behind those pages.*
- `signUpCustomer`, `signInCustomer` (blocks deactivated → signs back out; self-heals a missing
  profile from auth metadata), `signOutCustomer`, `getCurrentSession`, `getCustomer(id)`,
  `updateCustomer(id, updates)`, plus `getCustomerOrders`/`getOrderWithItems`/`createOrder` (those
  last three belong to Cluster 4 — note the seam). Intricacy: `signUpCustomer` has a
  referral-code→`affiliate_id` first-touch block (Cluster 8 — strip if not porting).

### Tier E — Admin: Customers management

**Page:** `app/(admin)/admin/customers/page.tsx` (+ `_components/CreateCustomerModal.tsx`,
`EditCustomerModal.tsx`, `DeleteCustomerDialog.tsx`).
- Table: name/email, phone, joined, role badge, **Delivery** toggles (Ship/Pickup →
  `updateCustomerFulfillment`), **Actions** (Login Link, Edit, Make/Remove Admin, Delete).
- **Create flow intricacy:** "New Customer" with login = `POST /api/admin/customers
  {create_login:true}` (passwordless), **then** `POST /api/admin/customers/magic-link
  {redirect_path:'/account/set-password'}` — i.e. create + invite are two calls.
- No toast library — uses native `alert()` + inline button states.

**API:** `app/api/admin/customers/`
| Route | Method | Behavior / DB | Auth |
|-------|--------|---------------|------|
| `route.ts` | GET | list `customers` (joins `bound_affiliate` — strip) ordered by `created_at desc` | reject `customer` role |
| `route.ts` | POST | **login path:** `auth.admin.createUser({email_confirm})` → insert `customers` (id=auth uid, role `customer`, `email_verified=autoConfirm`); **rollback** auth user if insert fails; dup email→409. **guest path:** insert profile only, synth `guest+<ts>@aminocan.local`. | admin (affiliate—strip) |
| `[id]/route.ts` | PUT | `hasAuthUser()` check; `active`→ban/unban; `email`/`password`→`auth.admin.updateUserById`; always update `customers` (+`is_admin` synced to role). Guests skip auth steps. | **admin only** |
| `[id]/route.ts` | DELETE | delete `customers` row, then best-effort `auth.admin.deleteUser`. | **admin only** |
| `magic-link/route.ts` | POST | validate (not found→404, deactivated→400, guest/`@aminocan.local`→400), whitelist `redirect_path` to {`/account/dashboard`,`/admin`,`/account/set-password`}, call `sendSupabaseMagicLink`. Maps rate-limit→429. | non-customer |
| `report/route.ts` | GET | CSV/HTML export of customers. | admin/assistant |

### Tier F — Admin: Users (staff) management

**Page:** `app/(admin)/admin/users/page.tsx` (+ `_components/CreateUserModal.tsx`,
`EditUserModal.tsx`, `DeleteConfirmDialog.tsx`).
- Same `customers` table, staff-oriented view. Filters (search/role/status), stat chips,
  Add/Edit/toggle-active/Delete gated by `canCreate`/`canEdit`/`canDelete`.

**API:** `app/api/admin/users/`
| Route | Method | Behavior / DB |
|-------|--------|---------------|
| `route.ts` | POST | `verifyAdmin` (admin only); `auth.admin.createUser({email_confirm:true})` → insert `customers` {role, `is_admin=role==='admin'`, `email_verified:true`}; **rollback** auth user on insert failure. |
| `[id]/route.ts` | PUT | order matters: (1) `active`→ban/unban, (2) `email`/`password`→update auth, (3) update `customers` (+`is_admin` sync). |
| `[id]/route.ts` | DELETE | delete `customers` row then `auth.admin.deleteUser` (non-fatal). Also clears affiliate/referral/commission/sales links. |

**`lib/admin/api.ts`** (the user/customer CRUD wrappers): `getUsers(filters)`, `createUser`,
`updateUser`, `deleteUser(hard?)` (hard→DELETE, soft→PUT `{active:false}`), `toggleUserActive`.
All attach the current session's bearer token. `verifyAdmin` pattern: bearer → `auth.getUser` →
look up `customers.role` by `id` **then fallback `email`** → require `admin`.

---

## 4. End-to-end flows to trace (verifies you've extracted everything)

1. **Admin invites a customer:** Customers page → `POST /api/admin/customers {create_login}` →
   `POST .../magic-link {redirect_path:'/account/set-password'}` → Supabase emails link → recipient
   lands on `/account/set-password` (hash tokens auto-detected) → `auth.updateUser({password})` →
   `refreshCustomer()` → dashboard. **DB:** insert `customers` (+`auth.users`), no password until set.
2. **Self login:** `/login` → `signInCustomer` (`auth.signInWithPassword`) → re-check `active` →
   `onAuthStateChange(SIGNED_IN)` → deferred `refreshCustomer` → `POST /api/auth/customer` hydrates.
3. **Deactivation:** PUT `{active:false}` → `auth.admin.updateUserById(ban_duration:'876600h')` +
   `customers.active=false`; login flows also re-check `active` and force sign-out. Reactivate →
   `ban_duration:'none'`.
4. **Role change & sync:** any route setting `role` also sets `is_admin=(role==='admin')`; the
   Customers "Make Admin" toggle flips `is_admin` directly. Treat `role` as authoritative.
5. **Audit:** sensitive mutations call `logAuditServer` (currently wired in Invoices/Pricelists/
   Warehouse, *not* user routes — an extension point). Reads gated by RLS to admin/assistant.

---

## 5. Extraction checklist & gotchas

- [ ] Recreate `user_role` enum + `customers` table **by hand** (not in committed SQL), then run the
      4 alter/RLS/audit migrations.
- [ ] `customers.id` MUST equal `auth.users.id`; always create the auth user **first**, insert the
      profile with that id, and **roll back** the auth user if the insert fails (both POST routes do this).
- [ ] Keep the **service-role on server / anon in browser** split; every admin route re-verifies role
      server-side (UI gating is defense-in-depth, not the boundary).
- [ ] Preserve `verifyAdmin`'s id→email fallback.
- [ ] Never `await` inside `onAuthStateChange` — keep the `setTimeout(…,0)` deferral.
- [ ] Handle **guest customers** everywhere (no auth user, `@aminocan.local`): `hasAuthUser` checks,
      magic-link refusal.
- [ ] `logAuditServer` must swallow errors.
- [ ] Bootstrap the first admin via SQL (`UPDATE customers SET role='admin', is_admin=true WHERE
      email='…';`) — no UI can mint the first admin.
- [ ] Decide on self-signup: it's disabled via `notFound()`. Re-enable only deliberately.
- [ ] If **not** porting affiliates/warehouse: drop those enum values, `affiliate_id` /
      `can_send_fulfillment_emails` columns, the `bound_affiliate` joins, affiliate scoping branches,
      `AFFILIATE_PAGES`/`isAffiliate`, and affiliate nav items. See the STRIP lists in docs 05 §"Porting
      notes" and 06 §"Porting notes".

---

## 6. File index (everything in Cluster 1)

```
DB        customer-auth-migration.sql, admin-migration.sql,
          supabase-auth-integration.sql, audit-log-migration.sql
          (+ hand-created: user_role enum, customers base table)
libs      lib/supabase.ts, lib/password.ts, lib/permissions.ts (+ .test.ts),
          lib/hooks/usePermissions.ts, lib/admin/audit.ts, lib/admin/magic-link.ts,
          lib/customer/api.ts, lib/admin/api.ts (user/customer CRUD portion)
session   contexts/CustomerContext.tsx, components/RouteGuard.tsx, auth.config.js
gate      app/(admin)/admin/layout.tsx
auth API  app/api/auth/customer/route.ts
cust UI   app/(customer)/{login,signup,forgot-password}/page.tsx
          app/(customer)/account/{set-password,dashboard}/page.tsx
admin UI  app/(admin)/admin/customers/page.tsx + _components/{Create,Edit,Delete}*.tsx
          app/(admin)/admin/users/page.tsx     + _components/{Create,Edit,Delete}*.tsx
admin API app/api/admin/customers/{route,[id],magic-link,report}.ts
          app/api/admin/users/{route,[id]}.ts
config    MAGIC-LINK-SETUP.md, SUPABASE-AUTH-INTEGRATION.md (Supabase SMTP + redirect allowlist)
```

**Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only — required for all `auth.admin.*`), `NEXT_PUBLIC_BASE_URL`
(builds magic-link `emailRedirectTo`).
**Supabase dashboard:** custom SMTP, "Magic Link" email template with `{{ .ConfirmationURL }}`, and a
redirect allowlist including `/account/set-password`, `/account/dashboard`, `/admin` (prod + localhost).
