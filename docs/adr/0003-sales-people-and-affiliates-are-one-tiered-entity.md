# 3. Sales people and affiliates are one tiered "sales person" entity

- **Status:** Accepted
- **Date:** 2026-07-30
- **Area:** People / CRM, Commissions, Access control
- **Related code:**
  - `app/(admin)/admin/sales-people/*` (merged management surface + detail page)
  - `app/(admin)/admin/affiliates/*` (folded in; the route redirects)
  - `app/api/admin/sales-persons/*`, `app/api/admin/affiliates/*`, `app/api/admin/affiliate-requests/*`, `app/api/admin/affiliate-performance`
  - `lib/admin/invoice-access.ts` (`bindCustomerToSalesPersonAffiliate`, `affiliateSalesPersonId`)
  - `invoice-sales-features-migration.sql` (`sales_persons`, `sales_commissions`), `affiliate-program-migration.sql` (`affiliates`, `commissions`, `referral_codes`, `sales_persons.user_id`)

## Context

The admin area had **two separate surfaces** for people who bring the business
customers:

- **`/admin/sales-people`** — a lightweight CRM record (`sales_persons`).
- **`/admin/affiliates`** — a partner with a login account (`affiliates` +
  `customers` + `referral_codes`).

But these are not two independent things. In the business:

- A **sales person** is someone who **introduced a customer and asked us to make
  the invoice for them** — they don't work in the system themselves.
- An **affiliate** is a **step up**: a sales person who is given a **login and a
  referral code** so they can **do it themselves** — create invoices for their
  own customers, and additionally earn referral commissions on storefront orders
  placed through their code.

The database already models the affiliate as *"a sales person with a login."* When
an affiliate is created (or a customer is approved as one), **three rows are
written that all share the same auth UUID**:

- `affiliates.id = customers.id = auth uid`
- `sales_persons.user_id = auth uid` (one linked sales-person row, enforced by the
  partial unique index `uniq_sales_persons_user_id`)

So every affiliate **already owns a `sales_persons` row**. Because the Sales
People page listed *all* `sales_persons` (including those linked rows), **the same
person appeared on both pages** — the source of the confusion. Meanwhile the two
records could **drift**: editing an affiliate's name didn't sync to their
sales-person row, and vice-versa; and an affiliate's *invoice* commission rate
(on their `sales_persons` row, defaulting to 5%) was only editable on the Sales
People page, disconnected from the affiliate profile.

## Decision

**Treat sales people and affiliates as a single entity with two tiers, managed
from one surface (`/admin/sales-people`).**

- The **base record is the `sales_persons` row.** Every person who brings us
  business has one.
- A **"Rep"** is a contact-only sales person (`sales_persons.user_id IS NULL`) —
  no login; we cut their invoices for them.
- An **"Affiliate"** is a sales person whose `user_id` points at a login account
  (`customers.role = 'affiliate'` + an `affiliates` row + a referral code). The
  merged list badges each row as **Rep** or **Affiliate** and enriches the
  affiliate rows with their referral code, wallet, bound-customer count, referral
  earnings, and login state.
- A **rep can be promoted to an affiliate** ("the step up"): this creates the
  login + `affiliates` row + referral code and **links them to the person's
  existing `sales_persons` row** (`user_id`), preserving their commission history.

This is a **UI/API consolidation with no schema change** — the tables already
bind the two. The `SalesPerson` type is extended to expose the previously-omitted
`user_id` so the merged surface can see the affiliate link.

### What stays separate (deliberately)

- **Two commission ledgers remain.** `sales_commissions` (invoice work, written on
  invoice create/edit, rate stored as a **percent** like `5.00`) and `commissions`
  (referral, written at checkout, rate stored as a **fraction** like `0.10`, with a
  trigger that rolls `paid` into `affiliates.total_earnings`). They have different
  semantics and are **not** merged into one table here. The merged detail page
  *shows* both per person and can mark either paid; the standalone
  `/admin/commissions` report is unchanged.
- **The affiliate self-serve portal** (the "Client Dashboard" an affiliate sees at
  `/admin`) is unchanged — this ADR is about back-office management, not the
  partner's own view.

### Invariants preserved

1. Identity sharing: `affiliates.id = customers.id = sales_persons.user_id = auth uid`.
2. The affiliate **delete cascade** (commissions → referral_codes → sales_persons
   by `user_id` → affiliates → customers → auth user) is kept intact.
3. The **partial unique index** — an affiliate has at most one linked
   `sales_persons` row; plain reps have `user_id IS NULL`.
4. An affiliate's **invoice commission rate lives on their `sales_persons` row**;
   editing it writes there (never `affiliates`), and the affiliate rate-lock on
   invoice creation keeps reading it.
5. `bindCustomerToSalesPersonAffiliate` still couples `customers.affiliate_id`
   and `default_sales_person_id` on invoice writes.
6. **Mark-paid is admin-only** (RLS); assistants remain read-only. Active sales
   persons stay searchable in the invoice picker.

## Consequences

**Positive**

- One place to manage everyone who brings in business; no more duplicate listing
  of the same person on two pages.
- The affiliate ↔ sales-person link is finally visible and editable in one place,
  so the two records stop drifting.
- The promotion path formalizes the real-world "rep → affiliate" progression.
- Customer-detail-style depth (a Partner detail page: their customers, invoices,
  commissions, activity) is brought to sales people/affiliates, which had none.

**Negative / trade-offs**

- The merged surface must carefully preserve the affiliate create/delete cascade
  and the two different rate conventions; a naive unification would corrupt
  earnings math or orphan rows.
- Two commission ledgers still coexist; fully unifying them is deliberately out of
  scope (see Alternatives).

## Alternatives considered

- **Keep the two pages separate.** Rejected — it is the status quo that confuses,
  and it lists the same person twice.
- **Unify the two commission ledgers into one table.** Rejected for this change —
  they have different write paths (checkout vs invoice), rate conventions
  (fraction vs percent), and a paid-trigger on the affiliate ledger. Merging them
  is a larger, riskier migration; the merged UI reads both instead.
- **Make "affiliate" a boolean flag on `sales_persons`.** Rejected — an affiliate
  is a real auth account with its own `affiliates`/`customers` rows and referral
  code; a flag can't carry that. The `user_id` link already expresses the tier.
