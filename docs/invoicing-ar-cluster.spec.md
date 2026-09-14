# Back-Office Invoicing + A/R Engine — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `ecommerce-backend-migration.sql` (+ `invoice-sales-features` /
> `invoice-split-backorder` / `invoice-email` migrations); pure helpers `invoice-status.ts`,
> `invoice-split.ts`, `invoice-access.ts`; the engine `lib/admin/invoices.ts`; routes
> `app/api/admin/invoices/{route,[id],[id]/payments,[id]/email,[id]/pdf,aging}`; `lib/invoice-pdf.ts`;
> and the UI (`components/admin/InvoiceForm.tsx`, `app/(admin)/admin/invoices/*`).
> Stack: **Next.js 15 App Router** (`after()`) + **Supabase** (service-role) + **pdfkit** +
> **nodemailer SMTP** + **Tailwind**.
>
> Describes the code **as it exists**. Port **sixth** — the hub of the back office. It owns
> `invoices` / `invoice_line_items` / `payments`; writes to `invoice_email_log` (Cluster 10/2),
> `sales_commissions` (Cluster 9), `backorders`/`backorder_items` (Cluster 7); **spawns an `orders`
> row** (Cluster 4/6); and calls the stock RPC (Cluster 3).

---

## 0. The traps, up front

1. **`invoice_number` uses a sequence:** `DEFAULT 'INV-' || nextval('invoice_number_seq')`.
   **Create `CREATE SEQUENCE invoice_number_seq START WITH 1000` before the table** or the column
   default expression fails.
2. **`uniq_invoices_order_id … WHERE order_id IS NOT NULL`** is the idempotency guard for
   `autoCreateInvoiceFromOrder` — at most one invoice per order.
3. **Overdue is computed two ways, keep both:** the **`mark_overdue_invoices()` RPC** (called at the
   top of the list + aging GETs) *persists* `status='overdue'`; **`effectiveStatus(status, due_date)`**
   *derives* it for display (`status_effective`) between sweeps. Drop either and list/detail views go
   stale or the DB drifts.
4. **`invoice_line_items.product_id` is `uuid`** vs **`order_items.product_id` is `TEXT`** — which is
   exactly why there are **two** stock RPCs (`adjust_stock_for_invoice` vs `adjust_stock_for_order`).
5. **Payment → stock:** when an invoice becomes **fully paid**, `adjust_stock_for_invoice` runs
   (idempotent via `stock_adjusted`), guarded by a **422 overpay** check. **This is where e-Transfer
   orders actually decrement stock** — closing the loop left open in Cluster 5 (orders create the
   invoice; paying it decrements).
6. **Creating an invoice also creates a linked `orders` row** (`status pending_invoice` for draft,
   `processing` otherwise, `crypto:'invoice'`) + `order_items`. **That's what puts it on the warehouse
   queue.** Drop it and fulfillment breaks.
7. **Split-on-backorder:** `computeStockSplit` divides lines into in-stock vs backordered → a primary
   invoice + a `is_backorder/parent_invoice_id` child + `backorders`/`backorder_items` rows
   (Cluster 7 seam). The backorder child is always `draft` (no stock decrement).
8. **Email** pulls templates + CC from `site_settings` (Cluster 10/2), attaches the pdfkit PDF, logs
   to `invoice_email_log`, and flips `draft → sent`.
9. **Sales-commission snapshot + `sales_commissions` row = Cluster 9 (stays).** Affiliate invoice
   scoping (`invoice-access.ts`, `canEditInvoice`) = Cluster 8 (strippable).

---

## 1. Overview

