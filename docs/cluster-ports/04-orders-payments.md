# Cluster 4 — Storefront Orders & Payments: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 4 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **fifth** (after 1, 10, 2, 3). The core shopping flow is
> assumed to already exist on sibling sites — this documents it fully anyway since the catalog
> sites share it.
>
> **Companion deep specs:** `ORDER_INTEGRATION.md`, `CHECKOUT_CONFIGURATION.md`,
> `docs/superpowers/plans/2026-03-12-crypto-payment-system.md`. (The `docs/module-ports/` set
> deliberately skips the shopping flow.)

---

## 1. What the cluster is / does

Everything from cart → order → payment. Two creation paths:
- **Live e-Transfer/email checkout** (`/api/orders-email`) — the **only active path**. Creates an
  order with `status:'pending_invoice'`, emails the customer an invoice + admin a copy, fires
  best-effort auto-shipment, and (optionally) records an affiliate commission + discount.
- **Crypto checkout** (`/api/orders`) — **disabled** (POST returns `410`). The HD-wallet address
  derivation, SOL address pool, and blockchain payment-monitor infrastructure remain in code.

Plus: order success/tracking pages, customer "my orders", and the crypto **payment-confirmation**
polling (`/api/orders/check-payment` + cron) that decrements stock on confirm.

**Why it ports here:** it depends on products (2), pricing (3), customers (1), settings/email (10),
and feeds invoices (5) and fulfillment (6).

---

## 2. Database schema — what exists and where it comes from

### `orders` — base in `migration-orders-clean.sql` / `migration-orders.sql`
`id`, `customer_id → customers`, `order_number TEXT UNIQUE`, **`items JSONB`** (snapshot),
`total NUMERIC`, `email`, `shipping_address JSONB`, `crypto TEXT`, `status TEXT DEFAULT 'pending'`,
crypto payment fields (`payment_address`, `payment_amount_expected/received`, `payment_tx_hash`,
`payment_derivation_index`, `payment_confirmed_at`, `payment_expires_at`), `referral_code`,
`tracking_number`, `notes`, timestamps. Indexes on (status, payment_address) partial, customer, order_number.

**ALTERs that pile on (know the source):**
| Migration | Adds to `orders` |
|-----------|------------------|
| `migration-confirmations.sql` | `payment_confirmations integer` |
| `orders-customer-fk-set-null-migration.sql` | **changes `customer_id` FK to `ON DELETE SET NULL`** (keep order history when a customer is deleted) |
| `stock-decrement-migration.sql` | `stock_adjusted boolean` (idempotency claim) |
| checkout-config / fulfillment | `fulfillment_type text` (`'shipment'|'pickup'`) |
| affiliate-discount | `discount_amount numeric` (Cluster 8) |
| `easyship-settings-migration.sql` | `easyship_shipment_id`, `tracking_status`, `tracking_url`, `carrier` (Cluster 6) |
| `easyship-labels-migration.sql` | `label_state` (`not_created|pending|generated|failed`), `label_url` (Cluster 6) |
| `easyship-auto-shipment-migration.sql` | `auto_shipment_status/stage/error/attempted_at` (Cluster 6) |

> **Intricacy — two parallel item stores:** an order's items live **both** in `orders.items`
> (JSONB snapshot, written at creation) **and** as relational `order_items` rows. Keep both in sync.

### `order_items` (same base migration)
`id`, `order_id → orders ON DELETE CASCADE`, `product_name`, **`product_id TEXT`** (UUID-as-string —
the stock RPC regex-guards + casts it; see Cluster 2), `quantity`, `price_at_time`, `strength`,
`created_at`.

### `sol_addresses` (crypto pool — disabled path)
`id serial`, `address UNIQUE`, `derivation_index`, `used boolean`, `order_id → orders`. Pre-generated
Solana address pool (BTC/ETH derive on the fly via xpub). Only read by `lib/crypto-wallets.ts`.

### RLS
`orders`, `order_items`, `sol_addresses` → **service-role full access only**; customers read their
own orders via the service-role API routes (`/api/orders/my-orders` uses the user's session +
`customer_id` filter).

---

## 3. The reading map (open files in this order)

### Tier A — Types, totals, status helpers
- `lib/supabase.ts` → `Order`, `OrderItem`, `CryptoChain` types.
- `lib/orderTotals.ts` → `deriveOrderTotals(...)` (subtotal/discount/shipping/total math).
- `lib/shippingStatus.ts` → `isPickupOrder`, `shippingState` (`'pickup'|'created'|'none'`), label
  helpers. `lib/orderSource.ts` → `sourceLabel`/`sourceBadgeClasses`. `lib/paymentMethod.ts` →
  `paymentMethodLabel` (crypto → display).
