# Affiliate Program (+ Sales-People / Commissions) — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `supabase-schema.sql` (affiliates/referral_codes/commissions + triggers),
> `affiliate-program-migration.sql`, `affiliate-discount-commission-migration.sql`,
> `affiliate-pricelist-migration.sql`, `invoice-sales-features-migration.sql`;
> `lib/affiliate/{commission,referral,api,utils}.ts`, `lib/admin/sales-persons.ts`;
> routes `app/api/affiliate/{me,commissions}`, `app/api/affiliate-requests`,
> `app/api/admin/{affiliates,affiliate-requests,affiliate-performance,sales-persons}/*`;
> `components/ReferralCapture.tsx`; and the affiliate portal + admin pages.
> Stack: **Next.js 15 App Router** + **Supabase** (service-role; DB triggers) + **Tailwind**.
>
> Describes the code **as it exists**. This is the **optional, most-entangled** cluster — every other
> cluster has affiliate touchpoints. §8 is a consolidated **STRIP map** for a sibling site without a
> partner program.

---

## 0. The standout intricacy: an affiliate is FOUR coordinated rows

Creating/approving one affiliate provisions **four rows under the same `id` (the auth user id)**:

1. **`affiliates`** row (payout/earnings record).
2. **`customers`** row with `role='affiliate'` (so they sign into `/admin`).
3. **`sales_persons`** row linked via `user_id` (so they auto-lock as the invoice sales-rep).
4. **`referral_codes`** row (their 8-char code).

All four share the same UUID (`affiliates.id == customers.id == sales_persons.user_id == auth.users.id`).
Both creation paths (admin direct-create and approve-a-request) provision all four; a rebuild that
creates only some of them will half-break the affiliate (e.g. can't sign in, or invoices won't credit
them).

Other key behaviors:
- **Attribution priority:** bound customer (`customers.affiliate_id`) **>** referral code; **self-referral
  blocked** (an affiliate can't pay themselves).
- **10% discount / 10% commission:** customer gets 10% off the product subtotal; affiliate earns 10% of
  the **discounted** subtotal.
- **First-touch persistence:** `?ref=CODE` stored in localStorage **+ a 10-year cookie**, never
  overwritten.
- **Trigger-maintained counters:** `referral_codes.uses_count` (on commission insert) and
  `affiliates.total_earnings` (on commission → paid) are DB-trigger maintained — app code never bumps
  them.
- **Two-ledger earnings merge:** an affiliate's portal merges **affiliate `commissions`** (orders via
  their code/binding) **+** their linked sales-person's **`sales_commissions`** (invoices they're on).

---

## 1. Overview

A partner program layered over the whole app. Customers become affiliates by **applying**
(`affiliate_requests` → admin approves) or by **admin direct-create**; either way the four-row model is
provisioned. Affiliates have an 8-char referral code; a `?ref=` link is captured first-touch (cookie +
localStorage) and bound to the visitor's account at signup or first order. When an order is attributed
(bound customer or code), the customer gets 10% off and the affiliate earns a 10% commission
(`commissions`); separately, because the affiliate is also a `sales_persons` record, invoices they're on
generate `sales_commissions`. Their dashboard merges both ledgers. Affiliates operate inside `/admin`
over a **restricted page set** (orders/invoices/customers/pricing/products, read-only catalog),
scoped server-side to their bound customers. They also own a per-affiliate price list
(`affiliate_price_overrides`) copied into their customers' overrides (Cluster 4 seam). The affiliate
also drives the **sales-people / commissions** sub-feature, which stays even if the affiliate program is
stripped (sales reps are independent of partners).

---

## 2. Schema

