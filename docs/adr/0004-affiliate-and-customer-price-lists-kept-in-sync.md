# 4. An affiliate's two price lists are kept in sync

- **Status:** Accepted
- **Date:** 2026-08-10
- **Area:** Pricing, Invoicing / AR, Affiliates
- **Related code:**
  - `lib/admin/affiliate-pricelist-sync.ts` (the sync helper)
  - `app/api/admin/price-overrides/import/route.ts`
  - `app/api/admin/price-overrides/route.ts` (POST / DELETE)
  - `app/api/admin/pricelists/[id]/apply-to-customer/route.ts`
  - `affiliate-customer-pricelist-sync-migration.sql` (one-time backfill)
  - ADR 0001 (affiliate invoice pricing), ADR 0003 (one tiered entity)

## Context

An affiliate is the same person across three tables — `affiliates.id =
customers.id = sales_persons.user_id = auth uid` (ADR 0003). That single UID is
the key of **two different price lists**:

1. **The affiliate's own customer record** —
   `customer_price_overrides WHERE customer_id = <uid>`. This is what prices the
   line items on invoices the affiliate creates. Both the invoice form
   (`components/admin/InvoiceForm.tsx`, affiliate load) and the server-side price
   enforcement (`lib/admin/affiliate-pricing.ts`) read it. Per ADR 0001 an admin
   sets it via **admin/pricing → Customer Pricing**.

2. **The affiliate's price list** —
   `affiliate_price_overrides WHERE affiliate_id = <uid>`. Per
   `affiliate-pricelist-migration.sql` this is copied onto **every customer bound
   to the affiliate** (today's and future — see `applyAffiliatePricelist`). An
   affiliate writes it by importing a price-list CSV.

These are meant to describe the same prices, but nothing kept them equal:

- When an **affiliate imported** a price list, the route wrote (2) and every
  bound customer's overrides — but **never the affiliate's own record (1)**. So
  the affiliate could import new prices and the invoices they created kept the
  **old** prices.
- When an **admin set the affiliate's prices** on their own record (1) via
  Customer Pricing, nothing propagated to (2), so the affiliate's bound customers
  never saw the change.

The two lists drifted, and which one a reader happened to consult changed the
answer.

## Decision

**Treat the two lists as one and keep them identical, syncing on the box price
they share.** `affiliate_price_overrides` stores only the labeled box price, so
that is the synced field; unlabeled / per-vial / visibility data lives only on
the customer-overrides side and has no counterpart.

The sync is done at the application layer (matching the existing
`applyAffiliatePricelist` pattern), centralized in
`lib/admin/affiliate-pricelist-sync.ts`:

- **Affiliate imports a price list** → in addition to writing (2) and the bound
  customers, the route now upserts the same prices onto the affiliate's **own
  record (1)**. Their invoices immediately reflect the imported list.
- **Any write to an affiliate's own record (1)** — Customer Pricing apply,
  a single override POST/DELETE, or an admin CSV import onto that record — calls
  `syncAffiliatePriceListFromOwnRecord`, which rewrites (2) to hold exactly the
  sellable (positive, visible) box prices on (1). The helper is a **no-op for
  non-affiliate customers**, so callers pass any `customer_id` blindly.

Because both representations are kept equal, **it no longer matters which one the
invoice pricing reads** — the original motivation was to switch invoice pricing
from (1) to (2), which becomes moot once they are in sync.

A one-time backfill (`affiliate-customer-pricelist-sync-migration.sql`)
reconciles rows that drifted before this shipped, taking the more-recently-edited
side when the two disagree (the batch extension of "last write wins").

## Consequences

**Positive**

- An affiliate's imported price list now also prices the invoices they create —
  the reported bug is fixed.
- Admin edits to an affiliate's prices propagate to that affiliate's bound
  customers.
- Reads of either list agree, so downstream code need not care which is
  canonical.

**Negative / trade-offs**

- Sync is enforced per write path rather than by a database trigger, so a **new**
  code path that writes either table must call the helper (or add the affiliate's
  own record to its targets). The write paths are few and centralized on one
  helper to make this hard to miss.
- Only the box price is synced; the affiliate list has no place to store
  unlabeled/vial/visibility, which remain properties of the customer record only.
- Syncing is best-effort (failures are logged, never blocking the triggering
  write), consistent with `applyAffiliatePricelist`.

## Alternatives considered

- **Switch invoice pricing to read the affiliate list (2) and leave the drift.**
  Rejected: it only moves the problem — the two lists would still disagree for
  every other reader (bound customers, reports). Keeping them in sync makes the
  wiring irrelevant.
- **Bidirectional database triggers.** A single chokepoint that catches every
  path, but a new pattern for this repo, not exercised by the test suite, and
  bidirectional pricing triggers are subtle (recursion guards). Rejected in
  favor of the existing application-level sync pattern, which is testable and
  ships with the code rather than a manual migration.
