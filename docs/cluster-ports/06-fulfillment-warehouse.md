# Cluster 6 — Fulfillment / Warehouse: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 6 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **eighth** (after 1, 10, 2, 3, 4, 5, 7) — it sits on top
> of invoices (5) and orders (4) and integrates EasyShip.
>
> **Companion deep specs:** `docs/module-ports/02-inventory-and-stock.md`, plus
> `changelogs/2026-06-22-warehouse-packing-checklist.md`.

---

## 1. What the cluster is / does

The **warehouse fulfillment portal** + the **EasyShip shipping integration**:
- A live (Supabase Realtime) **queue of non-draft invoices** to pack/ship.
- A **status workflow** (pending → packed → shipped / picked_up) that syncs the linked order.
- A method-aware **handling checklist**, **per-line fulfill/backorder**, and **packed-photo** capture.
- **Fulfillment notification emails** (packed/shipped) gated by a per-staff permission.
- **EasyShip**: rates, shipment creation, label purchase (manual + best-effort auto), and **tracking
  webhooks**. Plus admin-side **warehouse-staff management**.

**Key mental model — the queue IS the invoices table.** There is no separate "fulfillment" table;
warehouse work is columns on `invoices`/`invoice_line_items` joined to the linked `orders` row.

---

## 2. Database schema — what exists and where it comes from

### Columns added to `invoices` (warehouse)
| Migration | Columns |
|-----------|---------|
| `warehouse-fulfillment-migration.sql` | `fulfillment_type text NOT NULL DEFAULT 'shipment' CHECK ('shipment','pickup')`, `fulfillment_status text NOT NULL DEFAULT 'pending' CHECK ('pending','packed','shipped','picked_up')` + indexes |
| `warehouse-activity-migration.sql` | `packed_at`, `packed_by → customers`, `fulfilled_at`, `fulfilled_by → customers` + **warehouse read RLS** on invoices & line_items |
| `warehouse-packing-checklist-migration.sql` | `handling_checklist jsonb DEFAULT '[]'` (array of step keys), `packed_photos jsonb DEFAULT '[]'` (`{url,path,uploaded_at}`), `non_payable boolean` (backorder children) |
| `warehouse-emails-orders-migration.sql` | `packed_emailed_at`, `shipped_emailed_at` |

### Columns added to `invoice_line_items`
`warehouse-packing-checklist-migration.sql`: **`qty_fulfilled integer DEFAULT 0`**,
**`qty_backordered integer DEFAULT 0`**.

### Columns added to `orders` (shipping)
| Migration | Columns |
|-----------|---------|
| `warehouse-fulfillment-migration.sql` | `fulfillment_type CHECK ('shipment','pickup')` |
| `easyship-settings-migration.sql` | `easyship_shipment_id`, `tracking_status`, `tracking_url`, `carrier` + partial index |
| `easyship-labels-migration.sql` | `label_state` (`not_created|pending|generated|failed`), `label_url` |
| `easyship-auto-shipment-migration.sql` | `auto_shipment_status/stage/error/attempted_at` |

### Column added to `customers`
`warehouse-emails-orders-migration.sql`: **`can_send_fulfillment_emails boolean DEFAULT false`**.

### Tables
- **`fulfillment_email_log`** (`warehouse-emails-orders-migration.sql`) — `invoice_id → invoices`,
  `order_id → orders`, `kind CHECK('packed','shipped')`, `to_email`, `subject`, `message_id`,
  `success`, `error`, `sent_by → customers`, `sent_by_email`, `created_at`. RLS: staff read.
- **`shipment_auto_logs`** (`easyship-auto-shipment-migration.sql`) — per-attempt append-only log
  (`order_id`, `order_number`, `stage`, `ok`, `courier`, `error`, `created_at`). RLS: admin read.
- `site_settings` EasyShip config (Cluster 10) is read by the shipping lib.

