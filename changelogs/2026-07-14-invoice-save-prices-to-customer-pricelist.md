# New Invoice — Save Entered Prices to the Customer's Price List

Date: 2026-07-14

When building a new invoice for a linked customer, admins routinely type
custom unit prices for each product. Those prices were only ever captured on
the invoice itself — to make them stick for the customer's future orders you
had to separately open **Pricing → Customer Pricing** and re-enter each one.

Creating an invoice now offers to do that for you. On the first **Create
Invoice** / **Save as Draft** click, if a customer is linked and one or more
product lines have a price, a prompt asks whether to save those prices as the
customer's per-customer overrides (the same overrides managed under
`admin/pricing`). Confirm and the prices are written to the customer's price
list right after the invoice is created; skip and nothing is saved.

## Behaviour

- **Create only, linked customer only.** Guest invoices (no linked customer)
  and the edit screen never prompt — per-customer overrides are keyed to a
  saved customer.
- **Box-priced lines only.** The price list stores a single CAD box (pack of
  10) price per product, so only product-bound **Box** lines are offered.
  Vial-priced lines are excluded, with a note in the prompt showing how many
  were skipped.
- **Currency-aware.** For a USD invoice each entered price is converted back to
  CAD (at the site USD rate) before it's saved, so the override matches the
  CAD-based price list. The prompt shows both the CAD figure and the original
  USD amount.
- **Per-line opt-in.** Every eligible line is pre-ticked; untick any you don't
  want to persist. The prompt shows each product's current default price so you
  can see which prices actually change it. The same product on multiple lines
  collapses to one row (the last price wins).
- **Non-blocking gate.** The prompt is the first gate on save and then falls
  through to the existing client-shipment / Easyship / backorder confirmations.
  Editing a customer, line, or the currency afterward lets it reappear for the
  changed prices.
- **Non-fatal save.** The prices are upserted (`POST /api/admin/price-overrides`)
  after `createInvoice` succeeds. A save failure surfaces a notice but never
  blocks the invoice or navigation — exactly like the create-time email.

## Files

- `components/admin/InvoiceForm.tsx` — new price-list prompt: `eligiblePriceSaves`
  derivation (box lines, CAD conversion, per-product dedupe), the confirmation
  modal, the `requestSubmit` gate, and the post-create upsert of the chosen
  prices to the customer's overrides.