`invoices` is the back-office hub: a header with denormalized customer fields, fulfillment state,
sales-commission snapshot, and backorder linkage; `invoice_line_items` (uuid `product_id`) hold the
lines; `payments` track receipts. Invoices are created three ways — **from the admin form**
(`POST /api/admin/invoices`, which splits on backorder and spawns an order), **auto from an order**
(`autoCreateInvoiceFromOrder`, idempotent, called by checkout in Cluster 5), and edited via PATCH.
The list endpoint sweeps overdue, scopes by role (admin/assistant see all; affiliate sees their own),
searches/ranks, and returns aggregate stats. Recording a payment recomputes status and, on full
payment, decrements stock + (after response) auto-buys a shipping label. Emailing renders a PDF, sends
customer + BCC copies over SMTP, logs the send, and advances the status. An aging report buckets
outstanding A/R.

---

## 2. Schema

### `invoices` (live DDL — abbreviated to the load-bearing parts; full DDL in the brief)

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1000;   -- MUST precede the table

create table public.invoices (
  id uuid default gen_random_uuid(),
  invoice_number text not null unique default ('INV-' || nextval('invoice_number_seq')),
  order_id uuid references orders(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  customer_name/email/phone text,                       -- denormalized (name-only invoices)
  issue_date date default CURRENT_DATE,
  due_date date default (CURRENT_DATE + interval '30 days'),
  subtotal/tax_total/shipping_cost/total numeric default 0, tax_rate numeric,
  status text default 'draft' CHECK (status in ('draft','sent','paid','partial','overdue')),
  sales_person_id uuid, sales_person_commission_rate/amount numeric,   -- Cluster 9 snapshot
                                                        -- (the PRIMARY seat; the full roster of up
                                                        --  to 5 lives in invoice_sales_persons)
  last_emailed_at/by/by_email,                          -- email tracking (Cluster 10)
  stock_adjusted boolean default false,                 -- idempotency claim for the invoice RPC
  is_backorder boolean default false, parent_invoice_id uuid references invoices(id),  -- split
  fulfillment_type text default 'shipment' CHECK (in 'shipment','pickup'),
  fulfillment_status text default 'pending' CHECK (in 'pending','packed','shipped','picked_up'),  -- Cluster 7
  packed_at/by, fulfilled_at/by, packed_emailed_at, shipped_emailed_at,
  handling_checklist jsonb default '[]', packed_photos jsonb default '[]',
  non_payable boolean default false
);
CREATE UNIQUE INDEX uniq_invoices_order_id ON invoices (order_id) WHERE order_id IS NOT NULL;  -- 1:1 order↔invoice
create trigger invoices_updated_at BEFORE update ... execute set_updated_at();
```

### `invoice_line_items`
`id, invoice_id (FK CASCADE), product_id uuid (FK SET NULL), product_variant_id uuid, description,
qty (default 1), unit_price, discount_pct, line_total, qty_fulfilled (default 0), qty_backordered
(default 0)`. **`product_id` is `uuid`** (the contrast with `order_items.product_id TEXT`).

### `payments`
`id, invoice_id (FK CASCADE), amount, method CHECK ('card','e-transfer','cash','other'),
reference_note, paid_at default now(), recorded_by uuid (FK SET NULL)`.

### `mark_overdue_invoices()` RPC (`ecommerce-backend-migration.sql`)
```sql
UPDATE invoices SET status='overdue', updated_at=now()
 WHERE due_date < CURRENT_DATE AND status IN ('sent','partial');  -- returns ROW_COUNT
```
Called at the top of `GET /invoices` and `GET /invoices/aging`. `set_updated_at()` is the shared
`updated_at` trigger fn.

### RLS (`ecommerce-backend-migration.sql`)
Scoped (not blanket `USING(true)`): `service_role` full bypass; `admin`/`assistant` SELECT; `admin`
write — across `invoices`, `invoice_line_items`, `payments`. (App routes use the service-role client
and re-check role themselves.)

### Migrations layered on
- `invoice-sales-features-migration.sql` → `sales_person_id` + commission snapshot columns.
- `multi-sales-person-migration.sql` → `invoice_sales_persons` (up to five credited people per
  invoice, each with their own rate + snapshotted amount) and `customer_sales_persons` (the
  customer's assigned team + per-customer rates). Position 0 is the **primary** and is mirrored onto
  the columns above / `customers.default_sales_person_id`, so every pre-existing reader is unchanged.
- `invoice-split-backorder-migration.sql` → `is_backorder`, `parent_invoice_id` (+ indexes).
- `invoice-email-migration.sql` → `last_emailed_*` + `invoice_email_log` table (owned by Cluster 10/2).
- Warehouse fulfillment columns (`fulfillment_status`, `packed_*`, `handling_checklist`, etc.) =
  Cluster 7.

### Schema usage map

| Table | Read by | Written by |
|---|---|---|
| `invoices` | list/detail/aging/email/pdf, order-detail | POST/PATCH/DELETE, `autoCreateInvoiceFromOrder`, payments (status), email (status, last_emailed_*), `mark_overdue_invoices` |
| `invoice_line_items` | detail, email, pdf, stock RPC | POST (insert), PATCH (replace), `autoCreateInvoiceFromOrder` |
| `payments` | list/detail (sum), aging | payments POST |
| `orders` + `order_items` | warehouse, order detail | **created by invoice POST** + `autoCreateInvoiceFromOrder` consumes them |
| `sales_commissions` | (Cluster 9) | POST/PATCH (pending only) — **one row per credited person** |
| `invoice_sales_persons` | list/detail/pdf/analytics, affiliate scoping | POST/PATCH (rewritten wholesale) |
| `backorders`/`backorder_items` | (Cluster 7) | POST split, `syncInvoiceBackorder` (PATCH) |
| `invoice_email_log` | (Cluster 10) | email route |
| `products.stock_quantity` | — | `adjust_stock_for_invoice` on full payment |

---

## 3. Components

### Pure helpers (Tier A)

- **`invoice-status.ts`** — `INVOICE_STATUSES`, `INVOICE_STATUS_META` (label + badge classes + PDF
  bg/fg per status), and **`effectiveStatus(status, due_date)`**: returns `'overdue'` when a
  `sent`/`partial` invoice is past due, else the stored status (the display-time derivation).
- **`invoice-split.ts` — `computeStockSplit(lines, stockMap)`** → `{ inStock, backordered,
  backorderItems }`. Greedy allocation in line order against `product_id → available` (lines without a
  `product_id` are always fully in-stock); recomputes per-line `line_total`; emits per-line backorder
  detail for `backorder_items`.
- **`invoice-access.ts`** (Cluster 8 strip) — `getInvoiceCaller`, `affiliateCustomerIds`,
  `affiliateSalesPersonId`, `affiliateCanAccessInvoice` (an affiliate may touch an invoice when it's
  for a bound customer **or** they are its sales person — covers name-only invoices).

### Engine — `lib/admin/invoices.ts`
- Browser wrappers (bearer-token `apiFetch`): `getInvoices(filters)` → `{invoices, total, stats}`,
  `getInvoice(id)`, `createInvoice(input)` → `{invoice, backorder_invoice?, split?}`,
  `replaceInvoice(id, patch)`, `updateInvoiceStatus(id, status)` (routed through PATCH so the audit
  log fires — no direct supabase mutation), `deleteInvoice`, `recordPayment`, `getAgingReport`.
- **`autoCreateInvoiceFromOrder(serviceSupabase, orderId)`** (server, service-role): idempotent
  (short-circuits if an invoice already linked to the order); reads `orders` + `order_items`; spreads
  any `order.discount_amount` uniformly across lines as `discount_pct`; recovers shipping as
  `orderTotal − subtotal`; denormalizes a display name from the shipping address; inserts a `draft`
  invoice (carrying `fulfillment_type`) + line items. Called by Cluster 5 checkout.

### Create + list core — `app/api/admin/invoices/route.ts`

- **`verifyAdmin`/`getInvoiceCaller`:** affiliates may read+create (server-scoped); reads also
  admin/assistant; mutations require `canCreate` (admin) **or** affiliate.
- **GET:** runs `mark_overdue_invoices()`; affiliate-scopes via `customer_id.in(...)` OR
  `sales_person_id`; resolves customer-name search to ids; selects invoices + joined customer/sales
  person + `line_items(id)` + `payments(amount)`; computes `amount_paid`, `amount_due`,
  `status_effective`, display names. Search results are ranked in memory (`rankInvoiceMatches`,
  invoice# / name weighted) then paginated; non-search uses DB `range`. Returns aggregate **stats**
  (`count`, `outstanding`, `overdueCount`, `paid`) over the status-scoped set (independent of
  search/pagination).
- **POST** (the engine): validates ≥1 line; cleans lines (`line_total = qty·unit·(1−disc/100)`);
  affiliates get their sales person + locked commission rate and are restricted to bound customers.
  Loads product stock → `computeStockSplit`. Then per resulting invoice (`insertInvoice`):
  1. **`createOrderForInvoice`** (unless an `order_id` was supplied): inserts an `orders` row
     (`crypto:'invoice'`, status `pending_invoice` if draft else `processing`, `fulfillment_type`,
     name from address/customer) + `order_items` — **this is the warehouse-queue seam**.
  2. Insert the invoice (subtotal/tax/total + commission snapshot + `is_backorder`/`parent_invoice_id`)
     then its line items (rollback the invoice if line insert fails).
  3. Write the roster to `invoice_sales_persons`, then insert one `pending` `sales_commissions` row
     per credited person whose commission > 0 (Cluster 9). Each person earns `total x their own
     rate` — the rates are independent, not slices of one pot, and may sum past 100%.
  4. **If status is `paid` at creation** → `adjust_stock_for_invoice` + `checkLowStockForProducts`.
  5. `invoice.create` audit.
  - **Split path:** in-stock lines → primary invoice (carries shipping); backordered lines → child
    invoice (`is_backorder:true`, `parent_invoice_id`, **forced `draft`**, shipping 0 unless nothing
    is in stock); then a `backorders` row + `backorder_items` (Cluster 7). Returns
    `{invoice, backorder_invoice, split:true}`.

### Detail / edit / delete — `app/api/admin/invoices/[id]/route.ts`
- **GET:** admin/assistant any; affiliate gated by `affiliateCanAccessInvoice` + `affiliateOwnsInvoice`;
  returns the invoice with `amount_paid`/`amount_due`/`status_effective`.
- **PATCH** (admin or affiliate-over-own): whitelisted header fields; **replaces line items** when
  supplied (delete-then-insert) and, for non-backorder invoices, re-syncs the open backorder via
  `syncInvoiceBackorder` (Cluster 7); recomputes subtotal/tax/total when items/tax/shipping change;
  re-snapshots commission (wiping **only pending** `sales_commissions`, never paid); **on first
  transition to `paid`** runs `adjust_stock_for_invoice` + low-stock + (after response)
  `autoBuyLabelForPaidInvoice` (Cluster 7); `invoice.update` audit; returns the fresh invoice.
- **DELETE** (admin): deletes the invoice (lines/payments cascade); `invoice.delete` audit.

### Payments — `app/api/admin/invoices/[id]/payments/route.ts`
- Admin only (`canCreate`). Validates amount > 0 and method ∈ allowed set. **Overpay guard:**
  `amount > (total − paidSoFar) + 0.001` → **422**. Inserts the payment, recomputes status
  (`paid` when `newPaidTotal ≥ total`, else `partial`). **On `paid`:** `adjust_stock_for_invoice`
  (idempotent) + `checkLowStockForProducts` + (after response) `autoBuyLabelForPaidInvoice`.
  `invoice.payment` audit. **This is the e-Transfer stock-decrement closing the Cluster-5 loop.**

### Email — `app/api/admin/invoices/[id]/email/route.ts`
- `canEdit` (admin). Loads the invoice (+customer/sales person/lines/payments) and **`site_settings`**
  templates + `invoice_cc_emails`. Recipient = body override ?? invoice email ?? customer email (400
  if none). BCC = body override (the modal's checkbox selection) else the configured CC list.
  `buildInvoiceMergeVars` → `renderTemplate` for customer + admin subject/body. **`renderInvoicePdf`**
  (pdfkit) → Buffer attachment `{invoice_number}.pdf`. Sends the customer mail (text + HTML +
  attachment) and, if BCC present, an admin copy. **Always logs `invoice_email_log`** (success or
  failure). On success: updates `last_emailed_*` and flips `draft → sent`; `invoice.email_sent` audit.
- Builds its **own** nodemailer transport inline (smtp.protonmail.ch:587) — same transport family as
  Cluster 2 but not routed through its senders.

### Aging — `app/api/admin/invoices/aging/route.ts`
- admin/assistant/affiliate (affiliate-scoped). Runs `mark_overdue_invoices()`; selects unpaid,
  non-draft invoices; buckets outstanding `due` by days overdue into `current / 1-30 / 31-60 / 61-90
  / 90+`.

### PDF — `lib/invoice-pdf.ts`
- `renderInvoicePdf(inv)` → `Buffer` via **pdfkit**. Brand palette (`ink #07203A`, `vital #438B9E`,
  `rule #D5E2E7`, `surface #F7FAFB`); draws header + status pill (from `INVOICE_STATUS_META`, status
  via `effectiveStatus`), bill-to, line-item table, totals. `runtime='nodejs'`.

