# Admin Invoices — USD Wholesale price list, USD default & customer prompts

Date: 2026-07-22

The admin invoice builder now prices from a **selectable price list**, defaults
to **USD**, and sources USD prices from the **USD Wholesale Pricelist** (the
active list whose prices are stored already in USD) so they appear 1:1 instead
of being run through the CAD→USD exchange rate.

## What changed

### Price list is now stored per-currency
- New `pricelists.currency` column (`'CAD'` default / `'USD'`) —
  `aminocan/pricelist-currency-migration.sql`. A USD list's stored prices are
  shown as-is on a USD invoice (no exchange-rate conversion); the migration
  flips any list whose name mentions USD (covers the **USD Wholesale Pricelist**
  and the Christian Harcus list).
- The active-pricelist and pricelist-detail APIs now return `currency` and
  `unlabeled_price`.

### Invoice form — price list selector
- A **Price List** dropdown lists every price list, marks the globally **Active**
  one, and includes **Default — catalog price (products table)**. A line beneath
  it always shows which list is currently active.
- Picking a list re-prices every product-bound line from it. A USD list prices
  in USD 1:1; a CAD list converts by the rate; **Default** uses `products.price`
  / `products.price_usd`.

### USD by default + CAD-customer prompt
- New invoices default to **USD**.
- Linking a customer tagged for **CAD** prices while the invoice is USD now
  raises a prompt — **Continue with USD** (also saves USD as that customer's
  default for future invoices) or **Switch this invoice to CAD**. USD-tagged
  customers keep the invoice in USD; a CAD invoice + CAD customer is left alone.
- After continuing in USD, if the customer **also carries their own custom
  prices** (per-customer overrides), a second warning offers to **use the price
  list** (ignore their overrides for this invoice) or **keep their custom
  prices**.

### Unlabeled prices
- The USD Wholesale Pricelist has no separate unlabeled prices, so **Without
  labels** keeps the labeled price as-is. A tooltip warning under the labels
  toggle now spells that out when the selected list has no unlabeled prices.

## Files

- `aminocan/pricelist-currency-migration.sql` — the new `currency` column.
- `components/admin/InvoiceForm.tsx` — price-list selector, USD default, the
  CAD-customer + custom-pricing prompts, currency-aware price resolution, and
  the unlabeled tooltip warning.
- `lib/admin/pricelists.ts` — `currency` on `ActivePricelist`, `getPricelistPrices`,
  `DEFAULT_PRICELIST_ID` / `EMPTY_PRICELIST`.
- `lib/supabase.ts` — `Pricelist.currency` / `PricelistItem.unlabeled_price`.
- `app/api/admin/pricelists/active/route.ts`, `app/api/admin/pricelists/[id]/route.ts`.
