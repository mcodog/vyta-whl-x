# Invoice Export (cross-site sync)

Push an invoice — with its line items, customer, and payments — from this site
to **another website** that runs a compatible receiver. This repo is the
**sender**; the other site owns the receiving Supabase Edge Function and its own
database. Data is sent **by value** (both DBs have similar schemas but different
row ids): the receiver matches the customer by **email** and each product by
**SKU**, creating them when missing, and matches the invoice by its **number**.

## Pieces

| Where | What |
| --- | --- |
| `invoice-export-migration.sql` | Sender-side tables: `invoice_export_destinations` (where you can send) and `invoice_exports` (attempt log). |
| `supabase/functions/import-invoice/` | The **receiving** Edge Function (deploy on the other site). See its README. |
| `lib/admin/invoice-export.ts` | Builds the by-value payload; calls a destination in `preview`/`commit` mode with the shared secret. |
| `app/api/admin/invoice-export/*` | Destination CRUD, `preview` (dry-run), and `send` (commit + log). Admin-gated. |
| Admin UI | **Settings → Invoice Export** to manage destinations. A **Send to site** button on `admin/invoices/:id`, and an **Export to site** bulk action on `admin/invoices`. |

## Setup

1. **Sender DB** — run `invoice-export-migration.sql` on this project.
2. **Receiver** — deploy the Edge Function on the other site and set its secret
   (see `supabase/functions/import-invoice/README.md`).
3. **Sender config** — in **Admin → Settings → Invoice Export**, add a
   destination: label, the Edge Function URL, and the same shared secret.

## Sending

- **Single invoice:** open the invoice → **Send to site** → pick a destination.
- **Bulk:** on the Invoices list, select rows → **Export to site**.

Before firing you can **Preview**. Preview is a dry-run call to the receiver
(nothing is written) that reports:

- **Columns compatible?** — do the receiver's tables have the columns we write?
- **Already exists?** — is the invoice / customer / each product already there?

In bulk, preview is optional — you can send everything without reviewing each
one. An invoice whose number already exists on the receiver is **skipped**
unless you tick **Overwrite**.

Every attempt is recorded in `invoice_exports` (status, the receiver's response,
and the remote invoice id/number).