### `affiliates` / `referral_codes` / `commissions` (`supabase-schema.sql`)
```sql
CREATE TABLE affiliates (
  id uuid PK DEFAULT gen_random_uuid(),         -- set to the auth user id on create
  email varchar UNIQUE NOT NULL, first_name varchar NOT NULL, last_name varchar NOT NULL,
  wallet_address varchar(42), password_hash text NOT NULL,   -- legacy; '' for auth-backed
  active boolean DEFAULT true, total_earnings numeric(10,2) DEFAULT 0,   -- trigger-maintained
  created_at, updated_at
);
CREATE TABLE referral_codes (
  id uuid PK, affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  code varchar(8) UNIQUE NOT NULL, active boolean DEFAULT true,
  uses_count integer DEFAULT 0,                  -- trigger-maintained
  created_at
);
CREATE TABLE commissions (
  id uuid PK, affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id varchar NOT NULL, referral_code_id uuid REFERENCES referral_codes(id),
  amount numeric(10,2) NOT NULL, order_total numeric(10,2) NOT NULL,
  commission_rate numeric(5,2) DEFAULT 10.00,
  status varchar DEFAULT 'pending' CHECK (in 'pending','paid','cancelled'),
  paid_at, created_at
);
```
**Triggers (DB-maintained — never bump these in app code):**
- `increment_code_on_commission_created` (AFTER INSERT on commissions): `uses_count += 1` when
  `referral_code_id` set.
- `update_earnings_on_commission_paid` (AFTER UPDATE on commissions): `affiliates.total_earnings +=
  amount` when status flips to `paid`.
- `update_affiliates_updated_at`.
RLS exists but is permissive/legacy (the program runs through service-role API routes).

### `affiliate-program-migration.sql` (the wiring)
- `ALTER TYPE user_role ADD VALUE 'affiliate'` (run alone).
- `customers.affiliate_id uuid REFERENCES affiliates(id) ON DELETE SET NULL` (+ partial index) — the
  first-touch binding.
- `sales_persons.user_id uuid REFERENCES customers(id) ON DELETE SET NULL` (+ **unique** partial index)
  — links a sales-person to the affiliate's account (invoice auto-lock).
- **`affiliate_requests`** `(id, customer_id FK CASCADE, status CHECK pending|approved|denied,
  wallet_address, message, reviewed_by, reviewed_at, created_at)` + **unique partial index** (one
  `pending` per customer). RLS: admin/assistant SELECT; writes via service role.

### `affiliate-discount-commission-migration.sql`
- `orders.discount_amount numeric(10,2) DEFAULT 0` (the affiliate discount stored on the order).

### `affiliate-pricelist-migration.sql` (Cluster 4)
- `affiliate_price_overrides (affiliate_id, product_id, override_price, UNIQUE(affiliate_id,
  product_id))` — the client's price list copied into bound customers' overrides.

### `invoice-sales-features-migration.sql` (the sales-people sub-feature — STAYS)
- `sales_persons (id, first_name, last_name, email, phone, commission_rate DEFAULT 5.00, notes, active,
  total_earnings, …)`.
- `invoices.sales_person_id` (+ commission rate/amount snapshot columns).
- `sales_commissions (id, sales_person_id FK CASCADE, invoice_id FK SET NULL, amount, invoice_total,
  commission_rate, status CHECK pending|paid|cancelled, paid_at, created_at)`. RLS: admin/assistant
  read, admin write.

### Schema usage map

| Table | Read by | Written by |
|---|---|---|
| `affiliates` | admin affiliates page/report, affiliate portal | create/approve (insert), `[id]` PATCH; `total_earnings` by trigger |
| `referral_codes` | attribution, `code` page, report | create/approve (insert); `uses_count` by trigger |
| `commissions` | affiliate portal, reports | order POST (Cluster 5 insert), admin pay actions |
| `customers.affiliate_id` | attribution, scoping | order first-touch bind, customer auto-bind (Cluster 1) |
| `affiliate_requests` | admin pending list, apply | apply (insert), approve/deny PATCH |
| `sales_persons` (`user_id`) | invoice auto-lock, affiliate scoping, two-ledger | create/approve (insert) |
| `sales_commissions` | invoice (Cluster 6), affiliate portal, reports | invoice create/PATCH (Cluster 6) |
| `affiliate_price_overrides` | `applyAffiliatePricelist` | price-import (Cluster 4) |

