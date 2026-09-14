# Price list — preview & email, and a checkbox click-target fix

**Date:** 2026-08-11
**Area:** Admin › Sales people & Customers › Price list

## Summary

The **Price list** control on a sales-person or customer detail page gains a
second action — **Preview & email** — that shows the exact PDF that will be
attached and sends it to editable recipients. The same menu's **Include
inventory** checkbox is also fixed: clicking the box itself now toggles it (only
the label text worked before).

## Include inventory — checkbox click fix

- The **Include inventory** toggle previously nested the custom `Checkbox`
  (which renders a `<button>`) inside another `<button>`. Clicking the box fired
  both handlers and cancelled out — a net no-op — so only clicking the *text*
  appeared to work.
- The box and its label are now **sibling controls** (no nested interactive
  elements), so a click on either the box or the text toggles exactly once. The
  toggle is also keyboard-operable.

## Preview & email

- A new **Preview & email** action opens a modal styled to the admin design
  system (bronze accents, `surface`/`line` tokens, rounded cards).
- **Live PDF preview** — the modal fetches and renders the real, branded PDF
  that will be attached. Flipping **Include inventory** inside the modal
  regenerates the preview and the attachment.
- **Pre-generated but editable fields:**
  - **To** — pre-filled with the current entity's email. Add more recipients by
    separating with commas; parsed addresses show as chips, with invalid entries
    flagged.
  - **CC** — optional, same comma-separated behaviour.
  - **Subject** and **Message** — pre-written and fully editable.
  - An **attachment chip** shows the PDF file name and whether inventory is
    included.
- **Attachment is a real PDF** — rendered server-side with `pdfkit` (the same
  toolkit and visual language as the invoice PDF: PURAMASS header, bronze
  accents, per-page footer), so the emailed file matches the rest of the
  document set. The prior "Download PDF" (print-ready HTML → browser Save as
  PDF) is unchanged.

## Send history

- Every send is recorded (success **or** failure), so each customer / sales-rep
  price list keeps a full history — not just a "last sent" stamp.
- The modal shows a **Send history** list (newest first) with, per entry: when
  it was sent, **who** sent it, the recipients (To / CC), whether inventory was
  included, the sheet currency, and the product count; failed attempts show
  their error. The list refreshes after each send.
- Backed by a new `price_sheet_email_log` table (migration
  `price-sheet-email-log-migration.sql`) with admin/assistant RLS, mirroring
  `invoice_email_log`. `entity_id` is polymorphic (a `customers.id` or a
  `sales_persons.id`, disambiguated by `entity_type`). History is served by a
  `GET /api/admin/price-sheet/email` handler; if the table doesn't exist yet
  (migration not run) the modal simply shows an empty history rather than
  erroring.

## Implementation notes

- `lib/admin/price-sheet.ts` was refactored to expose render-agnostic data
  (`buildPriceSheetData` + `PriceSheetData`); the existing HTML view
  (`renderPriceSheetHtml` / `buildPriceSheet`) and the new PDF share it, so both
  always show identical numbers.
- New `lib/admin/price-sheet-pdf.ts` (`renderPriceSheetPdf`, `priceSheetFileName`).
- New routes:
  - `GET /api/admin/price-sheet/pdf` — returns the attachable `application/pdf`
    (used for the live preview; supports `download=1`).
  - `POST /api/admin/price-sheet/email` — regenerates the PDF server-side (never
    trusting a client blob) and emails it via SMTP to the To/CC recipients. The
    send is written to the audit log (`price_sheet.emailed`).
- Both routes are admin/assistant-only and run on the Node.js runtime.

## Files

- `app/(admin)/admin/_components/PriceSheetButton.tsx`
- `app/(admin)/admin/_components/PriceSheetEmailModal.tsx` (new)
- `app/api/admin/price-sheet/pdf/route.ts` (new)
- `app/api/admin/price-sheet/email/route.ts` (new — `POST` sends, `GET` returns history)
- `price-sheet-email-log-migration.sql` (new)
- `lib/admin/price-sheet.ts`
- `lib/admin/price-sheet-pdf.ts` (new)
- `app/(admin)/admin/sales-people/[id]/page.tsx`
- `app/(admin)/admin/customers/[id]/page.tsx`