### UI (Tier D)
- **List** `app/(admin)/admin/invoices/page.tsx` — summary cards (count/outstanding/overdue/paid),
  status filter, search, pagination; also hosts the **PricelistsTab** (Cluster 4) and reads via
  `getInvoices`. Status badges from `INVOICE_STATUS_META`.
- **New / Edit** via **`components/admin/InvoiceForm.tsx`** (~1180 lines): line-item builder with
  product autocomplete (prices default from the active pricelist — Cluster 4), customer/sales-person
  pickers (+ inline create modals), fulfillment type, tax/shipping; posts `createInvoice` /
  `replaceInvoice`.
- **Detail** `app/(admin)/admin/invoices/[id]/page.tsx` — Record Payment, Send Email (modal:
  recipient + BCC checkboxes), Download PDF (`/[id]/pdf`), status dropdown (warns when marking paid
  that stock will decrement), Edit, Delete.

---

## 4. UI/UX design overview

Shared admin theme: `ink #07203A`, `ink-muted #4E6E85`, `vital #438B9E`, `surface #F7FAFB`,
`line #D5E2E7`. Icons `lucide-react`.

- **Status badges** (`INVOICE_STATUS_META`): draft `bg-gray-500/10 text-gray-600`; sent
  `bg-blue-500/10 text-blue-600`; partial `bg-amber-500/10 text-amber-600`; paid
  `bg-emerald-500/10 text-emerald-600`; overdue `bg-red-500/10 text-red-600`. The PDF reuses the
  matching `pdfBg`/`pdfFg` hexes.
