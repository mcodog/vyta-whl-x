# Cart → Order → Payment — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: the `orders` live DDL + `migration-orders[-clean].sql` /
> `orders-customer-fk-set-null-migration.sql` / `stock-decrement-migration.sql`; helpers
> `lib/orderTotals.ts`, `lib/orderSource.ts`, `lib/paymentMethod.ts`, `lib/shippingStatus.ts`,
> `lib/rate-limit.ts`; routes `app/api/orders-email/route.ts` (live), `app/api/orders/route.ts`
> (crypto, 410), `app/api/orders/check-payment/route.ts`, `app/api/cron/check-payments/route.ts`,
> `app/api/orders/my-orders/route.ts`; and the cart/checkout UI (`contexts/CartContext.tsx`,
> `app/cart/page.tsx`, `app/checkout/page.tsx`, `app/order/track/page.tsx`).
> Stack: **Next.js 15 App Router** (`after()` for post-response work) + **Supabase**
> (service-role server clients) + **nodemailer SMTP** + **Tailwind**.
>
> Describes the code **as it exists**. Port **fifth** — Products (3) and Pricing (4) feed it;
> Invoices/fulfillment (6) and the affiliate program (8) hang off it.

---

## 0. The traps, up front

1. **Two parallel item stores.** Every order's items live in **both** `orders.items` (JSONB
   snapshot) **and** relational `order_items` rows. Both creation paths insert both; keep them in
   sync. Reads pick whichever suits (the storefront/track reads `orders.items`; stock + reports read
   `order_items`).
2. **`orders.customer_id` is `ON DELETE SET NULL`** — added by
   `orders-customer-fk-set-null-migration.sql`. Without it, deleting a customer who has orders throws
   `orders_customer_id_fkey` FK violation. The migration preserves order history (matches
   `invoices.customer_id`).
3. **`order_items.product_id` is `TEXT`** (a UUID stored as a string) — regex-guarded + cast `::uuid`
   inside `adjust_stock_for_order` (consistent with the Products-cluster note). `invoice_line_items.
   product_id` is `uuid`. Don't "fix" either.
4. **Stock decrement differs by payment path** (both idempotent via `stock_adjusted`):
   - **crypto** → `rpc('adjust_stock_for_order', {p_order_id})` on **confirmation** (in
     check-payment + cron).
   - **e-Transfer** → `rpc('adjust_stock_for_invoice', {p_invoice_id})` when an **admin marks the
     invoice paid** (Cluster 6 seam — stock does *not* decrement at email-checkout time).
5. **e-Transfer has no auto-confirmation.** The live order is created `status:'pending_invoice'`; an
   admin manually marks the bound invoice paid (Cluster 6). Crypto statuses: `pending → received →
   confirmed` (+ `expired`).
6. **Order creation is IP rate-limited** (`lib/rate-limit.ts`, in-memory: 5/min for orders).
7. **Affiliate commission insert + first-touch bind are error-wrapped** (never 500 the order) — a
   clean Cluster-8 strip point, along with `orders.discount_amount`.
8. **`POST /api/orders` returns `410`** — the entire crypto stack (HD wallets, `sol_addresses` pool,
   `payment-monitor`, Web3Provider, price-feed) is **dormant but intact** behind the early return.
   Strip unless crypto may be re-enabled.