### RLS — the Realtime enabler
`warehouse-activity-migration.sql` adds **`invoices_warehouse_read`** and
**`line_items_warehouse_read`** policies (role `warehouse` can SELECT) — required so the warehouse
page's Supabase **Realtime subscription** receives invoice changes. Writes still go through
service-role API routes.

---

## 3. The reading map (open files in this order)

### Tier A — Warehouse domain lib & types

**`lib/warehouse/api.ts`** — *the warehouse contract.* (Read in full.)
- Types: `QueueItem`, `QueueLineItem`, `QueueSummary`, `QueueViewer`, `NotificationKind`,
  `NotificationPreview`. Client wrappers: `getQueue`, `updateFulfillmentStatus`, `saveChecklist`,
  `fulfillLine`, `backorderLine`, `uploadPackedPhoto`, `deletePackedPhoto`, `previewNotification`,
  `sendNotification`.
- **The checklist engine:** `SHIPMENT_STEPS` (3) / `PICKUP_STEPS` (3), `stepsFor(type)`,
  `currentStepIndex(status)`, `isComplete(status)`, `statusLabel`, `timeAgo`, `formatWhen`.

### Tier B — Queue read (Realtime)

**`app/api/warehouse/queue/route.ts`** (`GET`) — *the queue.*
- `verifyWarehouse` resolves role + `can_send_fulfillment_emails` (admin or warehouse).
- Selects **non-draft `invoices`** joined to: `packer`/`fulfiller` (customers),
  **`order:orders!order_id`** (order_number, status, tracking_*, carrier, **label_state/label_url**,
  shipping_address), and `line_items` (qty/qty_fulfilled/qty_backordered). Filters by
  `fulfillment_status`. Shapes into `QueueItem`. UI subscribes to Realtime for live updates.

### Tier C — Mutations (status / line / checklist / photo)

**`app/api/warehouse/queue/[id]/route.ts`** (`PATCH`) — *advance status.*
- Validates `fulfillment_status`. On `packed` (if not already): set `packed_at`/`packed_by`. On
  `shipped`/`picked_up`: set `fulfilled_at`/`fulfilled_by`. **Syncs the linked order status** (→
  `shipped` or `delivered`). Audit `invoice.fulfillment_update`. Shipments can only go `shipped`,
  pickups only `picked_up`.

**`app/api/warehouse/queue/[id]/line/route.ts`** (`POST`) — *per-line fulfill / backorder.*
- `action:'fulfill'` → bump `qty_fulfilled`. `action:'backorder'` → move qty to a **single
  non-payable draft child invoice** bound by `parent_invoice_id` (created on first backorder, reused
  after; **`non_payable:true`, draft status keeps it off the queue**); merges by description; totals
  recompute. Audit `invoice.line_fulfill` / `invoice.line_backorder`.

**`app/api/warehouse/queue/[id]/checklist/route.ts`** (`PATCH`) — persists `handling_checklist`
(array of step keys) on the invoice. Audit `invoice.handling_checklist_update`.

**`app/api/warehouse/queue/[id]/photo/route.ts`** (`POST`/`DELETE`) — *packed photos.*
- Bucket `WAREHOUSE_PHOTOS_BUCKET` (default **`products`**); path `packing/<invoice_id>/<ts>-<rand>.ext`;
  appends `{url,path,uploaded_at}` to `packed_photos`. DELETE removes from storage + array. Audit
  `invoice.packed_photo_add` / `_remove`.

**`app/api/warehouse/queue/[id]/notify/route.ts`** (`POST`) — *fulfillment emails.*
- Permission: admin always; warehouse only if `can_send_fulfillment_emails`. `defaultTemplate(kind,
  isPickup)` (4 variants) with own merge vars (`{{order_number}}`, `{{tracking_number}}`,
  `{{carrier}}`, `{{tracking_url}}`); `plainTextToHtml` (Cluster 10). Sends via its own SMTP
  transport, inserts `fulfillment_email_log`, sets `packed_emailed_at`/`shipped_emailed_at`. Audit
  `fulfillment.email_sent`. Supports `mode:'preview'`.

### Tier D — EasyShip integration