- **Cards/buttons/inputs:** standard admin recipe — `bg-white rounded-xl border border-line`;
  primary `bg-ink hover:bg-ink/90 text-white rounded-lg`; inputs `bg-surface border border-line
  focus:ring-2 focus:ring-vital/40`.
- **Detail actions:** Record Payment / Send Email / Download PDF / status dropdown, with success/error
  inline banners; the Send-Email modal lets the user choose BCC recipients (defaulting to the
  configured CC list).
- **Aging:** five labeled buckets with count + outstanding total.
- **Emails/PDF:** branded `VYTA` documents; the email body is plain-text templates rendered to
  HTML via `plainTextToHtml` (Cluster 2), PDF via pdfkit.

---

## 5. Data flow & behavior

### Create (admin form)
validate lines → split on stock → for each invoice: **spawn order + order_items** → insert invoice +
lines → commission row (Cluster 9) → if paid, decrement stock → audit. Split emits a backorder child +
`backorders`/`backorder_items` (Cluster 7).

### Auto-create from order (Cluster 5 inbound)
checkout calls `autoCreateInvoiceFromOrder` (idempotent via `uniq_invoices_order_id`): builds a draft
invoice from the order, spreading the affiliate discount across lines and recovering shipping.

### Payment → paid → stock (closing the Cluster-4/5 loop)
record payment (overpay-guarded 422) → recompute status → **on full payment**:
`adjust_stock_for_invoice` (idempotent via `stock_adjusted`, uuid `product_id`) + low-stock recheck +
(after response) auto-buy label. e-Transfer orders decrement stock **here**, not at checkout.