9. **`autoCreateShipmentForOrder` + rate/label endpoints are Cluster-6 seams** — port the call sites
   now (they're already wired into checkout via `after()`), implement later.

---

## 1. Overview

The storefront cart (localStorage, `CartContext`) flows into a checkout page that posts to one of two
order-creation endpoints. **The live path is `/api/orders-email`** (Interac e-Transfer / email
invoice): it rate-limits by IP, verifies the customer, resolves affiliate attribution + discount,
re-prices shipping server-side via Easyship, inserts the order (`status:'pending_invoice'`, both item
stores), auto-creates the bound invoice, records any affiliate commission, then — **after the response
(`after()`)** — auto-creates the Easyship draft shipment and sends customer + admin invoice emails.
**The crypto path `/api/orders` is disabled** (returns `410` before any work); its full HD-wallet
implementation remains below the early return. Crypto payment confirmation (when enabled) is driven by
a client poller (`/api/orders/check-payment`) and a secret-gated cron (`/api/cron/check-payments`),
both of which flip status and decrement stock via the order RPC. Customers read their own orders
through `/api/orders/my-orders` and a public order lookup by number.

---

## 2. Schema

### `orders` — live DDL (verbatim, source of truth)

```sql
create table public.orders (
  id uuid not null default gen_random_uuid (),
  customer_id uuid null,
  order_number text not null default ('ORD-'::text || nextval('order_number_seq'::regclass)),
  items jsonb not null,                         -- JSONB snapshot (parallel store #1)
  total numeric not null,
  email text null,
  shipping_address jsonb null,
  crypto text null,                             -- doubles as payment-method indicator ('email' = e-Transfer)
  status text not null default 'pending'::text,
  payment_address text null, payment_amount_expected text null, payment_amount_received text null,
  payment_tx_hash text null, payment_derivation_index integer null,
  payment_confirmed_at timestamptz null, payment_expires_at timestamptz null,
  referral_code text null, tracking_number text null, notes text null,
  created_at timestamptz null default now(), updated_at timestamptz null default now(),
  payment_confirmations integer null default 0,
  billing_address jsonb null, shipping_method text null, shipping_carrier text null, shipping_cost numeric null,
  discount_total numeric null default 0, tax_total numeric null default 0, subtotal numeric null,
  staff_notes text null, easyship_shipment_id text null,
  packed_at timestamptz null, shipped_at timestamptz null, delivered_at timestamptz null, refunded_at timestamptz null,
  stock_adjusted boolean not null default false,         -- idempotency claim for the stock RPC
  source text not null default 'website'::text,          -- 'website' | 'whatsapp_bot' | …
  tracking_status text null, tracking_url text null, carrier text null,
  label_state text null, label_url text null,
  discount_amount numeric(10,2) not null default 0,      -- affiliate discount (Cluster 8 strip)
  fulfillment_type text null,                            -- 'shipment' | 'pickup' (CHECK)
  auto_shipment_status text null, auto_shipment_stage text null,
  auto_shipment_error text null, auto_shipment_attempted_at timestamptz null,
  constraint orders_pkey primary key (id),
  constraint orders_order_number_key unique (order_number),
  constraint orders_customer_id_fkey foreign KEY (customer_id) references customers (id) on delete set null,
  constraint orders_fulfillment_type_check check (fulfillment_type = any (array['shipment','pickup']))
) TABLESPACE pg_default;
-- indexes: status+payment_address (partial), customer_id (×2), order_number, status, created_at desc,
--          easyship_shipment_id (partial), source.
create trigger orders_updated_at BEFORE update on orders for EACH row execute FUNCTION update_orders_updated_at();
```

> The live `order_number` default uses `order_number_seq` (`ORD-…`), but **both creation routes
> override it** with a generated `AMC-XXXXXXXX` code (8 chars from a no-look-alike alphabet) inside a
> 5-try unique-retry loop (`23505` → retry). So persisted order numbers are `AMC-…`; the sequence
> default only applies to rows inserted without one.

### `order_items` (`migration-orders[-clean].sql`)

```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_id TEXT,                               -- TEXT, not uuid (the trap)
  quantity INTEGER NOT NULL,
  price_at_time NUMERIC NOT NULL,
  strength TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
```

`update_orders_updated_at()` (the orders `updated_at` trigger fn) is also defined here.

### FK fix (`orders-customer-fk-set-null-migration.sql`)
Drops the default-`NO ACTION` `orders_customer_id_fkey` and re-adds it `ON DELETE SET NULL` — so
deleting a customer keeps the order and nulls the link. **Required** for the customer hard-delete in
Cluster 1 to succeed.

### Stock RPCs (`stock-decrement-migration.sql`)
`adjust_stock_for_order(p_order_id)` and `adjust_stock_for_invoice(p_invoice_id)` — SECURITY DEFINER,
idempotent via the `stock_adjusted` claim, clamp at `GREATEST(0, …)`. The order RPC regex-guards +
casts `order_items.product_id::uuid`; the invoice RPC uses `invoice_line_items.product_id` directly.
(Full bodies documented in the Products cluster spec.)

### Schema usage map

| Table.column | Read by | Written by |
|---|---|---|
| `orders.*` | both checkout GETs, my-orders, track, admin orders, `deriveOrderTotals` | both POST routes; check-payment/cron (status, payment_*); shipping seams |
| `orders.items` (JSONB) | storefront/track GET, emails, cron shipment | both POST routes |
| `order_items` | `adjust_stock_for_order`, low-stock recompute, product report | both POST routes |
| `orders.stock_adjusted` | `adjust_stock_for_order` (claim) | the RPC |
| `orders.discount_amount` / `referral_code` | totals, emails | both POST routes (Cluster 8) |
| `commissions` / `customers.affiliate_id` | — | both POST routes (error-wrapped; Cluster 8) |
| `site_settings.admin_emails` | order-email `after()` | (config cluster) |

---

## 3. Components

### Helpers (Tier A)

- **`lib/orderTotals.ts` — `deriveOrderTotals(order, items)`** → `{rawSubtotal, discount,
  discountedSubtotal, shipping, total}`. Orders don't persist a separate shipping figure (it was
  folded into `total` at checkout), so **shipping is recovered** as `total − discountedSubtotal`
  (0 for pickup). Mirrors the invoice generator so the admin order view and invoice agree. Discount
  = `max(0, order.discount_amount)`.
