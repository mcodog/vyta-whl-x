# Cluster 8 — Client / Affiliate Program (OPTIONAL): Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 8 so you can extract it
> completely — *or* cleanly strip it. For each piece: *what to open*, *what it does*, *its
> intricacies*, and *exactly how it touches the database*. **Optional & most-entangled:** a sibling
> site without a partner program drops this whole cluster; this guide doubles as the **strip map**
> consolidating every "STRIP affiliate" note from the other ten guides.
>
> **Companion deep specs:** `AFFILIATE_SETUP.md`, `AFFILIATE_SYSTEM_SUMMARY.md`. The
> `docs/module-ports/` set deliberately **excludes** this program.

---

## 1. What the cluster is / does

"Clients" = **affiliates**: B2B partners/resellers who refer customers, earn commissions, get their
own discounted pricing, and operate a scoped slice of `/admin`. The program provides:
- **Onboarding** — customer application → admin approve/deny, *or* admin direct-create.
- **Referral codes** + first-touch attribution → **customer discount (10%)** + **affiliate
  commission (10%)** on orders.
- A **minimized dashboard** inside `/admin` (earnings, bound customers, referral link).
- **Scoped admin access** to their own customers' orders/invoices/customers + read-only products/pricing.
- An **affiliate custom pricelist** copied to bound customers (the Cluster 3 `affiliate_price_overrides`).

### ⚠️ The core intricacy: an affiliate is THREE rows at once
When created, an affiliate becomes simultaneously:
1. an **`affiliates`** row (legacy standalone table, has its own `password_hash`/`total_earnings`),
2. a **`customers`** row with `role='affiliate'` (the unified auth identity used for login + RBAC), and
3. a linked **`sales_persons`** row (so the affiliate can also be an invoice sales-rep and earn
   *sales* commissions).
Plus a **`referral_codes`** row. Keep all four in sync on create/edit/delete.

---

## 2. Database schema — what exists and where it comes from

### `affiliates`, `referral_codes`, `commissions` (`supabase-schema.sql`)
- **`affiliates`**: `id`, `email UNIQUE`, `first_name`, `last_name`, `wallet_address` (ETH payout),
  `password_hash` (legacy), `active`, `total_earnings`, timestamps.
- **`referral_codes`**: `id`, `affiliate_id → affiliates ON DELETE CASCADE`, **`code VARCHAR(8)
  UNIQUE`**, `active`, **`uses_count`**, `created_at`.
- **`commissions`**: `id`, `affiliate_id → affiliates ON DELETE CASCADE`, **`order_id VARCHAR`**
  (note: text, references the orders system loosely), `referral_code_id → referral_codes`, `amount`,
  `order_total`, **`commission_rate DEFAULT 10.00`**, **`status CHECK ('pending','paid','cancelled')`**,
  `paid_at`, `created_at`.
- **Triggers (in `supabase-schema.sql`):** `increment_code_usage` (on commission insert →
  `referral_codes.uses_count++`) and a trigger bumping `affiliates.total_earnings` when a commission
  flips to `paid`.
- RLS: public read on referral_codes (for code validation); permissive inserts (signup-era).

### `affiliate_requests` + the enum/bindings (`affiliate-program-migration.sql`)
- **`ALTER TYPE user_role ADD VALUE 'affiliate'`** (must run outside a txn).
- **`customers.affiliate_id → affiliates ON DELETE SET NULL`** + index (the binding that scopes a
  customer to an affiliate).