---

## 3. Components

### Economics — `lib/affiliate/commission.ts`
- `AFFILIATE_DISCOUNT_RATE = 0.1`, `AFFILIATE_COMMISSION_RATE = 0.1`, `round2`.
- **`resolveAffiliateAttribution(db, {customerId, referralCode})`** → `{affiliateId, referralCodeId,
  viaCode} | null`. Priority: (1) bound customer (`customers.affiliate_id`, skip if it equals the
  customer — self), crediting the affiliate's active code if any (`viaCode:false`); (2) referral code
  (active, `affiliate_id !== customerId`, `viaCode:true`). Used by both order routes (Cluster 5).

### First-touch capture — `lib/affiliate/referral.ts` + `ReferralCapture`
- `REF_KEY='aminocan_ref'`, `REF_MAX_AGE = 10 years`, format `/^[A-Z0-9]{8}$/`.
- `captureReferralFromUrl()` — reads `?ref=`, uppercases, validates, and stores in **both** localStorage
  and a 10-year `SameSite=Lax` cookie — **only if nothing is stored** (first-touch, never overwrite).
- `getStoredReferral()` (localStorage → cookie fallback), `clearStoredReferral()`.
- `ReferralCapture` — invisible client component (`useEffect(captureReferralFromUrl)`), mounted app-wide.

### Admin direct-create — `POST /api/admin/affiliates` (the four-row provision)
admin-only. (1) `auth.admin.createUser` (email auto-confirmed; password optional → random 24-byte
throwaway); (2) sha256 `password_hash` (legacy compat); (3) insert **`affiliates`** `{id: userId, …}`
(rollback the auth user on failure); (4) generate a **unique 8-char `referral_codes`** (retry ×10);
(5) **upsert `customers`** `{id, role:'affiliate', email_verified:true}` + insert **`sales_persons`**
`{user_id}` if none. Returns `{affiliate_id}`. The Add-Affiliate dialog then emails a set-up link
(`/account/set-password`).

### Apply → approve/deny
- **`POST /api/affiliate-requests`** — a signed-in customer applies (inserts `affiliate_requests`
  pending; one open per customer via the unique index). Notifies admins (Cluster 2
  `sendAffiliateRequestAdminNotification`).
- **`PATCH /api/admin/affiliate-requests/[id]`** `{action:'approve'|'deny'}` — admin-only.
  **Deny:** mark denied + stamp reviewer + email decision. **Approve (the four-row provision):**
  (1) promote `customers.role='affiliate'`; (2) upsert **`affiliates`** (`id == customer.id`,
  `password_hash:''`); (3) `createUniqueReferralCode` (reuse if one exists); (4) insert **`sales_persons`**
  `{user_id}` if none; (5) mark request approved + stamp; (6) email approval w/ the code (Cluster 2
  `sendAffiliateRequestDecision`).

### Affiliate portal API
- **`GET /api/affiliate/me`** — the caller's affiliate + linked sales-person (used by the portal +
  `InvoiceForm` to lock the sales person, Cluster 6).
- **`GET /api/affiliate/commissions`** (the two-ledger merge) — affiliate-only. Pulls
  **`commissions`** (`source:'referral'`, base=`order_total`) **and**, via the linked
  `sales_persons.user_id`, **`sales_commissions`** (`source:'sales'`, base=`invoice_total`), merges +
  sorts newest-first, and returns `totals {paid, pending, total}`.

### Admin management
- **`GET/PUT/DELETE /api/admin/affiliates/[id]`**, list page + `CreateAffiliateModal` /
  `EditAffiliateModal` / `DeleteAffiliateDialog` / `PendingAffiliateRequests`.