- `lib/rate-limit.ts` → `checkRateLimit`, `getClientIp`, `RATE_LIMITS` (per-IP order throttle).

### Tier B — The live checkout (read first; this is the real path)

**`app/api/orders-email/route.ts`** (`POST` create, `GET` by order number) — *the e-Transfer flow.*
- **Rate limited** per IP (429). Body: `{items, shipping, referralCode, customerId,
  fulfillmentType, shippingCourierId}`.
- **Pricing math:** `subtotal` → affiliate `resolveAffiliateAttribution` (Cluster 8) → optional
  10% `discountAmount` → `discountedSubtotal` → `+ shippingCost` (handling fee already folded by
  the rates endpoint) → `total`.
- **Insert `orders`** with `status:'pending_invoice'`, `discount_amount`, `referral_code`,
  `fulfillment_type` (`'pickup'|'shipment'`), then **insert `order_items`** rows.
- **Affiliate commission seam (Cluster 8, error-wrapped):** insert `commissions`
  (`amount = discountedSubtotal × COMMISSION_RATE`, `status:'pending'`) + **first-touch bind**
  (`customers.affiliate_id = …` when attribution came from a referral code).
- **Emails:** `sendCustomerInvoiceSMTP` (customer) + `sendAdminInvoiceNotificationSMTP` (recipients
  from `site_settings.admin_emails`) — both `lib/email-smtp` (Cluster 10).
- **Auto-shipment:** `autoCreateShipmentForOrder(order)` best-effort (Cluster 6).

### Tier C — The crypto path (disabled, but infra present)

**`app/api/orders/route.ts`** — POST **returns `410`** up front ("Crypto checkout is disabled").
Below the early-return: validates `crypto` chain, inserts order, the same commission seam, then
**derives a payment address** (`deriveAddress` via `lib/crypto-wallets.ts`, `getNextIndex`) and
`cadToCrypto` amount, updates the order with `payment_address`/`payment_amount_expected`/
`payment_expires_at`. GET returns crypto payment status fields.

**`app/api/orders/check-payment/route.ts`** + **`app/api/cron/check-payments/route.ts`** —
*crypto confirmation polling.* `checkPayment(...)` (`lib/payment-monitor.ts`, `REQUIRED_CONFIRMATIONS`):
- `pending` past `payment_expires_at` → `status:'expired'`.
- Enough confirmations → `status:'confirmed'`, set `payment_tx_hash`/`payment_confirmed_at`, **call
  `adjust_stock_for_order` RPC** (Cluster 2 decrement), email `sendPaymentConfirmed` +
  `sendAdminPaymentNotification`.
- Detected but under threshold → `status:'received'`. Cron is `CRON_SECRET`-guarded.
> **e-Transfer orders have no auto-confirmation** — an admin marks them paid (Cluster 5 invoice
> payment), which is where their stock decrement happens (`adjust_stock_for_invoice`).

### Tier D — Customer-facing read

- **`app/api/orders/my-orders/route.ts`** — uses the user's session (`auth.getUser`) + `customer_id`
  filter to list their orders.
- **`app/api/orders/[id]/invoice/route.ts`** — renders the HTML invoice for an order (Cluster 1
  order-detail page links here; enforces ownership).
- **Pages:** `app/order/success/page.tsx` (confirmation + e-Transfer QR + status timeline),
  `app/order/track/page.tsx` (redirects to dashboard), `app/(customer)/account/orders/*` (Cluster 1).

### Tier E — Cart & checkout UI (client)

- **`contexts/CartContext.tsx`** — localStorage cart (`northern_peptides_cart`); line uniqueness =
  product + pack size; **no DB**. (Already summarized in the user-class inventory.)
- **`app/cart/page.tsx`**, **`app/checkout/page.tsx`** (+ `checkout-email`) — the 2-step checkout:
  shipping (address autocomplete + fulfillment type) → payment (referral code, live rates, summary,
  e-Transfer). Calls `/api/shipping/rates` (Cluster 6) and `/api/orders-email`.
- **`contexts/Web3Provider.tsx`**, `lib/wagmi.ts` — wallet infra for the disabled crypto path.

---

## 4. End-to-end flows to trace