### Overdue (dual computation)
`mark_overdue_invoices()` persists `overdue` on list/aging GETs; `effectiveStatus` derives
`status_effective` live for every row so views are correct between sweeps.

### Email
load templates + CC from `site_settings` → render → pdfkit attachment → send customer (+BCC admin
copy) → log `invoice_email_log` → on success set `last_emailed_*` + `draft → sent`.

### Authorization
admin: full. assistant: read (list/detail/aging/pdf), no mutations. affiliate (Cluster 8): read +
create + edit **scoped** to bound customers / own sales-person invoices; rate locked to the admin-set
value; can't reassign to unowned customers. Stripping Cluster 8 removes `invoice-access.ts`, the
affiliate branches in every route, and `canEditInvoice`'s affiliate grant.

---

## 6. Edge cases & states

- **Sequence missing:** invoice insert fails on the default expression — create `invoice_number_seq`
  first.
- **Second invoice per order:** blocked by `uniq_invoices_order_id` (autoCreate returns the existing
  one).
- **Overpayment:** 422 with the exact remaining-due amount.
- **All lines backordered:** no primary invoice; shipping rides the backorder child; response returns
  the backorder invoice as `invoice`.
- **Line-insert failure on create:** the just-created invoice is rolled back.
- **Marking paid twice / paid→unpaid→paid:** `stock_adjusted` claim makes the decrement run at most
  once.
