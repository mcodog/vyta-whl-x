# Labeled / Unlabeled Invoice Pricing

## Goal

Each product now has **two** customer prices:

- **Labeled** — vials shipped with a printed label. This is the **existing** price
  (`pricelist_items.price`, `customer_price_overrides.override_price`, `products.price`).
- **Unlabeled** — base price, vials with no printed label. This is a **new** column.

On the **admin invoice**, a toggle switches every product-bound line between the
labeled and unlabeled price. This is the only place the unlabeled price is
consumed. The relationship in the source PDF is `labeled = unlabeled + $10`, but
the two prices are stored independently — nothing computes one from the other.

## Terminology mapping (important)

The existing price column is the **labeled** value. We do **not** rename it; we
add the unlabeled value beside it.

| Table | Labeled (existing) | Unlabeled (new) |
|---|---|---|
| `pricelist_items` | `price` | `unlabeled_price` |
| `customer_price_overrides` | `override_price` | `unlabeled_override_price` |
| `products` (catalog default) | `price` / `price_usd` | *(none — falls back to labeled)* |

`NULL` unlabeled means "no unlabeled price defined → use the labeled price." So
existing lists/customers keep working unchanged; only rows that carry an
unlabeled value behave differently when the toggle is off.

## Database changes

Migration: `aminocan/christian-usd-pricelist-labeled-unlabeled-migration.sql`.

1. **Schema (global, additive):**
   ```sql
   ALTER TABLE pricelist_items
     ADD COLUMN IF NOT EXISTS unlabeled_price DECIMAL(10,2) CHECK (unlabeled_price >= 0);
   ALTER TABLE customer_price_overrides
     ADD COLUMN IF NOT EXISTS unlabeled_override_price DECIMAL(10,2) CHECK (unlabeled_override_price >= 0);
   ```
2. **Christian's data:** builds a `pricelists` row ("Christian Harcus — USD Price
   List") from the 108 PDF rows matched to products by **`slug` = the PDF
   "Code"** (85 match the current catalog; the other 23 are strengths/variants
   the catalog does not carry and are skipped, not remapped), storing `price` =
   labeled and `unlabeled_price` = unlabeled; then
   applies it to customer `f31eb9af-8630-4cc1-805f-d36ca4aaf860` by copying both
   values into `customer_price_overrides`, stamping `applied_pricelist_id`, and
   setting `price_currency = 'USD'`.

The migration is idempotent and prints (via `RAISE NOTICE`) how many of the 108
PDF rows were priced, lists any PDF code with no matching active product, and
lists active products the PDF does not price.

## Currency handling (decision)

The PDF is a **fixed USD** list. Today the invoice treats every stored price as
CAD and multiplies by the exchange rate when the invoice currency is USD
(`priceForProduct`, `InvoiceForm.tsx:242-244`). That would double-convert
Christian's USD numbers.

**Chosen behavior:** when the customer's `price_currency === 'USD'`, their
`customer_price_overrides` values are treated as **already USD** and are **not**
re-converted. The stored numbers appear on the invoice 1:1, independent of the
exchange rate.

Implementation: in `priceForProduct` (`InvoiceForm.tsx:235-247`), when the
active customer is USD-tagged and the resolved price came from a customer
override, return the override directly for a USD invoice instead of
`usdFromCad(...)`. The CAD path and the pricelist/default fallback paths are
unchanged. (Thread the customer's `price_currency` into the form; it is already
read at `InvoiceForm.tsx:825` to default the invoice currency.)

## Invoice-side implementation

### The toggle (reuse the existing one)

There is already a **"With labels / Without labels"** switch at
`InvoiceForm.tsx:1418-1446` (`withLabels` state, `InvoiceForm.tsx:139`). Today it
only writes the physical `invoices.with_labels` flag (`InvoiceForm.tsx:1104`)
with no price effect. Give it price meaning:

- **With labels (on, default):** lines use the **labeled** price (current behavior).
- **Without labels (off):** product-bound lines use the **unlabeled** price where
  one exists, else fall back to the labeled price.

