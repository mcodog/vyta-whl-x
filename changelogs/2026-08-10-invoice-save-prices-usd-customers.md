# New Invoice — "Save prices to the customer's price list" now works for USD customers

Date: 2026-08-10

When building a new invoice for a linked customer, the form offers to save the
unit prices you typed as that customer's per-customer overrides (the prompt
introduced on 2026-07-14). That prompt had stopped appearing for a large group
of customers: **anyone tagged as a USD customer never saw it.**

## Why it wasn't happening

Per-customer overrides originally stored a single **CAD** box price, so the
save-back converted every entered price back to CAD before writing it. Since
then customers carry their own `price_currency`, and their overrides are stored
in **that** currency — a USD customer's numbers are native USD. Rather than
convert to the customer's currency, the save-back simply skipped USD customers
(`customerIsUsd`) so it could never write a wrong CAD number onto a USD list.
The result: on a USD-tagged customer the prompt's eligible-line list was always
empty, so no prompt ever opened.

## What changed

- **USD customers are supported.** The prompt now appears for USD-tagged
  customers on create, exactly as it already did for CAD ones.
- **Stored in the customer's own currency.** Each entered price is converted
  from the invoice currency into the customer's `price_currency` before it's
  saved — 1:1 when they match, and at the site USD rate otherwise. A USD
  customer's price is written as USD; a CAD customer's as CAD.
- **Prompt reflects the right currency.** Each row shows the price and the
  product's catalog default in the customer's currency, and — when the invoice
  was raised in the other currency — the original amount you typed
  (e.g. `from $X CAD`).

## Unchanged behaviour

- **Create only, linked customer only**, box-priced lines only, per-line
  opt-in, fully-discounted (giveaway) lines excluded, non-blocking gate,
  non-fatal upsert to `POST /api/admin/price-overrides` after the invoice is
  created — all as before.
- **Labels must be on.** The save-back still writes the labeled box price, so
  it only offers when the invoice is set to ship *with labels* (the default).
  With labels off, the typed price is the unlabeled one, which the pricing
  read-back doesn't treat as a standalone override.
- **Affiliates are still excluded** — their lines price from their own record,
  which must never be written onto the bill-to client's price list.

## Files

- `components/admin/InvoiceForm.tsx` — `eligiblePriceSaves` now drops the
  USD-customer exclusion and converts each entered price into the customer's
  currency (`custPriceCurrency`); the confirmation modal labels prices/defaults
  with that currency and shows the original typed amount when the invoice
  currency differs.