- **No customer email on send:** 400 unless a recipient override is provided.
- **Email send failure:** still logged to `invoice_email_log` (success:false), status not advanced,
  500 returned.
- **Affiliate accessing a non-owned invoice:** 403.
- **Overdue display vs persisted:** `status_effective` may read `overdue` before the next sweep
  persists it.

---

## 7. Open questions & unverified items

- **Cluster seams documented at the boundary only:** `syncInvoiceBackorder` + `backorders`/
  `backorder_items` + warehouse fulfillment columns (Cluster 7); `autoBuyLabelForPaidInvoice` +
  Easyship (Cluster 7); `sales_commissions` lifecycle beyond invoice create/patch (Cluster 9);
  `invoice_email_log` table ownership + `site_settings` templates (Cluster 10/2). Their full internals
  weren't traced here.
- **`product_variant_id` / `product_variants`** is referenced by `invoice_line_items` but the variants
  table/feature wasn't examined — appears unused by the current create/edit paths (lines carry
  `product_id`, not variants). Confirm before porting.
- **`non_payable`, `handling_checklist`, `packed_photos`, `fulfillment_status`/`packed_*`/`fulfilled_*`**
  columns exist on `invoices` but are driven by Cluster 7 (warehouse); not written by this cluster's
  routes.
- **`InvoiceForm.tsx` (~1180 lines)** and the list/detail pages were captured at the structural level
  (actions, data calls, key fields, the pricelist default seam) rather than transcribed line-by-line.
- **PDF rendering** (`lib/invoice-pdf.ts`, ~429 lines) summarized by role + palette; exact layout
  geometry not transcribed.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes); SMTP vars
  (email route); Easyship key (auto-buy label, Cluster 7).