- **`GET /api/admin/affiliate-performance`** — per-affiliate rollup.
- **`GET /api/admin/affiliates/report`** + **`/api/admin/commissions/report`** (merges affiliate +
  sales commissions) — Cluster 9.
- **Sales-people:** `GET/POST /api/admin/sales-persons` (+ `[id]`), `lib/admin/sales-persons.ts` —
  independent of the partner program (a sales rep need not be an affiliate).

### Affiliate portal pages (`app/(affiliate)/affiliate/*`)
`apply`, `login`, `signup`, `dashboard` (earnings from the two-ledger merge), `code` (share link),
`settings`. Gated by role `affiliate` (and the admin layout admits affiliates to the restricted page
set — Cluster 1).

---

## 4. UI/UX design overview

Standard admin/portal theme (`ink #1A1A1A`, `bronze #9C8B5A`, `surface #F7F7F7`, `line #C9CCD1`;
`lucide-react`). The admin role eyebrow renders **"Client"** for the `affiliate` role (Cluster 1);
the affiliate badge is `bg-emerald-500/10 text-emerald-500` (`getRoleBadgeClasses`). Affiliate portal
pages reuse the auth-card recipe (`bg-white rounded-xl border border-line shadow-sm`); the dashboard
shows merged commission rows (referral vs sales source) with `pending`/`paid` totals; the `code` page
surfaces the share link (`?ref=CODE`). Reports use the shared self-printing `report-html.ts` shell
(Cluster 9). Affiliate decision/welcome emails are branded SMTP sends (Cluster 2).

---

## 5. Data flow & behavior

### Onboarding (two paths, both → four rows)
- **Apply:** customer → `POST /api/affiliate-requests` (pending) → admin approve → role + affiliates +
  code + sales_person provisioned → approval email.
- **Direct-create:** admin → `POST /api/admin/affiliates` → auth user + affiliates + code + customers
  (role) + sales_person → set-password email.

### Attribution + discount + commission (Cluster 5 order POST)
`resolveAffiliateAttribution` (bound > code, self blocked) → `discount_amount = round2(subtotal·0.10)`,
`discountedSubtotal` → insert `commissions` `amount = round2(discountedSubtotal·0.10)` (error-wrapped) →
**first-touch bind** (set `customers.affiliate_id` when via code and not already bound). The insert
fires the `uses_count` trigger; later marking the commission `paid` fires the `total_earnings` trigger.

### Sales-person ledger (Cluster 6)
Because the affiliate is a `sales_persons` row, invoices they're on snapshot a commission rate/amount
and write `sales_commissions`. The affiliate's portal merges these with their referral commissions.

### First-touch persistence
`ReferralCapture` stores `?ref=` (cookie + localStorage, 10yr, never overwritten); consumed at signup
(`signUpCustomer` referral binding, Cluster 1) and first order (Cluster 5 bind).

### Scoping (server-side)
Affiliates only ever see their bound customers / own sales-person invoices — enforced in the invoice,
customer, price-override, and aging routes (Clusters 1/4/6) via `affiliate_id`/`sales_persons.user_id`.

---

## 6. Edge cases & states

- **Self-referral:** ignored in attribution (no discount/commission).
- **Duplicate pending request:** blocked by the unique partial index.
- **Approve an already-reviewed request:** 409.
- **Referral-code collision:** retried up to 10×; create proceeds even if no code lands (rare).
- **Affiliate row insert fails (direct-create):** the auth user is rolled back.
- **Counters:** `uses_count`/`total_earnings` are trigger-only — don't double-count in app code.
- **`password_hash`:** NOT NULL but unused for auth-backed affiliates (`''` / sha256 of a throwaway).
- **Two-ledger merge with no sales-person:** referral commissions only.

---

## 7. Open questions & unverified items

- **`commissions.order_id` is `varchar`** (not a uuid FK to `orders`) — a loose reference; the portal
  slices the first 8 chars for display. Confirm before tightening.
