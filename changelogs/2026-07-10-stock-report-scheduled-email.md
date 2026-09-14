# Scheduled Stock Report Email

Date: 2026-07-10

The Stock Report can now be **emailed on a schedule** to a configured set of
recipients, set up right from **admin/products**. Delivery runs on Supabase's
own scheduler (pg_cron + pg_net) — the same mechanism the e-Transfer email job
uses — so no external cron service is needed.

## What changed

- **Email Schedule (admin/products)** — a new admin-only **Email Schedule**
  button opens a dialog to:
  - toggle the scheduled email on/off,
  - set the **recipients** (comma-separated),
  - choose a **frequency** — daily / weekly / monthly, and
  - **Send now** — email the report immediately (a test send that doesn't touch
    the schedule cadence).
- **PDF + CSV attachments** — the email carries a short HTML summary (headline
  stat tiles) in the body with the **full Stock Report attached as both a PDF
  and a CSV** (`stock-report-YYYY-MM-DD.pdf` / `.csv`). The PDF is generated with
  pdfkit — the same no-headless-browser mechanism used for invoice PDFs — from
  the exact same computation as the printable/on-screen report, so they never
  diverge. The CSV (UTF-8 with BOM for Excel) has one row per product for
  spreadsheet use. The PDF is a polished, high-legibility layout — larger type,
  bordered stat tiles, coloured stock pills, zebra-striped rows, multi-page
  tables with repeating headers, and page numbers.
- **Frequency enforced in the app** — the Supabase schedule fires once a day and
  the route decides whether a send is due based on the configured cadence and
  the last-sent time, so weekly/monthly don't require changing the cron
  expression.

## Implementation

- **`lib/admin/stock-report.ts`** (new) — extracted the Stock Report
  computation (`computeStockReport`) and printable-HTML rendering
  (`stockReportPrintHtml`) out of the report route so the report and the email
  share one source of truth. `GET /api/admin/products/stock-report` now uses it.
- **`lib/admin/stock-report-pdf.ts`** (new) — `renderStockReportPdf` builds the
  report PDF with pdfkit: bordered stat tiles, coloured stock pills, zebra rows,
  multi-page tables with repeating headers, and page numbers.
- **`lib/admin/stock-report-csv.ts`** (new) — `renderStockReportCsv` builds a
  one-row-per-product CSV (UTF-8 + BOM for Excel).
- **`lib/admin/stock-report-email.ts`** (new) — `renderStockReportEmailHtml`
  (summary body) + `sendStockReportEmail` (compute → render PDF + CSV → send with
  both attached).
- **`lib/email.ts`** — new generic `sendEmail({ to, subject, html, attachments })`
  helper over the existing SMTP transport (now forwards attachments).
- **`GET/POST /api/cron/stock-report-email`** (new) — `CRON_SECRET`-guarded job:
  loads the schedule, checks enabled + recipients + due, sends, and stamps the
  last-sent marker.
- **`POST /api/admin/products/stock-report/send`** (new) — admin/assistant
  "Send now" endpoint (immediate send, no cadence side effects).
- **Settings** — `GET/PUT /api/admin/settings` gains
  `stock_report_email_enabled`, `stock_report_email_recipients`,
  `stock_report_email_frequency` (read-only `stock_report_email_last_sent_at`),
  with progressive column fallback so a pre-migration DB still loads.

## Migration required

Run **`stock-report-email-migration.sql`** in Supabase. It adds the four
`site_settings` columns and includes the (commented) pg_cron + pg_net schedule
to enable once — edit the site URL and `CRON_SECRET` placeholders before running
the schedule block.

## Files

- `lib/admin/stock-report.ts` (new)
- `lib/admin/stock-report-pdf.ts` (new)
- `lib/admin/stock-report-csv.ts` (new)
- `lib/admin/stock-report-email.ts` (new)
- `app/api/cron/stock-report-email/route.ts` (new)
- `app/api/admin/products/stock-report/send/route.ts` (new)
- `stock-report-email-migration.sql` (new)
- `lib/email.ts`
- `app/api/admin/products/stock-report/route.ts`
- `app/api/admin/settings/route.ts`
- `app/(admin)/admin/products/page.tsx`