**`lib/shipping/easyship.ts`** — *the EasyShip client.* `getShippingConfig()` (reads `site_settings`
+ env, Cluster 10), `getEasyshipRates`, `getCheapestEasyshipRate`, **`ALLOWED_COURIERS` whitelist** +
`isAllowedCourier` (only certain umbrella couriers shown/charged), **`applyHandlingFee`** (folds the
configured markup into the rate), `resolveShippingCost` (honors customer's chosen courierId),
`getShippingQuoteOrFallback` (flat-rate fallback), `createEasyshipShipment`, `buyEasyshipLabel`,
`getEasyshipShipmentLabel`, `diagnoseShipping`.

**`lib/shipping/auto-shipment.ts`** — best-effort orchestration: `autoCreateShipmentForOrder` (called
from `/api/orders-email`, Cluster 4), `autoBuyLabelForPaidInvoice` (called when an invoice is marked
paid, Cluster 5). Resolves courier by `easyship_auto_courier_preference` (cheapest/ups/fedex),
**polls for PDF generation**, writes `orders.auto_shipment_*` + `shipment_auto_logs`. **All errors
swallowed** (never blocks checkout/payment). Skips: feature off, pickup, already-shipped, no postal code.

**`app/api/webhooks/easyship/route.ts`** (`POST`) — *tracking webhook.*
- Verifies **HMAC-SHA256** (`x-easyship-hmac-sha256`) or shared secret (`x-easyship-webhook-secret`);
  unverified accepted only in test mode. Finds order by `easyship_shipment_id`, updates tracking
  fields, and advances status via **`ORDER_FLOW` forward-only** (`mapToOrderStatus` → shipped/
  delivered; never regress, never override cancelled/expired).

**Admin label panel (admin side of shipping):**
`app/api/admin/orders/[id]/{rates,create-shipment,buy-label,label,label-readiness,shipping-address}`
+ `app/api/admin/shipping/diagnose` + `app/(admin)/admin/orders/[id]/_components/ShippingLabelPanel.tsx`.
`app/api/cron/check-payments` also nudges auto-shipment (Cluster 4).

### Tier E — Warehouse portal & admin staff mgmt
- **Portal:** `app/(warehouse)/warehouse/page.tsx` (Realtime queue, filters, summary cards) +
  `_components/QueueRow.tsx`, `QueueDetail.tsx`. `components/FulfillmentEmailModal.tsx`,
  `components/QRCode.tsx`.
- **Admin view:** `app/(admin)/admin/warehouse/page.tsx` → `app/api/admin/warehouse/activity` →
  `lib/admin/warehouse-staff.ts` (`getWarehouseActivity` — per-staff perf from `audit_log`
  `invoice.fulfillment_update`; `setWarehouseEmailPermission` — toggles `can_send_fulfillment_emails`).
  Create warehouse accounts; assistant is read-only.

---

## 4. End-to-end flows to trace

1. **Queue load:** invoice created (Cluster 5) spawns an order + appears as a non-draft invoice →
   `/api/warehouse/queue` joins order → QueueItem; portal subscribes to Realtime (needs warehouse RLS).
2. **Pack → ship:** PATCH `packed` (packed_at/by) → checklist + photos → PATCH `shipped`
   (fulfilled_at/by + order→shipped) → notify customer (`fulfillment_email_log`, `shipped_emailed_at`).
3. **Partial fulfill:** line POST `fulfill` (qty_fulfilled) / `backorder` (→ non-payable child
   invoice via parent_invoice_id).
4. **Auto-shipment:** order placed → `autoCreateShipmentForOrder` (draft shipment); invoice paid →
   `autoBuyLabelForPaidInvoice` (buy + poll label) → `orders.label_state/label_url` +
   `shipment_auto_logs`.
5. **Tracking:** EasyShip webhook → verify signature → update tracking → advance order status
   forward-only.

---

## 5. Extraction checklist & gotchas

- [ ] **The queue is the invoices table** — no separate fulfillment table. Port the `invoices`/
      `invoice_line_items` warehouse columns (Cluster 5 dependency) before this works.
- [ ] Add the **warehouse read RLS** on invoices + invoice_line_items — without it the Realtime
      subscription is silent.
- [ ] Status sync is **invoice→order**: packed/shipped/picked_up updates the linked order's status.
- [ ] Per-line backorder creates a **non-payable draft child invoice** (`parent_invoice_id`,
      `non_payable:true`) — draft keeps it off the queue; one child per parent (reused).
- [ ] Notification permission: admin always; warehouse only with `can_send_fulfillment_emails`
      (toggled from the admin warehouse page).
- [ ] Packed photos default to the **`products` bucket** (override `WAREHOUSE_PHOTOS_BUCKET`) under a
      `packing/<invoice>/` prefix.
- [ ] EasyShip: `ALLOWED_COURIERS` whitelist limits what's quoted/charged; `applyHandlingFee` folds
      the markup in (never a separate line); config comes from `site_settings` (Cluster 10) with env
      fallback.
- [ ] Auto-shipment is **best-effort & error-swallowed** — keep that so it never blocks checkout/
      payment; it logs to `shipment_auto_logs` and `orders.auto_shipment_*`.
- [ ] Webhook advances status **forward-only via `ORDER_FLOW`** and never overrides cancelled/expired;
      verify HMAC or shared secret (`EASYSHIP_WEBHOOK_SECRET`).
- [ ] Per-staff performance is derived from **`audit_log` `invoice.fulfillment_update`** rows — the
      audit infra (Cluster 1) must be wired.

---

## 6. File index (everything in Cluster 6)

```
DB        warehouse-fulfillment-migration.sql, warehouse-activity-migration.sql (+ warehouse RLS),
          warehouse-packing-checklist-migration.sql, warehouse-emails-orders-migration.sql
            (can_send_fulfillment_emails + fulfillment_email_log + packed/shipped_emailed_at),
          easyship-settings-migration.sql, easyship-labels-migration.sql,
          easyship-auto-shipment-migration.sql (auto_shipment_* + shipment_auto_logs)
libs      lib/warehouse/api.ts, lib/admin/warehouse-staff.ts,
          lib/shipping/easyship.ts, lib/shipping/auto-shipment.ts, lib/shippingStatus.ts
warehouse API app/api/warehouse/queue/route.ts,
          app/api/warehouse/queue/[id]/{route,line,checklist,photo,notify}.ts
admin/ship API app/api/admin/orders/[id]/{rates,create-shipment,buy-label,label,label-readiness,
            shipping-address}.ts, app/api/admin/shipping/diagnose/route.ts,
          app/api/admin/warehouse/activity/route.ts, app/api/webhooks/easyship/route.ts,
          app/api/cron/check-payments/route.ts (auto-shipment nudge)
UI        app/(warehouse)/warehouse/page.tsx + _components/{QueueRow,QueueDetail}.tsx,
          app/(admin)/admin/warehouse/page.tsx,
          app/(admin)/admin/orders/[id]/_components/ShippingLabelPanel.tsx,
          components/FulfillmentEmailModal.tsx, components/QRCode.tsx
docs      docs/module-ports/02-inventory-and-stock.md,
          changelogs/2026-06-22-warehouse-packing-checklist.md
```

**Env:** `EASYSHIP_API_KEY`/`EASYSHIP_WEBHOOK_SECRET`/`SHIP_*` (fallbacks; admin settings win),
`WAREHOUSE_PHOTOS_BUCKET`, `CRON_SECRET`. **Storage:** `products` (or dedicated) bucket for photos.
**Audit actions:** `invoice.fulfillment_update`, `invoice.handling_checklist_update`,
`invoice.line_fulfill`/`_backorder`, `invoice.packed_photo_add`/`_remove`, `fulfillment.email_sent`.
**Seams:** Cluster 5 (queue source + auto-buy on paid), Cluster 4 (auto-create on order), Cluster 2
(stock), Cluster 10 (site_settings + plainTextToHtml), Cluster 7 (line backorder).
```