1. **Live order:** checkout → `/api/orders-email` → rate-limit → totals (subtotal − affiliate
   discount + shipping) → insert `orders` (`pending_invoice`) + `order_items` → commission + email +
   `autoCreateShipmentForOrder`. Customer lands on `/order/success`.
2. **e-Transfer payment:** customer sends funds → **admin marks the invoice paid** (Cluster 5) →
   `adjust_stock_for_invoice` decrements stock. (No automatic detection.)
3. **Crypto (disabled):** POST 410. If re-enabled: insert order → derive address → poll
   `check-payment`/cron → `confirmed` → `adjust_stock_for_order` + emails.
4. **Customer views orders:** `/account/orders` → `/api/orders/my-orders` (session-scoped) →
   detail → `/api/orders/[id]/invoice`.

---

## 5. Extraction checklist & gotchas

- [ ] **Two item stores:** write both `orders.items` (JSONB) and `order_items` rows; readers use one
      or the other depending on context.
- [ ] `orders.customer_id` is **`ON DELETE SET NULL`** (run the FK migration) so deleting a customer
      keeps order history — mirrors `invoices.customer_id`.
- [ ] `order_items.product_id` is **TEXT** (UUID-as-string); the stock RPC regex-guards/casts it.
- [ ] **Live status is `'pending_invoice'`**; crypto statuses are `pending → received → confirmed`
      (+`expired`). Tracking-driven `shipped/delivered` come from the EasyShip webhook (Cluster 6).
      Reconcile against the customer dashboard badge set if you change them.
- [ ] **Stock decrement differs by path:** crypto → `adjust_stock_for_order` (on confirm);
      e-Transfer → `adjust_stock_for_invoice` (admin marks invoice paid). Both idempotent via
      `stock_adjusted`.
- [ ] Order creation is **rate-limited per IP** — keep `lib/rate-limit.ts`.
- [ ] Commission insert + first-touch affiliate bind are **error-wrapped** so they never 500 the
      order — and are **Cluster 8** (strip with the affiliate program, along with `discount_amount`).
- [ ] `/api/orders` POST returns **410** — leave the crypto infra (wallets, sol_addresses,
      payment-monitor, Web3Provider) only if the target may re-enable crypto; otherwise strip.
- [ ] `autoCreateShipmentForOrder` and the rate/label endpoints are **Cluster 6** — port the call
      seam now, the implementation with fulfillment.

---

## 6. File index (everything in Cluster 4)

```
DB        migration-orders-clean.sql / migration-orders.sql (orders, order_items, sol_addresses),
          migration-confirmations.sql, orders-customer-fk-set-null-migration.sql,
          stock-decrement-migration.sql (adjust_stock_for_order + orders.stock_adjusted)
          [orders also ALTERed by easyship-*/affiliate-discount/fulfillment migrations — those
           columns belong to Clusters 6/8]
libs      lib/orderTotals.ts, lib/shippingStatus.ts, lib/orderSource.ts, lib/paymentMethod.ts,
          lib/rate-limit.ts, lib/crypto-wallets.ts, lib/payment-monitor.ts, lib/price-feed.ts,
          lib/wagmi.ts  (+ Order/OrderItem types in lib/supabase.ts)
API       app/api/orders-email/route.ts  (LIVE),
          app/api/orders/route.ts (crypto, 410), app/api/orders/check-payment/route.ts,
          app/api/cron/check-payments/route.ts, app/api/orders/my-orders/route.ts,
          app/api/orders/[id]/invoice/route.ts
storefront app/cart/page.tsx, app/checkout/page.tsx, app/checkout-email/page.tsx,
          app/order/success/page.tsx, app/order/track/page.tsx,
          contexts/CartContext.tsx, contexts/Web3Provider.tsx
docs      ORDER_INTEGRATION.md, CHECKOUT_CONFIGURATION.md,
          docs/superpowers/plans/2026-03-12-crypto-payment-system.md
```

**Email senders used:** `sendCustomerInvoiceSMTP`, `sendAdminInvoiceNotificationSMTP`,
`sendPaymentConfirmed`, `sendAdminPaymentNotification` (Cluster 10).
**Env:** `CRON_SECRET` (cron), `BTC_XPUB`/`ETH_XPUB`/`ALCHEMY_*` (crypto, disabled),
`NEXT_PUBLIC_BASE_URL`. **Seams:** Cluster 6 (`autoCreateShipmentForOrder`, `/api/shipping/rates`),
Cluster 8 (commission/discount), Cluster 2 (stock RPCs).
```
