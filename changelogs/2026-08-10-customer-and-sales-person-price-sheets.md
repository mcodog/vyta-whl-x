# Downloadable price-list PDFs + customer currency fix

Date: 2026-08-10

Two related pricing improvements:

1. A per-entity **price-list PDF** you can download from a customer's page and a
   sales person's page — SKU, description, price, and an optional inventory
   column.
2. A fix for the **currency discrepancy** in the products Download Report, where
   a customer priced from a USD list showed up as **CAD**.

## What changed

### 1. Price-list PDFs (customer + sales person)

New `lib/admin/price-sheet.ts` + `app/api/admin/price-sheet/route.ts` render a
clean, branded, print-ready price list for a single **customer** or **sales
person**. It opens in a new tab and auto-prints, so the browser's "Save as PDF"
produces the file.

- **Columns:** SKU (the product slug), Description, Price. A **toggle for
  inventory** adds a fourth column showing the **exact on-hand stock** (in
  boxes).
- **Customer price source:** the customer's own `customer_price_overrides`,
  falling back to the catalog price for anything they haven't been given. Hidden
  products (`is_visible = false`) and inactive products are excluded.
- **Sales-person price source:** their own affiliate price list
  (`affiliate_price_overrides`, keyed by their linked login
  `sales_persons.user_id`), falling back to catalog. A plain rep with no login
  falls back entirely to catalog prices.
- **Currency:** resolved from the entity's applied price list (authoritative for
  the stored numbers), falling back to their `price_currency` tag. Override
  numbers are shown as-is; only the *catalog fallback* on a USD sheet is
  converted CAD→USD at the site exchange rate — so nothing is double-converted.

New shared control `app/(admin)/admin/_components/PriceSheetButton.tsx` (a
"Price list" button with an "Include inventory" toggle) is wired into:

- `app/(admin)/admin/customers/[id]/page.tsx` — the customer detail header.
- `app/(admin)/admin/sales-people/[id]/page.tsx` — the sales-person detail header.

### 2. Currency discrepancy fix

**Root cause:** applying a price list to a customer copied the list's (possibly
USD) prices into `customer_price_overrides` but never updated
`customers.price_currency`, which stayed at its `CAD` default. Every view that
reads the tag (the Download Report, invoices) then labelled those USD numbers as
CAD.

- `app/api/admin/pricelists/[id]/apply-to-customer/route.ts` now **syncs
  `price_currency` to the applied list's currency**, so the tag stays correct
  going forward.
- `app/api/admin/products/report/route.ts` (Download Report, customer pricing
  source) now resolves the currency from the customer's **applied price list**
  first, falling back to `price_currency` — so it is right even for customers
  applied a list before the sync existed.
- `customer-price-currency-backfill-migration.sql` realigns existing customers:
  for anyone with an applied price list, `price_currency` is set to that list's
  currency. Idempotent; run once in the Supabase SQL editor.

## Notes

- No schema changes are required for the PDFs; they read existing tables via the
  service role, gated to `admin` / `assistant` like the other admin reports.
- The backfill migration only touches customers that have an
  `applied_pricelist_id`, and only when their tag differs from the list currency.