- **`sales_persons.user_id → customers`** (links the affiliate's sales-person row to their login).
- **`affiliate_requests`**: `id`, `customer_id → customers ON DELETE CASCADE`, **`status CHECK
  ('pending','approved','denied')`**, `wallet_address`, `message`, `reviewed_by → customers`,
  `reviewed_at`, partial unique index (one pending per customer). RLS: admin read.

### `orders.discount_amount` (`affiliate-discount-commission-migration.sql`) + `affiliate_price_overrides` (Cluster 3)
The order discount column and the affiliate pricelist table (UNIQUE `(affiliate_id, product_id)`,
copied into `customer_price_overrides` on bind).

---

## 3. The reading map (open files in this order)

### Tier A — Domain libs
- `lib/supabase.ts` → `Affiliate`, `ReferralCode`, `Commission` types; `UserRole` includes `'affiliate'`.
- **`lib/affiliate/commission.ts`** — **`AFFILIATE_DISCOUNT_RATE = 0.1`**, **`AFFILIATE_COMMISSION_RATE
  = 0.1`**, **`resolveAffiliateAttribution(db, {customerId, referralCode})`** (priority: bound
  `customers.affiliate_id` > referral code; **self-referral blocked** `rc.affiliate_id !== customerId`),
  `round2`.
- **`lib/affiliate/referral.ts`** — first-touch capture: `captureReferralFromUrl()` (writes
  localStorage + **10-year cookie**, never overwrites an existing code), `getStoredReferral`,
  `clearStoredReferral`.
- **`lib/affiliate/utils.ts`** — `generateReferralCode()` (8-char, ambiguity-free),
  `calculateCommission`, `isValidReferralCodeFormat`, `hashPassword`, wallet/email validators.
- **`lib/affiliate/api.ts`** — `createAffiliate`, `loginAffiliate` (legacy), `getAffiliate`,
  `updateAffiliate`, `createReferralCode`, `getReferralCodes`, `validateReferralCode`.
- `contexts/AffiliateContext.tsx` (legacy session — mostly superseded by Supabase auth).

### Tier B — Onboarding

**`app/api/affiliate-requests/route.ts`** — customer submits (`POST`, blocks if already affiliate,
one pending per customer) → emails admins (`sendAffiliateRequestAdminNotification`, Cluster 10); `GET`
returns the caller's request state. UI: `app/(affiliate)/affiliate/apply/page.tsx`.

**`app/api/admin/affiliate-requests/[id]/route.ts`** (`PATCH approve|deny`) — on approve: provision
affiliate + code (+ the 3-row identity) and email decision; on deny: email + mark `denied`. Sets
`reviewed_by`/`reviewed_at`. `app/api/admin/affiliate-requests/route.ts` lists pending. UI:
`app/(admin)/admin/affiliates/_components/PendingAffiliateRequests.tsx`.

**`app/api/admin/affiliates/route.ts`** (`POST`) — *admin direct-create (the canonical 4-row write):*
`auth.admin.createUser` (password optional → magic-link onboarding) → insert **`affiliates`** → unique
**`referral_codes`** → upsert **`customers`** `role:'affiliate'` → insert **`sales_persons`**. `[id]`
route = edit/delete/toggle. UI: `app/(admin)/admin/affiliates/page.tsx` + `_components/{Create,Edit,
Delete}*`.

### Tier C — Referral → commission (the order seam, Cluster 4)
`app/api/orders-email/route.ts` (and the disabled `/api/orders`): `resolveAffiliateAttribution` →
`discount_amount = subtotal × 10%` → insert **`commissions`** (`amount = discountedSubtotal × 10%`,
`pending`) → **first-touch bind** (`customers.affiliate_id = …` when via code). Error-wrapped.

### Tier D — Affiliate portal (inside /admin)
- **`app/api/affiliate/me/route.ts`** — dashboard summary: bound-customer count, active referral code,
  and **merged earnings** (referral `commissions` + the linked sales-person's `sales_commissions`).
- **`app/api/affiliate/commissions/route.ts`** — full commission ledger (both sources).
- UI: `app/(admin)/admin/_components/AffiliateDashboard.tsx` (rendered as the `/admin` home when
  `role==='affiliate'`). Legacy `app/(affiliate)/affiliate/{dashboard,code,login,settings,signup}`
  mostly redirect into `/login?redirect=/admin`.

### Tier E — Scoped admin access (the RBAC slice)
- `lib/permissions.ts` → **`AFFILIATE_PAGES`** (`/admin`, `/admin/orders`, `/admin/invoices`,
  `/admin/customers`, `/admin/pricing`, `/admin/products`), `canAccessAdminPage` (affiliate subset),
  `isAffiliate`, `canViewInvoices`/`canEditInvoice` (admit affiliate).
- Server-side scoping branches: `app/api/admin/customers/route.ts` (`affiliate_id` filter +
  `applyAffiliatePricelist`), `app/api/admin/orders/route.ts`, `lib/admin/invoice-access.ts`
  (`affiliateCustomerIds`, `affiliateSalesPersonId`, `affiliateCanAccessInvoice`), price-overrides
  routes (`affiliateOwnsCustomer`/`boundCustomerIds`).
- `app/api/admin/affiliates/report/route.ts` + `affiliate-performance/route.ts` — admin KPIs.

---

## 4. End-to-end flows to trace

1. **Apply → approve:** customer `POST /api/affiliate-requests` → admin `PATCH .../[id] approve` →
   4-row provision + code + magic link → affiliate logs in → `/admin` shows `AffiliateDashboard`.
2. **Referral order:** visitor `?ref=CODE` → `captureReferralFromUrl` (first-touch) → checkout →
   `resolveAffiliateAttribution` → 10% discount + `commissions` row + bind `customers.affiliate_id`.
3. **Earnings:** `/api/affiliate/me` merges referral `commissions` + sales `sales_commissions`;
   admin pays out via the unified commissions report (Cluster 9).
4. **Scoped work:** affiliate sees only their bound customers' orders/invoices/customers; products/
   pricing read-only; can create invoices for their customers (`canEditInvoice`).

---

## 5. The STRIP map — what to remove if NOT porting affiliates

Touchpoints in every other cluster (consolidated):
- **Cluster 1:** `user_role` enum `'affiliate'` value; `customers.affiliate_id` + index; affiliate
  branches in `/api/admin/customers/*` (list scoping, create bind, magic-link bind); `RouteGuard`
  `PUBLIC_PATHS` affiliate entries; `set-password` affiliate destination; `lib/permissions.ts`
  (`AFFILIATE_PAGES`, `isAffiliate`, affiliate branches in `canAccessAdmin*`/`canViewInvoices`/
  `canEditInvoice`, badge/name); admin nav `Affiliates` item.
- **Cluster 2/4:** `signUpCustomer` referral-bind block; the commission/discount block + first-touch
  bind in `/api/orders-email` & `/api/orders`; `orders.discount_amount`.
- **Cluster 3:** `affiliate_price_overrides` table; affiliate branch + `applyAffiliatePricelist` in
  customers route; affiliate path in the price-override import route.
- **Cluster 5:** affiliate scoping in invoice list/detail (`lib/admin/invoice-access.ts`,
  `canEditInvoice`), and the `role!=='affiliate'` commission-rate guard.
- **Cluster 9:** the `commissions` (affiliate) half of the unified report + its mark-paid path.
- **Cluster 10:** `sendAffiliateRequestAdminNotification`, `sendAffiliateRequestDecision`,
  `sendAffiliateWelcome` senders.
- **Cluster 11:** affiliate count + pending-commission figures in `getAdminStats`.
- Delete: `app/(affiliate)/*`, `app/api/affiliate*`, `app/api/admin/affiliate*`, `lib/affiliate/*`,
  `contexts/AffiliateContext.tsx`, `components/ReferralCapture.tsx`, the affiliate admin pages/components.

---

## 6. Extraction checklist & gotchas (if porting)

- [ ] `ALTER TYPE user_role ADD VALUE 'affiliate'` **must run outside a transaction** (its own migration step).
- [ ] An affiliate = **4 coordinated rows** (`affiliates` + `customers` role + `sales_persons` +
      `referral_codes`). The admin create route is the canonical write — replicate all four + the
      magic-link onboarding.
- [ ] Attribution priority: **bound customer > referral code**; **self-referral blocked**. Discount &
      commission are both **10%** on the *discounted* subtotal.
- [ ] First-touch referral persists in **localStorage + a 10-year cookie**; never overwrite an existing code.
- [ ] `referral_codes.uses_count` and `affiliates.total_earnings` are **trigger-maintained** — port
      the triggers, don't compute them in app code.
- [ ] `commissions.order_id` is **text** (loose ref), unlike `sales_commissions.invoice_id` (uuid FK).
- [ ] Affiliate earnings merge **two ledgers** (`commissions` + the linked sales-person's
      `sales_commissions`) — keep both in `/api/affiliate/me` + `/commissions`.
- [ ] Scoped access is enforced **server-side** (every affiliate-reachable admin route filters by
      `affiliate_id`/bound customers) AND client-side (`AFFILIATE_PAGES`). UI gating is not the boundary.
- [ ] The legacy `app/(affiliate)/*` pages mostly redirect to `/login?redirect=/admin`; the real
      portal is `AffiliateDashboard` inside `/admin`.

---

## 7. File index (everything in Cluster 8)

```
DB        supabase-schema.sql (affiliates, referral_codes, commissions + triggers),
          affiliate-program-migration.sql (user_role 'affiliate', customers.affiliate_id,
            sales_persons.user_id, affiliate_requests),
          affiliate-discount-commission-migration.sql (orders.discount_amount),
          affiliate-pricelist-migration.sql (affiliate_price_overrides — Cluster 3)
libs      lib/affiliate/{commission,referral,utils,api}.ts, contexts/AffiliateContext.tsx,
          lib/permissions.ts (AFFILIATE_PAGES + affiliate branches)
API       app/api/affiliate-requests/route.ts, app/api/affiliate/{me,commissions}.ts,
          app/api/admin/affiliates/{route,[id],report}.ts,
          app/api/admin/affiliate-requests/{route,[id]}.ts,
          app/api/admin/affiliate-performance/route.ts
          [seams: /api/orders-email, /api/admin/customers, /api/admin/price-overrides/import,
                  /api/admin/invoices/*, /api/admin/commissions/report]
UI        app/(affiliate)/affiliate/{apply,code,dashboard,login,settings,signup}/page.tsx,
          app/(admin)/admin/affiliates/page.tsx + _components/{CreateAffiliate,EditAffiliate,
            DeleteAffiliate,PendingAffiliateRequests}.tsx,
          app/(admin)/admin/_components/AffiliateDashboard.tsx,
          components/ReferralCapture.tsx
docs      AFFILIATE_SETUP.md, AFFILIATE_SYSTEM_SUMMARY.md
```

**Constants:** discount 10% / commission 10% (`lib/affiliate/commission.ts`). **Email senders:**
`sendAffiliateRequestAdminNotification`, `sendAffiliateRequestDecision`, `sendAffiliateWelcome`
(Cluster 10). **Seams into:** 1 (auth/RBAC), 2/4 (referral order), 3 (pricelist), 5 (invoice scope +
sales commission), 9 (commission report), 10 (emails), 11 (dashboard stats).
```