- **`lib/shippingStatus.ts`** — `isPickupOrder(o)` (`fulfillment_type==='pickup' || notes==='PICKUP'`),
  `shippingState(o)` → `'pickup' | 'created' (has easyship_shipment_id) | 'none'`, + label/badge
  helpers (emerald=created, amber=none, neutral=pickup).
- **`lib/paymentMethod.ts`** — maps the `crypto` column to a label (`email`/`etransfer` → "Interac
  e-Transfer"; `btc`/`eth`/`sol` → tickers) + a short label.
- **`lib/orderSource.ts`** — `source` → label (`whatsapp_bot` → "Claude Agent") + badge classes.
- **`lib/rate-limit.ts`** — in-memory `Map` limiter. `RATE_LIMITS.orders = {max:5, windowMs:60000}`;
  `checkRateLimit(key, limit)` → `{allowed, retryAfter}`; `getClientIp(req)` from
  `x-forwarded-for`/`x-real-ip` (fallback `127.0.0.1`). **Note:** per-instance memory, not shared —
  best-effort in serverless.

### Live checkout — `POST /api/orders-email` (Tier B)

1. Rate-limit `orders:${ip}` → 429 with `retryAfter` if exceeded.
2. Body `{ items, shipping, referralCode?, customerId?, fulfillmentType?, shippingCourierId? }`.
   `isPickup = fulfillmentType==='pickup'`; `paymentMethod` forced to `'etransfer'`. Validates items +
   `shipping.firstName/lastName/email` (+ `address` unless pickup).
3. Verifies `customerId` against `customers` (don't trust the client) → `verifiedCustomerId|null`.
4. **Affiliate attribution** (`resolveAffiliateAttribution`): bound customer or referral code →
   `discountAmount = round2(subtotal * AFFILIATE_DISCOUNT_RATE)`; `discountedSubtotal`.
5. **Shipping resolved server-side** via `resolveShippingCost(...)` (Easyship; 0 for pickup) →
   `total = discountedSubtotal + shippingCost`.
6. Unique-`order_number` retry loop (5×): insert `orders` (`crypto:'email'`,
   `status:'pending_invoice'`, `fulfillment_type`, `notes:'PICKUP'` for pickup, JSONB `items`,
   `discount_amount`); then insert relational `order_items`.
7. `autoCreateInvoiceFromOrder(db, order.id)` (idempotent, bound by `order_id`; try/caught — invoice
   failure never breaks checkout). [Cluster 6]
8. If attributed: insert `commissions` row + **first-touch bind** (set `customers.affiliate_id` when
   `viaCode` and currently null) — **try/caught, never 500s**. [Cluster 8]
9. **`after()` (post-response):** for non-pickup, `autoCreateShipmentForOrder(...)` [Cluster 6];
   then `sendCustomerInvoiceSMTP` + `sendAdminInvoiceNotificationSMTP` (recipients from
   `site_settings.admin_emails`) [Cluster 2]. All best-effort/logged.
10. Responds immediately `{success, orderNumber, total, message}`.
- **GET `?orderNumber=`** → public order lookup (subset of columns incl. tracking) for the track page.

### Crypto path — `POST /api/orders` (Tier C, **DISABLED → 410**)
- First statement: `return NextResponse.json({error:'Crypto checkout is disabled…'}, {status:410})`.
  Everything below is `no-unreachable`-disabled but intact: rate-limit, validate `crypto ∈
  {btc,eth,sol}`, attribution/discount, server shipping, insert order (`status:'pending'`) + items +
  invoice + commission, then derive an HD-wallet **payment address** (`getNextIndex`/`deriveAddress`),
  `cadToCrypto` amount, `payment_expires_at` (now + 3h), and email `sendOrderConfirmation`. Returns
  `{orderNumber, paymentAddress, paymentAmount, crypto, expiresAt, total}`.
- **GET `?orderNumber=`** → public lookup incl. all `payment_*` fields (for the crypto pay screen).

### Payment confirmation (Tier C, crypto only)
- **`GET /api/orders/check-payment?orderNumber=`** (client poller): returns current status if not
  `pending|received`; expires a `pending` order past `payment_expires_at`; else `checkPayment(...)`
  the chain. **Confirmed** → set `status:'confirmed'` + `payment_*`, **`rpc('adjust_stock_for_order')`**
  (idempotent decrement), `checkLowStockForProducts`, email customer + admin. **Received but not
  enough confirmations** → `status:'received'` + confirmation count. Reports
  `{status, confirmations, requiredConfirmations}`.
- **`GET /api/cron/check-payments`** (Bearer `CRON_SECRET`): sweeps all `pending|received` orders with
  a `payment_address`; expires, confirms (same decrement + low-stock + emails), and **additionally
  creates the Easyship shipment** (`createEasyshipShipment`) on confirmation if none exists; 250ms
  pacing between orders. Returns `{checked, received, confirmed, expired, total}`.

### Customer-facing read (Tier D)
- **`GET /api/orders/my-orders`** — resolves the user from the auth cookie (anon client), then reads
  their `orders` (service-role) by `customer_id`, newest first. 401 if unauthenticated.
- **`app/order/track/page.tsx`** — a thin redirect/track entry (`OrderTrackRedirect`); order data is
  fetched via the public `GET /api/orders[-email]?orderNumber=` lookup.
- (The account order pages `/account/orders[/id]` live in the auth cluster but read the same data.)

### Cart + checkout UI (Tier E)
- **`contexts/CartContext.tsx`** (localStorage key `northern_peptides_cart`): a cart **line** is keyed
  by `product__packSize` (`cartLineKey`), so single-vial and pack-of-10 of the same product are
  separate lines. `packSize ∈ {1,10}` (legacy carts default to 10); `quantity` is total vials, always
  a multiple of `packSize`; `updateQuantity` rounds to the pack step and drops a line below one pack.
  `totalItems` = number of lines (a pack counts as 1 on the badge); `totalPrice` = Σ price×quantity.
  Exposes `addItem(item, packs=1)`, `removeItem(key)`, `updateQuantity`, `clearCart`, `isOpen`.
- **`app/cart/page.tsx`** — cart review (`text-2xl…4xl font-bold text-ink` heading).
- **`app/checkout/page.tsx`** — the checkout form. Contains **both** payment UIs: it POSTs the live
  order to **`/api/orders-email`** and (in the dormant crypto branch) to `/api/orders` + polls
  `/api/orders/check-payment`. Loads `/api/admin/settings` (checkout config) and `/api/shipping/rates`
  for an inline **courier selector** (radio list of `{courierId, courier, cost}`). Since `/api/orders`
  returns 410, the crypto branch is effectively dead at runtime; the email branch is live.

---

## 4. UI/UX design overview

Shared theme: `ink #1A1A1A`, `ink-muted #6E6E6E`, `bronze #9C8B5A`, `surface #F7F7F7`, `line #C9CCD1`;
status accents emerald/amber/red/blue. Icons `lucide-react`.

- **Cart/checkout cards:** `bg-white rounded-xl border border-line`; headings `font-bold text-ink`;
  primary action `bg-ink hover:bg-ink/90 text-white rounded-lg`.
- **Courier selector:** radio rows (`name="courier"`) highlighting the selected `courierId`
  (`border-bronze`/selected vs `border-line`), each showing courier name + cost.
- **Status badges** (admin orders / track): payment status via the order `status` string; shipping
  state via `shippingBadgeClasses` (emerald=shipment created, amber=needs shipment, neutral=pickup);
  source via `sourceBadgeClasses` (emerald for Claude Agent). Payment-method label via
  `paymentMethodLabel`.
- **Confirmation emails** (Cluster 2): `sendCustomerInvoiceSMTP` (branded invoice with items/totals,
  e-Transfer instruction box) + `sendAdminInvoiceNotificationSMTP` (new-order notice with an admin
  CTA). Crypto path uses `sendOrderConfirmation`/`sendPaymentConfirmed`/`sendAdminPaymentNotification`.

---

## 5. Data flow & behavior

### Live e-Transfer order
cart → checkout POST `/api/orders-email` → (rate-limit) → verify customer → attribution/discount →
server shipping → **insert order (`pending_invoice`) + order_items (both stores)** → auto-invoice →
commission/bind (wrapped) → respond → **`after()`**: Easyship draft shipment + invoice emails. **Stock
is NOT decremented here** — it decrements when an admin marks the bound invoice paid (Cluster 6, via
`adjust_stock_for_invoice`).

### Crypto order (dormant)
checkout POST `/api/orders` → **410** today. (When enabled: insert `pending` order, derive HD payment
address + amount + 3h expiry; client polls `check-payment`; cron sweeps. Confirmation →
`adjust_stock_for_order` + Easyship shipment + emails. Statuses `pending → received → confirmed`,
`pending → expired`.)

### Stock decrement (the path split)
| Path | Trigger | RPC | When |
|---|---|---|---|
| Crypto | payment confirmed | `adjust_stock_for_order(p_order_id)` | check-payment / cron |
| e-Transfer | invoice marked paid | `adjust_stock_for_invoice(p_invoice_id)` | admin action (Cluster 6) |
Both idempotent via `stock_adjusted`; both followed by `checkLowStockForProducts`.

### Affiliate attribution (Cluster 8 strip-point)
Both POST routes compute attribution → discount the subtotal, persist `discount_amount` +
`referral_code`, insert a `commissions` row, and first-touch-bind the customer to the affiliate — all
in a try/catch so failures never break checkout. Stripping Cluster 8 removes the attribution import,
the discount math, the `commissions` insert, the bind, and `orders.discount_amount`.

### Idempotency & retries
Order-number uniqueness: 5-try loop on `23505`. Stock adjust: `stock_adjusted` claim. Invoice
creation: idempotent by `order_id`. Email/shipment: best-effort, logged, never block.

---

## 6. Edge cases & states

- **Rate limited:** 429 `Too many orders. Try again in N seconds.`
- **Missing fields:** 400 (items / shipping name+email / address when not pickup / invalid crypto in
  the dormant path).
- **Duplicate order number:** retried up to 5×; exhausted → 500.
- **Invoice/commission/shipment/email failure:** logged, order still succeeds.
- **Crypto checkout:** always 410.
- **Expired crypto order:** `pending` past `payment_expires_at` → `expired` (poller + cron).
- **Pickup:** shipping forced 0, `notes:'PICKUP'`, `fulfillment_type:'pickup'`, address replaced with
  the (placeholder) pickup address; no shipment created.
- **Customer deleted:** order retained, `customer_id` set null (FK migration).
- **my-orders unauthenticated:** 401.
- **Unknown order number (GET):** 404.

---

## 7. Open questions & unverified items

- **`PICKUP_ADDRESS` in `/api/orders-email` is a placeholder** (`123 Main St`, empty city/state/postal
  with `TODO: fill in before going live`). The customer-facing pickup address actually shown comes
  from `site_settings.pickup_address` (config cluster); this route-local constant is stale — confirm
  before relying on it.
- **`/api/orders` 410 + dormant crypto stack:** `lib/crypto-wallets.ts`, `lib/price-feed.ts`,
  `lib/payment-monitor.ts`, the `sol_addresses` pool, `check-payment`, and `cron/check-payments` are
  all intact but unreachable for new orders (no new `pending` crypto orders are created). They were
  **not** deep-read here beyond their call sites — out of scope unless crypto is re-enabled.
- **Cluster-6 seams** (`autoCreateInvoiceFromOrder`, `autoCreateShipmentForOrder`,
  `createEasyshipShipment`, `resolveShippingCost`, `/api/shipping/rates`, and the admin "mark invoice
  paid" → `adjust_stock_for_invoice`) are documented only at the call boundary.
- **Cluster-8 seams** (`resolveAffiliateAttribution`, `AFFILIATE_DISCOUNT_RATE`,
  `AFFILIATE_COMMISSION_RATE`, `round2`) documented at the boundary; rates not transcribed here.
- **`order_number_seq` vs generated `AMC-…`:** the table default uses the sequence, but app code
  always supplies `AMC-…`. The sequence must still exist for the default to be valid, but persisted
  numbers are `AMC-…`.
- **Checkout page** captured at skeleton level (POST targets, courier selector, settings fetch) rather
  than line-by-line; the order/track page is a redirect whose downstream render wasn't fully traced.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (my-orders cookie auth), `CRON_SECRET` (cron), SMTP vars (Cluster 2), Easyship key (Cluster 6),
  plus the dormant crypto/price-feed vars.
