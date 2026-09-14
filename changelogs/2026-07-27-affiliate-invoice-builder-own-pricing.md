# Affiliate invoice builder: locked to their own pricing

Date: 2026-07-27

When an **affiliate / sales person** (not an admin) uses the invoice builder,
the form is now scoped down so it always reflects **their own** customer
pricing. Nothing changes for admins/assistants — this is gated on the affiliate
role only.

## What changed (affiliates only)

`components/admin/InvoiceForm.tsx`

- **No Price List selector** — affiliates can't pick a price list; lines always
  price from their own pricing.
- **No Paid In selector** — the currency is locked to the affiliate's own
  record currency (USD/CAD).
- **No "Ships to a Client" box** — that flow is hidden for affiliates.
- **Sales person is locked to them** — unchanged behavior, kept: the affiliate
  is filled in and shown as "You", not editable.
- **Line-item pricing always loads the pricing set to them.** Their own
  `customer_price_overrides` drive every product line (not the bill-to client's
  pricing).
- **Products hidden for them don't appear.** A product priced **$0** for the
  affiliate, or whose **status is Hidden** on their own customer record, is
  removed from the line-item product picker.
- The post-save "save these prices to the customer's price list" prompt is
  suppressed for affiliates, so their pricing is never written onto a client's
  overrides.

## Notes

- The affiliate's own pricing + hidden/$0 product set are read client-side under
  existing RLS (a signed-in user may read their own `customers` and
  `customer_price_overrides` rows). No schema or API changes.
- Builds on the per-customer product status / $0-hides-product work from the
  same branch.