Add a short **note** under the toggle, e.g.:
> "Switching labels re-prices product lines between the labeled and unlabeled
> price list. Manually edited prices are not changed."

### Price resolution changes

1. **Load unlabeled overrides.** `getCustomerPriceOverrides`
   (`lib/admin/pricelists.ts:99-108`) currently returns
   `Record<product_id, number>` (labeled only). Change it to also carry the
   unlabeled value, e.g. `Record<product_id, { labeled: number; unlabeled: number | null }>`,
   and update the `GET /api/admin/price-overrides` route
   (`app/api/admin/price-overrides/route.ts`) to select `unlabeled_override_price`.
   Do the same for the active pricelist feed (`getActivePricelist` /
   `/api/admin/pricelists/active`) so unlabeled works for non-override customers too.

2. **Resolve by label state.** Extend `listedBoxCad` / `priceForProduct`
   (`InvoiceForm.tsx:223-247`) to take the current label state. When labels are
   **off**, prefer the unlabeled value at each rung of the existing ladder
   (customer override → active pricelist → product default), falling back to the
   labeled value when the unlabeled one is `NULL`. `priceForType`
   (`InvoiceForm.tsx:257-262`) passes the flag through; vial pricing is unchanged.

3. **Re-price on toggle.** When `withLabels` flips, re-price every
   product-bound line, mirroring `changeCurrency` (`InvoiceForm.tsx:266-276`):
   ```ts
   const changeLabels = (next: boolean) => {
     setWithLabels(next);
     setLines(prev => prev.map(l => {
       if (!l.product_id) return l;               // manual lines keep their price
       const p = products.find(pp => pp.id === l.product_id);
       return p ? { ...l, unit_price: priceForType(p, l.price_type, currency, customerPrices, next) } : l;
     }));
   };
   ```
   Wire the switch's `onClick` to `changeLabels` instead of `setWithLabels`.

4. **Line add / currency change / customer change.** The label state must feed
   the price at every place a line is (re)priced: `pickProductForLine`
   (`InvoiceForm.tsx:701-712`), `changeCurrency` (`:266-276`), the price-type
   switch (`:718-721`), and the customer-change effect (`:361-387`).

### Server + persistence

- The server trusts the client `unit_price` (`app/api/admin/invoices/route.ts:494-510`)
  — no change needed; the resolved price is already sent per line.
- `invoices.with_labels` continues to be saved as-is (`InvoiceForm.tsx:1104`); it
  now also reflects which price set produced the line prices. No schema change to
  invoices.
- The "save line prices to this customer" flow (`savePricesToCustomer`) writes
  the labeled CAD `override_price`. **Implemented:** `eligiblePriceSaves` is
  disabled when the customer is USD-native (`customerIsUsd`) or when labels are
  off, so an unlabeled price is never written into the labeled column and a USD
  number is never stored as CAD. (The POST route now also accepts an optional
  `unlabeled_override_price` for a future per-column save.)

## Edge cases

- **Unlabeled missing (`NULL`):** line uses the labeled price. No error, no $0.
- **Manual / unbound lines** (no `product_id`): never re-priced by the toggle.
- **Vial lines:** unaffected — vial pricing has no labeled/unlabeled split; it
  keeps using `vial_price` / `price / 10`.
- **Duplicate slug** (e.g. two active products sharing a `slug`): the migration
  filters to `active = true`; if more than one active product shares a slug, both
  get priced.
- **Non-USD customers:** unchanged — labeled/unlabeled still works; only the
  no-re-conversion rule is USD-customer specific.

## Out of scope

- No change to the storefront / customer-facing pricing (unlabeled is
  admin-invoice only).
- No automatic `labeled = unlabeled + $10` computation — both values are stored.
- No new currency conversion beyond the USD-customer passthrough above.
- Affiliate price overrides (`affiliate_price_overrides`) are not given an
  unlabeled column in this pass.
