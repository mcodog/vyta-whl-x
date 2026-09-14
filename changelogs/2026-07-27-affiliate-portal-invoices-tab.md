# Client portal: invoices you're the sales person on

Date: 2026-07-27

The affiliate/sales-person **Client Dashboard** now has an **Invoices** tab that
lists every invoice they're attached to as the sales person — so invoices with a
sales person assigned surface directly on that person's portal.

## What changed

- **New endpoint** `app/api/affiliate/invoices/route.ts` — returns the signed-in
  affiliate's invoices where `sales_person_id` = their sales-person record
  (newest first), with per-invoice amount due / effective status and simple
  totals (count, outstanding, paid). Affiliate-only.
- **New "Invoices" tab** `app/(admin)/admin/_components/AffiliateDashboard.tsx`
  — summary tiles (Your Invoices / Outstanding / Paid) and a table of invoice #,
  customer, issue date, total, amount due and status. Each row links to the
  invoice detail page (already accessible to affiliates).

## Notes

- The admin invoices API already scoped affiliate results to their bound
  customers **or** invoices they're the sales person on; this change gives those
  sales-person invoices a dedicated, first-class home on the portal itself
  instead of only being reachable via the full Invoices page.
- No schema changes.
