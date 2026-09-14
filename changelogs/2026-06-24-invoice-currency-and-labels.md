# Invoice Markings — Currency (CAD/USD) and With/Without Labels

Date: 2026-06-24

Two new markings can be set when creating (or editing) an invoice, both
surfaced on the invoice form, the detail view, and the generated PDF/print
output.

## 1. Paid in CAD or USD

- The invoice form has a **Paid In** segmented control (CAD / USD) in the
  Invoice Details card. Defaults to **CAD**.
- This only marks the currency the invoice is denominated/paid in — amounts
  are **not** converted.
- The form summary, the invoice detail page, and the PDF/print output all
  append the currency code to the Total / Amount Due (e.g. `$120.00 USD`).
- Stored in `invoices.currency` (text, default `'CAD'`).

## 2. With / Without labels

- A simple **Labels** toggle (switch) sits next to the currency control.
  Defaults to **With labels**.
- The toggle reads "With labels" / "Without labels" and shows an on/off
  switch with a tag icon for clear UX.
- Shown on the invoice detail page ("Order Markings" card) and on the
  PDF/print output (a "Labels" cell alongside the dates).
- Stored in `invoices.with_labels` (boolean, default `true`).

## Persistence

- Accepted by `POST /api/admin/invoices` and `PATCH /api/admin/invoices/:id`
  (both values are normalised server-side; unknown currency falls back to
  CAD, `with_labels` to true).
- New columns added by `invoice-currency-labels-migration.sql` — run it in the
  Supabase SQL editor.

## Files

- `invoice-currency-labels-migration.sql` — adds `currency` + `with_labels`.
- `lib/supabase.ts` — `InvoiceCurrency` type + `Invoice` fields.
- `lib/admin/invoices.ts` — `InvoiceInput` fields.
- `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts` —
  accept/normalise/persist.
- `components/admin/InvoiceForm.tsx` — currency control + labels toggle.
- `app/(admin)/admin/invoices/[id]/page.tsx` — "Order Markings" card.
- `lib/admin/invoice-html.ts`, `lib/invoice-pdf.ts` — PDF/print display.
