# 8. Several sales people can be credited on one invoice, with a mirrored primary

- **Status:** Accepted
- **Date:** 2026-09-08
- **Area:** Invoicing, Commissions, People / CRM
- **Related code:**
  - `multi-sales-person-migration.sql` (`invoice_sales_persons`, `customer_sales_persons`)
  - `lib/admin/sales-attribution.ts` (the one module that knows how a deal is split)
  - `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts`
  - `app/api/admin/customers/[id]/route.ts` (roster write + the money-flow rollup)
  - `components/admin/InvoiceForm.tsx`, `app/(admin)/admin/customers/_components/SalesTeamCard.tsx`
  - `lib/admin/invoice-html.ts`, `lib/invoice-pdf.ts`, `lib/admin/analytics-data.ts`
  - Related: ADR 0003 (sales people and affiliates are one tiered entity)

## Context

An invoice could be attributed to exactly **one** sales person
(`invoices.sales_person_id` plus a `sales_person_commission_rate` /
`_amount` snapshot), and a customer to exactly one default
(`customers.default_sales_person_id`). That single column is wired into a lot of
places: affiliate scoping on the invoice list and the aging report, the analytics
leaderboard, the genealogy tree, the invoice-list filter, the deletion-review
screen, and the `get_invoice_stats` RPC.

In practice deals are frequently brought in by **two or more people** who each
earn their own cut — and the rates are not always the same, because what a person
earns is negotiated per person and often per customer. The single column forced
the business to pick one name and settle the rest by hand, outside the system.

The obvious move — replace the column with a join table — would have meant
rewriting every one of those readers at once, including a SQL RPC, with no way to
land the change incrementally.

## Decision

**Add a roster table alongside the existing columns, and keep the columns as the
mirrored primary.**

- `invoice_sales_persons` holds up to **five** rows per invoice: who is credited,
  their own `commission_rate`, and the `commission_amount` snapshotted at write
  time. `customer_sales_persons` does the same for a customer's assigned team,
  where the rate is *the rate that person earns on that customer*.
- **Position 0 is the primary**, and every write mirrors it back onto
  `invoices.sales_person_id` / `_commission_rate` / `_commission_amount` and
  `customers.default_sales_person_id`. Nothing that reads those columns had to
  change to keep working.
- The **five-person cap is structural, not a trigger**: `position` is CHECKed to
  0..4 and is unique per parent, so a sixth row cannot be inserted.
- **Rates are independent, not slices of one pot.** Each person earns
  `invoice total × their own rate`; nothing normalises them and they may sum past
  100%. That is a business decision the system records rather than polices.
- The roster is always rewritten **wholesale** (delete + insert). Partial patching
  would let `position` drift out of the contiguous 0..4 run the unique constraint
  depends on.
- The commission ledger (`sales_commissions`) is unchanged in shape: it simply
  gains **one row per credited person per invoice**, which is what its schema
  already allowed. Pending rows are rewritten on edit; **paid rows are never
  touched** — money that has already moved is history, not state.

### Backwards compatibility

- Every existing invoice and customer is backfilled into a **one-person roster**
  carrying the numbers already recorded. Nothing is recomputed, so historical
  commission math is preserved exactly.
- The API still accepts the old `sales_person_id` + `sales_person_commission_rate`
  pair and reads it as a one-person roster, so an older client keeps working. A
  body carrying only a rate re-rates the primary, as it always did.
- `sales_people: []` is how a caller clears attribution; omitting the key leaves
  the roster untouched.

### Where multi-attribution genuinely changed a reader

- **Affiliate scope.** An affiliate who merely *co-sold* an invoice is not its
  primary, so the column filter can't see it. The invoice list, the affiliate's
  own invoice list, the aging report, the sales-person detail page and the
  single-invoice access checks widen to the roster.
- **Analytics leaderboard.** Every credited person is bumped with their own
  commission, and revenue is attributed **in full to each** — so the leaderboard's
  revenue column can exceed total revenue when co-selling happens. That is
  deliberate: it answers *"how much did this person bring in"*, not *"how do the
  invoices divide up"*.
- **Documents.** The invoice PDF and the print/HTML view list every credited
  person. Commission figures stay internal and never appear on either.

## Consequences

**Positive**

- A real split can be recorded once, in the system, and flows through to the
  ledger, the commissions report, analytics and every person's own page.
- The change landed without touching `get_invoice_stats`, the genealogy tree, the
  invoice-list filter, or any other reader of the single column.
- A customer's assigned team and per-customer rates pre-fill new invoices, so the
  common case needs no typing at all.

**Negative / trade-offs**

- **Two representations of the same fact.** The primary lives in two places and
  every write path has to mirror it. All of them funnel through
  `lib/admin/sales-attribution.ts` for exactly that reason.
- `get_invoice_stats` still scopes an affiliate by the primary column, so an
  affiliate sees a co-sold invoice in their list without it moving their summary
  cards. Fixing that needs a migration to the RPC.
- The genealogy tree still roots a customer on their primary only; a many-to-many
  tree is a larger redesign of that page.

## Alternatives considered

- **Replace the column with the join table outright.** Rejected — it forces every
  reader, including a SQL RPC, to change in one commit, with no incremental path
  and no safe fallback for rows written before the migration.
- **A JSON array of assignments on `invoices`.** Rejected — no foreign key to
  `sales_persons` (so a deleted rep leaves dangling ids), no index for the
  scoping queries, and no structural way to cap the list at five.
- **One shared commission pot split by percentages summing to 100%.** Rejected —
  it does not match how the business negotiates; people are hired at their own
  rate, and forcing the rates to sum would silently change what someone earns
  when a second person is added to a deal.
