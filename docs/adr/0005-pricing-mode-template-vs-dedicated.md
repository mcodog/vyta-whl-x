# 5. A customer's pricing is marked "template" or "dedicated"

- **Status:** Accepted
- **Date:** 2026-08-10
- **Area:** Pricing, Invoicing / AR, Affiliates
- **Related code:**
  - `customer-pricing-mode-migration.sql` (column + one-time backfill)
  - `lib/admin/pricing-mode.ts` (the marking helper — single chokepoint)
  - `app/api/admin/pricelists/[id]/apply-to-customer/route.ts`
  - `app/api/admin/price-overrides/route.ts` (POST / DELETE)
  - `app/api/admin/price-overrides/import/route.ts` (apply)
  - `app/api/affiliate/me/route.ts` (exposes the mode + list name to the client)
  - `components/admin/InvoiceForm.tsx` (locked-but-visible currency + price list)
  - ADR 0001 (affiliate invoice pricing), ADR 0004 (two lists kept in sync)

## Context

A customer's (and therefore an affiliate's — ADR 0003) invoice prices come from
their `customer_price_overrides`. Those rows are populated two very different
ways:

1. **From a shared price list** — an admin picks a `pricelists` row in the
   Customer Pricing panel and applies it (`apply-to-customer`), which copies the
   list's items into the customer's overrides and records the source list in
   `customers.applied_pricelist_id`. Several customers can be put on the *same*
   list; it behaves like a **template**.
2. **Hand-managed** — a single/bulk override edit, an override delete, or a CSV
   price import. These have **no** shared source; the numbers are **dedicated**
   to that customer.

We wanted the affiliate invoice form (and, later, admin views) to state plainly
which of the two a client is on. The only way to answer that from the raw data
was to load the customer's overrides **and** their applied list's items and diff
them on every read — one extra query per render, and fuzzy at the edges. For a
label shown on a hot form, that is too heavy.

## Decision

**Store the answer as a flag and maintain it O(1) at each write.** A new column
`customers.pricing_mode ∈ ('template','dedicated')` (default `'template'`)
records the current state; no read ever diffs overrides against a list again.

Two states, not three: a customer with **no** custom prices at all (they simply
follow the active/house list) is `'template'` — uncustomized. `'dedicated'` is
reserved for prices that have been hand-managed.

The transitions, centralized in `lib/admin/pricing-mode.ts`:

- **Apply a shared list (`override` mode)** → `'template'` (+ `applied_pricelist_id`).
  The customer is now a faithful copy of the list.
- **Apply a shared list (`keep_existing` mode) that kept ≥1 of their own prices**
  → `'dedicated'` (they deviate from the list by definition).
- **Any manual price write** — override POST (single/bulk), override DELETE, or
  CSV import onto the customer → `'dedicated'`. A hand-edit is a deviation; we do
  **not** compare values (a price typed back to the list's exact number still
  counts). Re-applying a list is the only way back to `'template'`.
  - A **visibility-only** override write (hiding a product, no price) does *not*
    flip the mode — it changes no price.

A one-time backfill (`customer-pricing-mode-migration.sql`) flags as
`'dedicated'` any existing customer holding a price override that is not present
at the same price in their applied list (when `applied_pricelist_id` is null the
match set is empty, so any custom price is a deviation). A customer who is merely
a *subset* of their list — missing items because the list grew after it was
applied — is intentionally left `'template'`, mirroring the going-forward rule.

The mode and the applied list's name are surfaced to the affiliate invoice form
through `/api/affiliate/me` (service-role — a signed-in affiliate cannot read
`pricelists` under its RLS).

### Affiliate invoice controls: shown, not hidden

Previously the invoice form **hid** the currency toggle and the price-list
selector for affiliates (`{!isAffiliate && …}`). Hiding them left an affiliate
unsure what currency or list their quote used. Both are now **always rendered**;
for affiliates they are **locked** (non-interactive, lock icon + tooltip): the
currency shows their account currency, and the price list shows the source with a
**Template · «name»** or **Dedicated** badge derived from `pricing_mode`. This is
presentation only — the server-side price lock from ADR 0001 is unchanged and
remains the real boundary.

## Consequences

**Positive**

- "Template vs dedicated" is a single indexed column read — no per-render diff.
- Affiliates can see (but not change) the currency and price list behind their
  quote, with a clear template/dedicated marking.
- The flag generalizes to admin surfaces (e.g. the Customer Pricing panel) with
  no new query.

**Negative / trade-offs**

- Like ADR 0004's sync, the flag is maintained per write path rather than by a
  trigger, so a **new** code path that writes `customer_price_overrides` must
  call the helper. The write paths are few and funnel through one helper.
- The rule is deliberately coarse: a hand-edit back to the exact template price
  still reads as `'dedicated'` until a list is re-applied. This is by design —
  cheaper and matches "any hand-edit is a customization."
- Updates are best-effort (logged, never blocking the price write), consistent
  with the rest of the pricing write paths.

## Alternatives considered

- **Diff overrides against the applied list on read.** The status quo; rejected
  as too query-heavy for a label on a hot form.
- **Value-aware deviation** (only flip when the written price actually differs
  from the template's price). More precise but adds a per-write lookup and is
  fuzzy for products outside the list. Rejected in favor of the coarse, O(1)
  "any hand-edit → dedicated" rule.
- **A database trigger** maintaining the flag. One chokepoint, but a new pattern
  for this repo and not exercised by the test suite; rejected for the same
  reasons as ADR 0004.
