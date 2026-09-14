# Invoices bill in the customer's configured currency

Date: 2026-08-04

Every customer already carries a currency tag (`customers.price_currency` —
`CAD` or `USD`, set on the customer record / Customer Pricing view). That tag now
drives the **invoice currency** end to end, and the admin **Products** page opens
in it too. No schema or API changes — only how the currency default is chosen.

## What changed

`components/admin/InvoiceForm.tsx` (admin invoice **create/edit**)

- **Selecting a customer sets the invoice's Paid In currency to their tag.**
  Linking a customer now switches the invoice to their `price_currency` (CAD or
  USD) and re-prices every product-bound line into it — deterministically, with
  **no prompt**. Previously a new invoice defaulted to USD and, when the linked
  customer was tagged CAD, popped a "keep USD or switch to CAD?" dialog.
- The old USD-vs-CAD prompt and its follow-up "this customer has custom pricing"
  dialog are removed (the currency tag is now the single source of truth). An
  admin can still flip the currency by hand afterwards via the Paid In toggle.
- **Affiliates are unaffected** — they remain locked to their **own** record
  currency (set once on mount), never the bill-to client's tag.

Because the invoice's stored `currency` is what the **totals**, the **customer
invoice email** (`{{currency}}` merge var), and both the print/PDF builders
already render, setting it from the customer's tag makes all of those follow the
configured currency automatically.

`app/(admin)/admin/products/page.tsx`

- **The CAD/USD price toggle defaults to the signed-in user's configured
  currency** (their own `customers.price_currency`) instead of always starting on
  CAD, so a USD-tagged client/affiliate lands on USD. It's still freely toggled.

## Notes

- The storefront product pages already showed prices in the signed-in customer's
  currency via `CurrencyContext` (no toggle there) — unchanged.
- Currency is a display/billing tag: amounts are priced into the currency at
  line-resolution time (customer overrides → price list → catalog), not converted
  after the fact. This is the existing behavior; only the default currency
  selection changed.
