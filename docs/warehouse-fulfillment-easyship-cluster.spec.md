# Warehouse Fulfillment Portal + EasyShip Integration — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `warehouse-fulfillment` / `warehouse-activity` / `warehouse-packing-checklist` /
> `warehouse-emails-orders` migrations + the EasyShip migrations; `lib/warehouse/api.ts`,
> `lib/admin/warehouse-staff.ts`, `lib/shipping/easyship.ts`, `lib/shipping/auto-shipment.ts`; routes
> `app/api/warehouse/queue/*`, `app/api/admin/warehouse/activity`, `app/api/admin/orders/[id]/*`
> (rates/label/buy-label/create-shipment/...), `app/api/shipping/rates`, `app/api/webhooks/easyship`;
> and the portal/admin pages. Stack: **Next.js 15 App Router** (`after()`) + **Supabase** (service-role
> + **Realtime**) + **nodemailer SMTP** + **EasyShip REST** + **Tailwind**.
>
> Describes the code **as it exists**. Port **eighth**, on top of Invoices (6), Orders (5), Backorders
> (7). It owns the warehouse-facing fulfillment workflow + the EasyShip rate/label/webhook integration.

---

## 0. The traps, up front

1. **The queue IS the `invoices` table** — there's **no separate fulfillment table**. Warehouse work
   is columns on `invoices`/`invoice_line_items` joined to the linked `orders` row. **Cluster 5/6 must
   exist first.**
2. **Warehouse read RLS is the Realtime enabler.** `invoices_warehouse_read` +
   `line_items_warehouse_read` policies (role = `warehouse`) + `ALTER PUBLICATION supabase_realtime ADD
   TABLE invoices` are what let the portal's `postgres_changes` subscription receive live changes.
   Without them the live queue is silent.
3. **Status sync is invoice → order:** marking an invoice `shipped`/`picked_up` updates the linked
   order's status (`shipped`/`delivered`). Best-effort.
4. **Per-line backorder → a non-payable DRAFT child invoice** (`parent_invoice_id`, `is_backorder:true`,
   `non_payable:true`). Draft keeps it **off the queue**; **one child per parent** (created once, then
   reused; lines merge by description).
5. **Notification permission gate:** admins always; warehouse staff **only** with
   `can_send_fulfillment_emails` (toggled from the admin warehouse page → `PUT /api/admin/users/[id]`).
6. **Packed photos default to the existing `products` bucket** (override `WAREHOUSE_PHOTOS_BUCKET`)
   under `packing/<invoice_id>/`.
7. **EasyShip `ALLOWED_COURIERS = ['ups','fedex']`** whitelist limits what's quoted/charged;
   `applyHandlingFee` folds the markup **into the rate** (never a separate line); config comes from
   `site_settings` (Cluster 10) with env fallback.
8. **Auto-shipment is best-effort & error-swallowed** — never blocks checkout/payment; logs to
   `shipment_auto_logs` + `orders.auto_shipment_*`. Skips pickup / already-shipped / no-postal.
9. **Webhook advances status forward-only via `ORDER_FLOW`** (never regresses, never overrides
   `cancelled`/`expired`); verifies HMAC **or** a shared secret.
10. **Per-staff performance is derived from `audit_log` `invoice.fulfillment_update` rows** — the
    Cluster-1 audit infra must be wired (and every status change logs one).

---

## 1. Overview

Warehouse staff (role `warehouse`, plus admins) work a **live queue** of non-draft invoices. The
portal subscribes to Supabase Realtime on `invoices` (enabled by the warehouse read RLS + publication)
and re-fetches on any change. Each queue card carries the fulfillment method (`shipment`/`pickup`), a
workflow status (`pending → packed → shipped|picked_up`), a handling checklist, per-line
fulfilled/backordered quantities, packed photos, and the linked order's shipping/label/tracking. Staff
advance status (which stamps who/when and syncs the order + logs an audit row), tick the checklist,
fulfill or backorder individual lines (backorders funnel into one non-payable draft child invoice),
attach packed photos, and — if permitted — send "packed/ready" and "shipped" customer emails. The
EasyShip layer quotes UPS/FedEx-only rates (with a folded-in handling fee), creates draft shipments
and buys labels (manually via admin order endpoints or automatically via the best-effort
auto-shipment flow), and a webhook keeps order tracking/status fresh. An admin warehouse page shows
staff accounts, per-person performance (from the audit log), a recent activity feed, and the
email-permission toggle.

---

## 2. Schema (all additive on `invoices`/`invoice_line_items`/`orders`)