- **`affiliates.id` uniqueness with `customers.id`:** both are set to the auth user id by app code, but
  there's no DB-level constraint tying them — the invariant is code-enforced.
- **Apply route** (`POST /api/affiliate-requests`) captured at behavior level (inserts a pending
  request + admin notify); exact body validation not transcribed.
- **Affiliate portal pages + admin affiliate modals** captured at the structural level (routes, data
  calls, the role gate) rather than line-by-line.
- **Sales-people sub-feature stays** even if the partner program is stripped — `sales_persons` /
  `sales_commissions` / `invoices.sales_person_id` are independent (a rep need not be an affiliate).
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes); SMTP vars
  (decision/welcome emails, Cluster 2).

---

## 8. Consolidated STRIP map (remove the partner program cleanly)

Every affiliate touchpoint across the other ten clusters, for a sibling site **without** a partner
program. Keep the **sales-people / commissions** sub-feature (it's independent).

### Database
- `user_role` enum: drop the `'affiliate'` value (Cluster 1).
- Drop tables `affiliates`, `referral_codes`, `commissions`, `affiliate_requests`,
  `affiliate_price_overrides`; their triggers (`increment_code_usage`, `update_affiliate_earnings`).
- `customers.affiliate_id` column + index (Cluster 1). `orders.discount_amount` column (Cluster 5).
- `sales_persons.user_id` column + unique index (the affiliate↔rep link) — **keep `sales_persons`
  itself**.

### Cluster 1 — Auth / RBAC
- `lib/permissions.ts`: remove `'affiliate'` from `UserRole`, `isAffiliate`, `AFFILIATE_PAGES`, the
  affiliate branches in `canAccessAdmin`/`canAccessAdminPage`/`canViewInvoices`/`canEditInvoice`, and
  the affiliate entries in `getRoleName`/`getRoleBadgeClasses`.
- Admin layout: drop the **Affiliates / Commissions** nav items + the `'Client'` eyebrow branch.
- `RouteGuard.PUBLIC_PATHS`: drop `/affiliate/login`, `/affiliate/signup`. Login footer "affiliate
  login" link; signup "become an affiliate" link; set-password `destination` affiliate branch.
- `/api/admin/customers`: drop the affiliate auto-bind, `applyAffiliatePricelist`, the magic-link
  affiliate scoping, and the `affiliate`-role branches; `/api/admin/users/[id]` DELETE affiliate cleanup.

### Cluster 3 — Products
- `/api/admin/products` GET: drop the affiliate read-only allowance.

### Cluster 4 — Pricing
- Drop `affiliate_price_overrides` + the affiliate seam in `/api/admin/price-overrides/import` +
  `applyAffiliatePricelist`; remove the affiliate branches/scoping in the override routes.

### Cluster 5 — Orders
- Drop `resolveAffiliateAttribution`, the discount math, the `commissions` insert + first-touch bind,
  and `orders.discount_amount` usage. `signUpCustomer` referral-binding block; `ReferralCapture` mount;
  `lib/affiliate/referral.ts`.

### Cluster 6 — Invoices
- `lib/admin/invoice-access.ts` (affiliate scoping) + the affiliate branches in the invoice routes;
  `canEditInvoice` affiliate grant. **Keep** the `sales_person`/`sales_commissions` snapshot.

### Cluster 9 — Analytics
- Drop `/api/admin/affiliates/report`; in `/api/admin/commissions/report` keep the `sales_commissions`
  half and drop the affiliate `commissions` half.

### Whole cluster
- Delete `app/(affiliate)/*`, `app/api/affiliate/*`, `app/api/affiliate-requests`,
  `app/api/admin/affiliates/*`, `app/api/admin/affiliate-requests/*`,
  `app/api/admin/affiliate-performance`, `lib/affiliate/*`, the affiliate admin modals, and the
  affiliate emails (`sendAffiliateRequest*` in Cluster 2). **Keep** `app/api/admin/sales-persons/*` +
  `lib/admin/sales-persons.ts`.