### `warehouse-fulfillment-migration.sql`
- `ALTER TYPE user_role ADD VALUE 'warehouse'` (run alone — can't add + use a value in one txn).
- `orders.fulfillment_type text CHECK (shipment|pickup)` (backfilled from `notes='PICKUP'`).
- `invoices.fulfillment_type text NOT NULL DEFAULT 'shipment' CHECK (shipment|pickup)` (inherited from
  the linked order) and `invoices.fulfillment_status text NOT NULL DEFAULT 'pending' CHECK
  (pending|packed|shipped|picked_up)` + indexes. **No warehouse RLS yet** (routes are service-role).

### `warehouse-activity-migration.sql` (Realtime enabler)
- `invoices.packed_at/packed_by`, `fulfilled_at/fulfilled_by` (FK → customers SET NULL) — fast
  denormalized attribution (per-step history still in `audit_log`).
- **RLS:** `invoices_warehouse_read` + `line_items_warehouse_read` — `FOR SELECT TO authenticated
  USING (EXISTS … role='warehouse')`.
- **Realtime:** `ALTER PUBLICATION supabase_realtime ADD TABLE invoices` (idempotent guard).

### `warehouse-packing-checklist-migration.sql`
- `invoices.handling_checklist jsonb '[]'`, `invoices.packed_photos jsonb '[]'`, `invoices.non_payable
  boolean false`.
- `invoice_line_items.qty_fulfilled integer 0`, `qty_backordered integer 0`.
- Packed photos → existing public `products` bucket under `packing/<invoice_id>/` (override
  `WAREHOUSE_PHOTOS_BUCKET`); no extra bucket/RLS required.

### `warehouse-emails-orders-migration.sql` (owned by Cluster 10/2, written here)
- `customers.can_send_fulfillment_emails boolean false` (the notify gate).
- `invoices.packed_emailed_at`, `shipped_emailed_at`.
- `fulfillment_email_log` (kind `packed|shipped`, to_email, subject, message_id, success, error,
  sent_by/_email) + RLS read for admin/assistant/warehouse.

### EasyShip migrations (Cluster 10 settings + order columns)
- `easyship-settings-migration.sql`: `site_settings.easyship_enabled/api_key/shipping_origin/box/
  item_weight_kg/flat_rate`; `orders.easyship_shipment_id/tracking_status/tracking_url/carrier`.
- `easyship-labels-migration.sql`: order label columns (`label_state`, `label_url`).
- `easyship-auto-shipment-migration.sql`: `site_settings.easyship_auto_create_shipment/
  auto_courier_preference/auto_buy_label`; `orders.auto_shipment_status/stage/error/attempted_at`; the
  **`shipment_auto_logs`** feed (RLS admin/assistant read; service-role write).

### Schema usage map

| Table.column | Read by | Written by |
|---|---|---|
| `invoices.fulfillment_status` + `packed_*`/`fulfilled_*` | queue, activity, Realtime | queue PATCH |
| `invoices.handling_checklist` | queue | checklist PATCH |
| `invoices.packed_photos` | queue | photo route |
| `invoice_line_items.qty_fulfilled/qty_backordered` | queue | line route |
| `invoices` (non_payable/is_backorder/parent_invoice_id child) | — | line route (backorder child) |
| `orders.status` | queue card, webhook | queue PATCH (sync), webhook |
| `orders.label_state/url`, tracking, `easyship_shipment_id` | queue card | admin order routes, auto-shipment, webhook |
| `orders.auto_shipment_*` + `shipment_auto_logs` | admin dashboard | auto-shipment (best-effort) |
| `customers.can_send_fulfillment_emails` | notify gate, activity | admin users PUT (toggle) |
| `fulfillment_email_log` + `packed/shipped_emailed_at` | (staff read) | notify route |
| `audit_log` (`invoice.fulfillment_update`) | activity (perf + feed) | queue PATCH |

---

## 3. Components

### Warehouse domain lib — `lib/warehouse/api.ts`
- Types `QueueItem` / `QueueLineItem` / `PackedPhoto` / `QueueSummary` / `QueueViewer`
  (`{role, can_send_emails}`) / `NotificationPreview`.
- Client wrappers (bearer): `getQueue(filters)`, `updateFulfillmentStatus`, `saveChecklist`,
  `fulfillLine`, `backorderLine`, `uploadPackedPhoto`/`deletePackedPhoto`, `previewNotification`,
  `sendNotification`.
- **Handling instructions:** `SHIPMENT_STEPS` (verify→pack→label) and `PICKUP_STEPS`
  (verify→pack→handoff), each step keyed + mapped to a `fulfillment_status`; `stepsFor(type)`,
  `currentStepIndex`, `isComplete`, `statusLabel`, `timeAgo`, `formatWhen`.

### Queue read (Realtime) — `GET /api/warehouse/queue`
- **`verifyWarehouse`** (exported, reused by the sub-routes): resolves role +
  `can_send_fulfillment_emails`; `authorized = role ∈ {warehouse, admin}`; `canSendEmails = admin ||
  (warehouse && can_send_fulfillment_emails)`. **The role check IS the access boundary** (service-role
  client).
- Selects non-draft invoices (`.neq('status','draft')`), newest first, joining customer/packer/
  fulfiller + the linked `order` (status, tracking, `label_state`/`label_url`, shipping_address) +
  line items. Optional `fulfillment_status`/`fulfillment_type` filters. Maps to `QueueItem`
  (`has_label = label_state==='generated'`, `item_count` = Σ qty), computes `summary` (toFulfill =
  pending+packed, split shipments/pickups), returns `{items, summary, viewer}`.
- **Realtime:** the portal opens `supabase.channel('warehouse-queue').on('postgres_changes', …
  invoices).subscribe()` and re-fetches `getQueue()` on any event — live because of the warehouse read
  RLS + publication.

### Mutations (`verifyWarehouse`-gated)
- **`PATCH /api/warehouse/queue/[id]`** (status) — validates `fulfillment_status`; blocks drafts;
  enforces method consistency (`shipped` only for shipment, `picked_up` only for pickup); stamps
  `packed_at/by` (first time) or `fulfilled_at/by`; **syncs the linked order** (`shipped`→`shipped`,
  `picked_up`→`delivered`, best-effort); logs **`invoice.fulfillment_update`** `{from,to}` (the
  performance source).
- **`PATCH /api/warehouse/queue/[id]/checklist`** — persists the array of checked step keys.
- **`POST /api/warehouse/queue/[id]/line`** — `action: 'fulfill' | 'backorder'`.
  - **fulfill:** caps `qty_fulfilled` at `qty − backordered`.
  - **backorder:** moves `min(reqQty, qty − fulfilled − backordered)` onto the **one** bound backorder
    invoice (`getOrCreateBackorderInvoice`: draft, `is_backorder`, `non_payable`, `parent_invoice_id`;
    also inserts a `backorders` row); merges into an existing matching line by description; bumps the
    original line's `qty_backordered`; recomputes the backorder invoice totals. Logs
    `invoice.line_fulfill` / `invoice.line_backorder`.
- **`POST/DELETE /api/warehouse/queue/[id]/photo`** — multipart upload to bucket
  `WAREHOUSE_PHOTOS_BUCKET || 'products'` at `packing/<id>/<ts>-<rand>.<ext>`; appends/removes
  `{url,path,uploaded_at}` on `invoices.packed_photos`.
- **`POST /api/warehouse/queue/[id]/notify`** — **permission-gated** (`canSend`). `kind: packed|
  shipped`; `preview:true` returns rendered subject/body (+ defaults) for the editable modal.
  Per-method default templates (`{{order_number}}`, `{{customer_first_name}}`, `{{tracking_number}}`,
  `{{carrier}}`, `{{tracking_url}}`); honors client overrides. Builds its own nodemailer transport,
  sends text+HTML (`plainTextToHtml`), **always logs `fulfillment_email_log`**, stamps
  `packed_emailed_at`/`shipped_emailed_at` on success, logs `fulfillment.email_sent`.

### EasyShip integration — `lib/shipping/easyship.ts`
- **`getShippingConfig()`** — reads `site_settings` (enabled, api_key, origin, box, item_weight,
  flat_rate, handling fee type/value) with **progressive column fallback** + **env fallback**
  (`EASYSHIP_API_KEY`, `EASYSHIP_API_URL`).
- **`ALLOWED_COURIERS = ['ups','fedex']`** + `isAllowedCourier(rate)` (umbrella_name or whole-word
  name match) — only these are quoted/bought.
- **`applyHandlingFee(cost, config)`** — adds a flat CAD amount or a % of the rate; **folds it into the
  quoted price** (single shipping figure, never itemized).
- `getEasyshipRates` / `getCheapestEasyshipRate` / `resolveShippingCost` (used by checkout, Cluster 5)
  / `getShippingQuoteOrFallback` (falls back to `flat_rate`) / `diagnoseShipping`.
- `createEasyshipShipment`, `getEasyshipShipmentLabel`, `extractLabelInfo`, `fetchEasyshipDocument`,
  `buyEasyshipLabel`.
- Consumed by admin order endpoints: `GET /api/admin/orders/[id]/rates`, `.../label`,
  `.../buy-label`, `.../create-shipment`, `.../label-readiness`, `.../shipping-address`; the public
  `GET /api/shipping/rates` (checkout courier selector); `GET /api/admin/shipping/diagnose`.

### Auto-shipment — `lib/shipping/auto-shipment.ts` (best-effort, server-only)
- `getAutoShipmentSettings()` → `{autoCreate, courierPreference, autoBuyLabel}` (off by default;
  tolerant of missing columns).
- **`autoCreateShipmentForOrder(db, order, force?)`** — **skips** when: order already has
  `easyship_shipment_id`, is pickup, `autoCreate` off (unless forced), or no postal code. Picks the
  preferred courier (UPS/FedEx/cheapest), creates the shipment, writes `orders.easyship_shipment_id/
  tracking/carrier`. **Records every outcome** to `orders.auto_shipment_status/stage/error/
  attempted_at` + a `shipment_auto_logs` row. **Swallows all errors.** Called from Cluster 5 checkout
  (after response) and the crypto-confirm cron.
- **`autoBuyLabelForPaidInvoice(db, invoiceId)`** — when `autoBuyLabel` on + not pickup + the invoice
  has an order: buys the label. Called from Cluster 6 (payment + PATCH-to-paid, via `after()`).

### Webhook — `POST /api/webhooks/easyship`
- **Verification:** `EASYSHIP_WEBHOOK_SECRET` → HMAC-SHA256 of the raw body (base64 **or** hex) in
  `x-easyship-hmac-sha256`, **or** shared secret in `x-easyship-webhook-secret` (timing-safe compare).
  No secret → accept unverified (test mode, warns).
- Matches the order by `easyship_shipment_id` → `order_number` → `tracking_number`; updates tracking/
  carrier/label fields. **`mapToOrderStatus`** → `shipped`/`delivered`/null; advances status **only
  forward along `ORDER_FLOW = [pending, received, confirmed, processing, shipped, delivered]`** and
  **never** when current is `cancelled`/`expired` (`TERMINAL`). Acknowledges unmatched events so
  EasyShip stops retrying.

### Admin staff management — `lib/admin/warehouse-staff.ts` + `GET /api/admin/warehouse/activity`
- `getWarehouseActivity()` → `{accounts, performance, logs}`; `setWarehouseEmailPermission(userId,
  canSend)` → `PUT /api/admin/users/[id] {can_send_fulfillment_emails}` (Cluster 1 route).
- **Activity route** (admin/assistant): lists `warehouse` accounts; reads up to 500
  `audit_log` `invoice.fulfillment_update` rows; **derives per-account performance**
  (packed/shipped/picked_up/completed/completed_today/last_active from `payload.to`); builds a recent
  60-event feed (resolving invoice/order numbers). **Performance only counts events whose actor is a
  warehouse account.**

### UI
- **`app/(warehouse)/warehouse/layout.tsx`** — gates on `canAccessWarehouse(role)` (`warehouse` or
  `admin`); shows `AMINOCAN` shell or `Access Denied`.
- **`app/(warehouse)/warehouse/page.tsx`** + `_components/QueueRow`/`QueueDetail` — summary cards, the
  Realtime-backed queue, per-card status stepper, checklist, per-line fulfill/backorder, photo upload,
  notify modal (shown only when `viewer.can_send_emails`).
- **`app/(admin)/admin/warehouse/page.tsx`** — staff accounts, **Performance** table, **Activity**
  feed, and the per-staff email-permission toggle (read-only for assistant).

---

## 4. UI/UX design overview

Shared admin/warehouse theme: `ink #1A1A1A`, `ink-muted #6E6E6E`, `bronze #9C8B5A`, `surface #F7F7F7`,
`line #C9CCD1`; accents emerald (complete), amber (pending/packed), indigo (performance). Icons
`lucide-react`.

- **Queue status labels:** `pending → "To pack"`, `packed → "Packed"`, `shipped → "Shipped"`,
  `picked_up → "Picked up"`; the step stepper highlights `currentStepIndex`.
- **Cards/buttons/inputs:** standard recipes — `bg-white rounded-xl border border-line`; primary
  `bg-ink hover:bg-ink/90 text-white`; the notify modal is an editable subject/body preview.
- **Times** rendered via `timeAgo` ("2m ago") / `formatWhen` (absolute).
- **Admin warehouse:** Performance (`Boxes` indigo) sorted by completed desc; Activity (`Activity`)
  feed of recent fulfillment events; email-permission toggle per staff row.
- **Emails:** plain-text fulfillment templates rendered to HTML via `plainTextToHtml` (Cluster 2).

---

## 5. Data flow & behavior

### Live queue
Portal `getQueue()` → renders cards; `supabase.channel('warehouse-queue')` `postgres_changes` on
`invoices` → re-fetch. Live only because of `invoices_warehouse_read` + the `supabase_realtime`
publication.

### Advance status (invoice → order sync + audit)
staff PATCH status → stamp who/when → if terminal, update linked `orders.status`
(`shipped`/`delivered`) → log `invoice.fulfillment_update` (drives performance).

### Per-line backorder
move excess onto the **single** non-payable draft child (`getOrCreateBackorderInvoice`, reused),
merge by description, bump `qty_backordered`, recompute child totals. Draft → invisible to the queue;
non_payable → never collected.

### Notifications (gated)
admin always; warehouse only with `can_send_fulfillment_emails`. Preview → editable modal → send →
`fulfillment_email_log` + `packed/shipped_emailed_at` + `fulfillment.email_sent` audit.

### EasyShip rates & labels
quotes restricted to UPS/FedEx (`ALLOWED_COURIERS`); handling fee folded in (`applyHandlingFee`);
manual via admin order endpoints; auto via `autoCreateShipmentForOrder` (checkout, after-response) +
`autoBuyLabelForPaidInvoice` (invoice paid) — both best-effort, logged to `shipment_auto_logs` +
`orders.auto_shipment_*`, skipping pickup/already/no-postal.

### Webhook
verify (HMAC/shared) → match order → update tracking/label → advance status **forward-only**
(`ORDER_FLOW`), never over `cancelled`/`expired`.

### Authorization
Warehouse routes: `warehouse`/`admin` (service-role client + role check). Notify: + the email gate.
Admin warehouse page/activity: admin/assistant. Webhook: secret-verified. RLS warehouse-read exists
for the Realtime path only.

---

## 6. Edge cases & states

- **Realtime silent:** missing warehouse read RLS or publication → no live updates (queue still loads
  via the service-role API).
- **Draft invoice:** excluded from the queue; status PATCH on a draft → 400.
- **Method mismatch:** `shipped` on a pickup (or `picked_up` on a shipment) → 400.
- **Over-fulfill / over-backorder a line:** capped server-side; nothing-left-to-backorder → 400.
- **Notify without permission / no recipient:** 403 / 400; send failure still logs (success:false) →
  500.
- **EasyShip disabled/unconfigured/no postal:** rates `[]` → checkout falls back to `flat_rate`;
  auto-shipment skips.
- **Non-UPS/FedEx couriers:** filtered out of quotes entirely.
- **Auto-shipment failure:** swallowed; recorded on the order + `shipment_auto_logs`; checkout/payment
  unaffected.
- **Webhook:** unverified (no secret) accepted with a warning; bad signature → 401; unmatched → 200
  `matched:false`; status never regresses or overrides cancelled/expired.
- **Performance:** only counts warehouse-actor events; admin-driven status changes appear in the feed
  but not the per-staff perf table.

---

## 7. Open questions & unverified items

- **`ALTER TYPE user_role ADD VALUE 'warehouse'`** must run in its own transaction before any use (the
  migration warns). Sequencing matters when porting.
- **`fulfillment_email_log` / `can_send_fulfillment_emails` / EasyShip `site_settings` columns** are
  defined in the warehouse/EasyShip migrations but conceptually owned by Clusters 10/2/6 — documented
  here at the boundary.
- **Admin order endpoints** (`rates`, `label`, `buy-label`, `create-shipment`, `label-readiness`,
  `shipping-address`) and `lib/shipping/easyship.ts` (~896 lines) were captured at the
  export/behavior level (whitelist, handling fee, config) — the per-endpoint request/response shapes
  and the full EasyShip request bodies were not transcribed line-by-line.
- **The portal pages** (`page.tsx`, `QueueRow`, `QueueDetail`, admin warehouse page) were captured at
  the structural level (Realtime wiring, gating, the data calls, status stepper) rather than
  line-by-line styling.
- **`shipment_auto_logs`** was confirmed as the auto-shipment feed (defined in
  `easyship-auto-shipment-migration.sql`, Cluster 7 spec) — written here by `recordAutoOutcome`.
- **`crypto-confirm cron` Easyship shipment creation** (Cluster 5's cron) overlaps with auto-shipment;
  the cron path uses `createEasyshipShipment` directly rather than `autoCreateShipmentForOrder`.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (Realtime client); `EASYSHIP_API_KEY`, `EASYSHIP_API_URL`, `EASYSHIP_WEBHOOK_SECRET`;
  `WAREHOUSE_PHOTOS_BUCKET` (optional); SMTP vars (notify, Cluster 2).
