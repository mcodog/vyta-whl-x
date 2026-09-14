# PuraMass Hosted Checkout

A payment processor that hands the storefront cart off to the **PuraMass hosted
checkout** (the Stealth Health partner API). The backend POSTs the cart's SKUs,
receives a `payment_link` on the PuraMass patient-portal domain
(`app.puramass.com`), and redirects the customer there. **PuraMass re-reads
prices from its own catalog, and owns payment, fulfilment, and order emails from
the redirect onward.**

It is added as an **opt-in alternative** to the existing in-house email/invoice
checkout — toggled per-store in the admin Settings page. When it's off, nothing
about the current checkout changes.

A second toggle, **Customer pricing & courier choice**
(`puramass_customer_checkout_enabled`), changes what the hand-off sends: the
customer's own prices and currency, and a courier they pick here. See
*[Signed-in customer checkout](#signed-in-customer-checkout)* below. Everything
in this section describes the hand-off with that toggle **off**.

---

## How it fits together

```
Cart → /checkout ──(puramass_checkout_enabled?)──► PuramassCheckoutContent
                                                        │  collects email (+ name)
                                                        ▼
                                          POST /api/checkout/puramass
                                                        │  map product → puramass_sku
                                                        │  POST /partner/store/orders
                                                        ▼
                                          redirect to order.payment_link
                                                        │
                                                        ▼
                                     app.puramass.com  (pay · ship · email)
```

With **Customer pricing & courier choice** on, the same screen also collects the
recipient address and a courier, and the hand-off names its own amounts:

```
Cart → /checkout ──► PuramassCheckoutContent
                          │  email (+ name, optional phone)
                          │  address (autocomplete) → POST /api/checkout/puramass/rates
                          │                            UPS · FedEx · Canada Post + processing fee
                          ▼
             POST /api/checkout/puramass
                          │  resolve the customer's own prices + currency (server-side)
                          │  re-quote the chosen courier (server-side)
                          │  POST /partner/store/orders  { unit_price_cents, currency,
                          │                                shipping_total_cents }
                          ▼
                          │  raise the invoice: status `pending_payment`
                          ▼
             redirect to order.payment_link  →  customer pays
                          │
                          │  (meanwhile the invoice shows on /account/dashboard
                          │   with a "Complete payment" link back to the gateway)
                          ▼
             webhook: store_order.payment_complete
                          │  create the Easyship shipment (locked to their courier)
                          │  create the order row carrying address + shipment
                          ▼
             invoice flipped `pending_payment` → `paid`, linked to that order,
             and only now does it enter the warehouse queue
```

## Configuration

### 1. Server credentials (env — **server-side only**)

Set these in the deployment environment. **Never** put the key in client code or
commit it.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PURAMASS_API_KEY` | Partner API key (`sk_live_…`). Required. | — |
| `PURAMASS_PARTNER_ID` | Partner id header. | `ptr_puramass` |
| `PURAMASS_API_BASE_URL` | API base URL. | `https://api.stealth.health` |
| `PURAMASS_WEBHOOK_SECRET` | Secret for verifying incoming webhooks (`whsec_…`). Needed for live status. | — |

The hosted checkout only runs when `PURAMASS_API_KEY` is present. The admin
Settings page shows a green/amber banner reflecting whether the server detects
the credentials (`puramass_configured`, computed server-side — the key itself is
never returned to the browser).

### 1b. Config-file kill switch

`puramass.config.ts` (`PURAMASS_CHECKOUT_ENABLED`) is a **hard master switch**.
Set it to `false` to disable the hosted checkout everywhere — the storefront
falls back to the in-house email/invoice checkout, the `/api/checkout/puramass`
hand-off refuses new orders, and the admin toggle reads as off (and is
disabled). It overrides the admin Settings toggle and the API credentials. The
env var `PURAMASS_CHECKOUT_ENABLED=false` forces it off too (takes precedence),
for flipping without a code change. The in-flight payment webhook is **not**
gated by this — orders already handed off can still be marked paid/fulfilled.

### 2. Database migration

Run these in the Supabase SQL editor:

- `puramass-hosted-checkout-migration.sql` — adds `products.puramass_sku`
  (10-pack SKU), `site_settings.puramass_checkout_enabled` (admin toggle, default
  `false`), and the `puramass_orders` hand-off ledger.
- `puramass-webhook-status-migration.sql` — adds `paid_at`, `currency`,
  `last_event_id` to `puramass_orders` (live status; see *Reconciliation*).
- `puramass-vial-sku-migration.sql` — adds `products.puramass_sku_vial`, the
  **single-vial** SKU used when a cart line is one vial rather than a 10-pack.
- `puramass-fulfillment-invoice-migration.sql` — adds `invoices.source` and
  `puramass_orders.invoice_id`, so a paid order becomes a fulfillment invoice in
  the warehouse queue (see *Fulfillment*).
- `puramass-customer-checkout-migration.sql` — adds the **Customer pricing &
  courier choice** toggle, its processing fee, the house recipient phone, and
  the ledger columns holding the destination address, the chosen courier, and
  the Easyship shipment created on payment (see *[Signed-in customer
  checkout](#signed-in-customer-checkout)*).
- `puramass-pending-payment-invoice-migration.sql` — adds the
  `pending_payment` invoice status and `invoices.checkout_payment_link`, so a
  hosted-checkout invoice is raised when the customer is handed off rather than
  when they pay (see *[The invoice lifecycle](#the-invoice-lifecycle)*).
- `customer-storefront-price-conversion-migration.sql` — adds
  `customers.convert_storefront_prices`, the per-customer switch that decides
  whether their configured prices are converted into their billing currency or
  charged as-is in it (see *[Converted vs as-is
  pricing](#converted-vs-as-is-pricing)*).
- `puramass-checkout-pickup-migration.sql` — adds
  `puramass_orders.fulfillment_type`, which tells a pickup hand-off (zero
  shipping, no address, no shipment) apart from one that let PuraMass collect
  the address on its own page. Until it is run, a pickup is still charged no
  shipping; it is simply invoiced as a shipment with no address.

### 3. Enable + map SKUs (admin Settings → "PuraMass Checkout")

1. **Sync SKUs from catalog.** Your product SKUs (e.g. `RT10`) don't match
   PuraMass SKUs, so each product carries **two** PuraMass mappings —
   `puramass_sku` for the 10-pack (`puramass-retatrutide-10mg-10-pack`) and
   `puramass_sku_vial` for the single vial (`puramass-retatrutide-10mg-vial`).
   The **Sync SKUs from catalog** button auto-fills **both** by matching product
   **name + strength** against the PuraMass catalog (the live
   `GET /partner/store/products` when configured — partitioned into 10-pack and
   vial by SKU suffix — otherwise the bundled snapshots). Confident matches are
   written; **ambiguous** and **unmatched** products are listed **per mapping**
   for you to fix by hand. Existing mappings are preserved (pass
   `{ overwrite: true }` to the endpoint to replace them).
2. **Enable** the toggle. The storefront `/checkout` now hands off to PuraMass.

---

## Endpoints

### `POST /api/checkout/puramass` (storefront)

Body: `{ items: [{ id, packSize, quantity }], customer: { email, firstName?, lastName? }, shipping?, fulfillment?, referralCode? }`.

- Gated by **both** the admin toggle and server credentials (503 if not
  configured, 403 if disabled).
- Resolves each cart line's SKU from the DB (**never** trusts a client-sent SKU
  or price), picking the mapping by line type: a **single-vial** line
  (`packSize` 1) uses `puramass_sku_vial`; a **10-pack** line uses `puramass_sku`.
  Any line whose needed mapping is missing → `409` with the offending names in
  `unmapped` (single-vial lines are tagged `(single vial)`).
- Quantities: a vial line sends the **number of vials**; a 10-pack line sends the
  **number of packs** = `total vials / pack size`. Clamped to the API's 1–99 per
  line.
- `fulfillment` is `'shipment'` (the default — anything that isn't the exact
  word `'pickup'` reads as this) or `'pickup'`. A pickup needs no address and no
  courier, sends `shipping_total_cents: 0`, and records no address on the ledger
  — which is what stops a shipment being created when it is paid. It is only
  available with the signed-in customer checkout on, since that is the mode
  where we name the amounts; asking for one with it off is a `409`.
- Creates the PuraMass order, records the hand-off, and returns
  `{ payment_link, transaction_id, status }`.

### `POST /api/checkout/puramass/rates` (storefront)

Courier options for the signed-in customer checkout. Body:
`{ destination: { line1, city, state, postalCode, country }, items: [{ id, packSize, quantity }] }`.

- Gated by `puramass_customer_checkout_enabled` (403 when off).
- Prices the cart server-side for the declared value, then quotes Easyship
  scoped to **UPS, FedEx and Canada Post**, in the customer's own currency, with
  the configured processing fee already added to each option.
- Returns `{ rates: [{ courierId, courier, cost, currency, minDays, maxDays }],
  currency, unavailable }`. `unavailable: true` means no courier could be quoted
  for that address — the checkout says so rather than showing a made-up figure.

### `GET /api/account/invoices` (customer)

The signed-in customer's own invoices, for their account dashboard. Service-role
read scoped to the caller's id from their bearer token. Returns
`{ invoices: [{ id, invoice_number, status, total, currency, order_number,
tracking_number, tracking_url, carrier, payment_link, … }] }`.

`payment_link` is non-null **only** while the invoice is `pending_payment`, so a
settled invoice can never offer a second payment.

### `POST /api/admin/puramass/sync-skus` (admin only)

Body: `{ overwrite?: boolean, dryRun?: boolean }`. Returns a report:
`{ source, counts, updated, skipped_already_set, ambiguous, unmatched }`.

---

## Reconciliation

Each hand-off is a ledger row in `puramass_orders`, browsable in the admin panel
at **Admin → Orders & Fulfillment → PuraMass Orders** (`/admin/puramass-orders`,
admin/assistant only; read via `GET /api/admin/puramass/orders`). Each row
records:

- `partner_reference` — our internal reference, sent as `partner_reference` and
  echoed back (unique, so a retry with the same reference is safe).
- `transaction_id`, `payment_link`, `status`, `subtotal_cents`, `currency`,
  `paid_at` — from PuraMass.
- `customer_email`, `customer_id` (best-effort from a signed-in session),
  `items` (the SKUs/quantities sent), `referral_code` (captured for manual
  reconciliation — commissions are **not** auto-created for external orders).

### Live status (webhook + polling)

Status is kept current two ways:

1. **Webhook (automatic).** PuraMass POSTs `store_order.payment_complete` to
   **`<base>/api/webhooks/stealth-health`** when a customer pays. The receiver verifies
   the `X-Stealth-Signature` HMAC-SHA256 (over the raw body, keyed by
   `PURAMASS_WEBHOOK_SECRET`), then updates the matching row's `status`/`paid_at`
   by `transaction_id` (or `partner_reference`). Deliveries are at-least-once and
   deduped on `event_id`; the endpoint ACKs 2xx within the 10s window.
   **Setup:** set `PURAMASS_WEBHOOK_SECRET` server-side and give PuraMass the
   endpoint URL to register. Every delivery (incl. invalid-signature / unmatched)
   is logged to `puramass_webhook_events` (migration
   `puramass-webhook-events-migration.sql`) — query it to confirm Stealth Health
   is actually hitting the URL and to debug why an event wasn't applied.
2. **Polling (manual fallback).** The **Refresh** button on each ledger row calls
   `POST /api/admin/puramass/orders/refresh` → `GET
   /partner/store/orders/{transaction_id}` and updates the row. Use it to backfill
   any events that fired before the webhook URL was registered.

Status values: `payment_pending` → `paid` (sets `paid_at`) → or `expired`
(7-day link lapsed) / `cancelled`. Live fulfilment beyond payment still lives in
the PuraMass portal.

## Fulfillment queue

When the webhook confirms payment (`paid`), it creates a **fulfillment invoice**
so the items show up in the warehouse queue (**Warehouse → fulfillment queue**):

- The invoice is stamped `source = 'stealth_health'`, `status = 'paid'`,
  `fulfillment_status = 'pending'`, currency USD. Line items are built from the
  paid webhook items and mapped back to storefront products by SKU (best effort).
- It's **idempotent** — one invoice per order, linked via
  `puramass_orders.invoice_id` (safe on webhook retries).
- The queue row and detail panel show a **"Stealth Health"** badge. Fields a
  normal invoice would carry but a hosted-checkout order doesn't — customer
  name/phone and shipping address — render with a tooltip explaining they're
  collected and managed by Stealth Health.

Because Stealth Health collects the shipping address on its own checkout page,
these queue cards won't have one; use the PuraMass portal for the customer's
shipping details when fulfilling.

---

## Second use: paying an existing invoice by card

The hosted checkout has a second entry point that does **not** start from the
cart. From **Admin → Invoices → the invoice → Request Payment**, an admin either has
us **email** the customer a payment request or **copies the link** and sends it
themselves (`POST …/payment-email` and `POST …/payment-link` — the token is
minted by whichever runs first, so both hand out the same URL). Either way the
customer lands on a page on our own site — `/pay/<token>` — where they choose
how to pay:

```
Admin sends payment request  →  invoice gets a payment_token
                                        │
                                        ▼
                            /pay/<token>   (order summary + 2 options)
                                 │                       │
                      crypto ────┘                       └──── card
                        │                                        │
           /pay/<token>/crypto                    POST /api/pay/<token>/checkout
       wallet + QR + tx-hash hand-back              creates a PuraMass order with
       (admin verifies, records payment)            origin='invoice', redirects to
                                                    the returned payment_link
```

The card path reuses everything above — same partner API, same webhook, same
ledger — with one difference recorded on the row:

- `puramass_orders.origin` is **`'invoice'`** (rather than `'storefront'`), and
  `invoice_id` points at the invoice being paid.
- On `paid`, the webhook therefore **records a payment against that invoice**
  (rolling `sent`/`partial` → `paid` and decrementing stock, exactly as a
  manually recorded payment does) instead of creating a new fulfillment invoice.
  Recording is idempotent on the transaction reference and clamped to the
  balance due.
- Line items are mapped to catalog SKUs by the same rules as the cart (`-vial`
  for a per-vial line, `-10-pack` / `-case` otherwise). An invoice with any
  unmappable line simply doesn't offer the card option.

**The invoice's own prices are what get charged.** Unlike the cart hand-off,
this path names the amounts on the order: each line carries the invoice's
`unit_price_cents` (its `line_total` ÷ quantity, so a per-line discount is
included) and the order carries `shipping_total_cents` taken from the invoice's
shipping — `0` where the invoice ships free, which is what switches off
PuraMass's default $35.00 rate. Those are per-order values; nothing is saved as
a new default for the SKU. No shipping address is sent — PuraMass still collects
it on its own page.

Two limits remain, and both surface as a *partially paid* invoice for an admin
to reconcile rather than being silently treated as settled:

- **A line may not go below wholesale.** `unit_price_cents` cannot be under the
  wholesale price PuraMass invoices us for that SKU; it rejects the order with
  `400 STORE_PRICE_BELOW_WHOLESALE`. The card option then fails with a generic
  message (the floor is our cost, so it stays out of the customer's view) and
  the SKU + floor are written to the invoice's payment timeline for an admin.
- **Tax and the processing fee aren't expressible** on a partner order, so an
  invoice carrying either is charged its lines + shipping only.

Because the amounts are baked into the link, a pending link is reused only while
it still matches the invoice. Edit an item, a quantity, a price, or the shipping
and the next visit mints a fresh hand-off instead of charging the old total.

The crypto option on that page is entirely in-house: wallets are configured in
**Admin → Settings → Crypto Payments**, and the customer's submitted transaction
hash is stored for an admin to verify — it never marks the invoice paid by
itself. See `invoice-payment-request-migration.sql` for the schema, and the
`2026-08-25` changelog entry for the full feature.

---

## Signed-in customer checkout

*Admin → Settings → PuraMass Checkout → **Customer pricing & courier choice***
(`site_settings.puramass_customer_checkout_enabled`, default **off**).

The plain hand-off above throws a customer's own pricing away at the redirect —
PuraMass re-reads its USD catalog, so a customer on a price list is charged
something other than what the storefront quoted them. This toggle closes that
gap, and adds the two things that follow from charging our own prices: the
customer picks their courier here, and the resulting shipment is ours to create.

With it on:

1. **The customer is charged the prices they saw.** Every line is re-resolved
   server-side from the database (`lib/payments/puramass-pricing.ts`): their
   `customer_price_overrides` row wins over the catalog price, a pack line is
   priced per case and a single-vial line per vial, and the amount is expressed
   in their own `customers.price_currency` at the store's `usd_exchange_rate`.
   The arithmetic deliberately mirrors the add-to-cart screen, so the hosted page
   quotes the same number the product tile did. **No price is ever taken from
   the browser** — the cart is client state.

2. **They choose a courier before paying.** The checkout collects the recipient
   address (autocomplete, `/api/shipping/address-autocomplete`) and calls
   `/api/checkout/puramass/rates` for live Easyship options, scoped to **UPS,
   FedEx and Canada Post**. Email is required; **phone is optional** — left
   blank, the house number from Settings is given to the courier.

3. **A processing fee rides on top of each courier rate.** Configured in the
   same Settings panel, flat (CAD) or a percentage of the rate. It is folded into
   the figure the customer sees, so they read one shipping number rather than an
   itemised fee. The general Easyship handling fee
   (`shipping_handling_fee_*`) is **not** applied at this checkout, so the two
   can never stack into a charge nobody configured.

4. **The chosen rate is re-quoted at hand-off.** `/api/checkout/puramass`
   re-asks Easyship for that `courierId` and charges what it says. If the rate
   has lapsed, the cheapest remaining option is charged and recorded; if no
   courier can be quoted at all, the hand-off is **refused** rather than sending
   `shipping_total_cents: 0`, which the partner API reads as free shipping.

5. **The order names its own amounts.** The payload carries each line's
   `unit_price_cents`, the order's `currency`, and `shipping_total_cents` — see
   `docs/PURAMASS_CHECKOUT_API.md` for the full contract.

6. **Or they collect it, and pay nothing for shipping.** Picking *Pick it up*
   drops the courier step and the address with it: the hand-off sends
   `shipping_total_cents: 0` (which is also what switches off PuraMass's own
   default rate), the ledger row is marked `fulfillment_type: 'pickup'` and
   carries no address, and the invoice it raises is a **pickup** invoice — so
   the warehouse queue holds it at the counter instead of packing it for a
   courier. Nothing is shipped, so no Easyship shipment is created on payment.

7. **They can pay by card, e-Transfer or Bitcoin.** The card is this hosted
   checkout. The other two never touch PuraMass at all: the cart goes to the
   in-house order API (`/api/orders-email`) with that `paymentMethod`, which
   re-prices it, quotes shipping (pickup is free), raises the order and its
   invoice, and emails the payment instructions for the method chosen — the same
   flow the in-house checkout runs. The options come from
   `CHECKOUT_PAYMENT_METHODS` in `lib/paymentMethod.ts`, which the order API
   re-resolves against, so turning one off removes it from the screen and
   rejects it server-side in one move. Bitcoin instructions carry the receiving
   address configured in *Settings → Crypto Payments*; no BTC amount is quoted,
   since the rate moves between the order and the payment.

8. **On payment, the shipment is created and attached to the invoice.** The
   webhook creates the Easyship shipment (locked to the courier the customer paid
   for, `buy_label: false`), then an `orders` row carrying the address and the
   shipment, and links the fulfillment invoice to it. That link is what makes the
   shipment visible on the invoice, in the warehouse queue, and in the
   label/tracking tooling — all of which read an invoice's linked order. The
   invoice also carries the real currency, the shipping the customer paid, and
   the recipient's name and phone, so it is no longer the stub described under
   *Fulfillment queue* above.

### Converted vs as-is pricing

`customers.price_currency` says which currency a customer is billed in.
`customers.convert_storefront_prices` says what that does to the numbers, and it
is **off by default**:

| Switch | A list configured at **156** | What the hand-off sends |
| --- | --- | --- |
| **Off (default)** | Shown and charged as **$156.00 USD** | `unit_price_cents: 15600`, `currency: "usd"` |
| On | Converted at `usd_exchange_rate` → **$113.00 USD** | `unit_price_cents: 11300`, `currency: "usd"` |

Off is the default because a price list negotiated in the customer's own
currency is *already* denominated in it — converting it a second time quietly
discounts every line by the exchange rate. Turn it on only for a customer whose
list really is in CAD and should be converted.

With the switch off, a product's catalog `price_usd` is ignored too: that column
holds a converted figure, so honouring it would reintroduce the very conversion
the switch exists to prevent.

**Scope: the storefront only.** Product pages, the cart, both checkouts, the
storefront order email, and the amounts sent to PuraMass. **Admin-created
invoices are not affected** — the admin invoice form keeps its own currency
handling, so nothing about back-office invoicing changes.

**Shipping always converts at the real rate**, whichever way the switch is set: a
courier rate is a genuine CAD cost we pay, so billing it as-is in USD would
under-recover it. Only *configured prices* are exempt. The same reasoning
applies to the declared value sent to Easyship for customs and insurance — an
unconverted amount is already the CAD figure and must not be divided by the rate
again.

Both the storefront and the server read the switch from one place each —
`CurrencyContext` folds it into the `rate` it exposes (1 when not converting),
and `lib/payments/puramass-pricing.ts` does the same server-side — so a surface
that multiplies by `rate` needs no branching of its own.

### The invoice lifecycle

The invoice is raised when the customer clicks **Continue to secure checkout**,
not when they pay:

| Moment | Invoice |
| --- | --- |
| Hand-off (`POST /api/checkout/puramass`) | Created, `status = 'pending_payment'`, carrying the line prices, currency, shipping and the `checkout_payment_link`. |
| Customer pays → webhook | Flipped to `paid` and linked to the order row holding the address and Easyship shipment. |
| Customer never pays | Stays `pending_payment` indefinitely — visible to them, resumable, and invisible to the warehouse and to receivables. |

Raising it early is what gives the customer something to see on their account
dashboard, with a link back to the gateway to finish paying, and means a paid
order whose webhook never lands still leaves a record behind instead of
vanishing.

`pending_payment` is deliberately a **new status**, not `draft` or `sent`:

- `sent` is swept to `overdue` by `mark_overdue_invoices()`, which would turn
  every abandoned cart into an overdue receivable.
- `draft` is visible to the warehouse as preppable work.
- Either would have counted toward **outstanding** on the invoices page, so an
  abandoned cart would have read as money owed.

So `pending_payment` is excluded from three places, and anything new that treats
"not draft" as "real invoice" needs the same care:

| Surface | Behaviour |
| --- | --- |
| Warehouse fulfillment queue | Filtered out of the query entirely — packing an unpaid order would ship goods against money that never arrived. It enters the queue when the webhook marks it paid. |
| Outstanding receivables (admin + affiliate invoice lists) | Not counted. An unpaid checkout is not a debt. |
| Analytics revenue | Already excluded — that query whitelists `sent/partial/paid/overdue`. |
| Overdue sweep | Never swept; `effectiveStatus` only moves `sent`/`partial`. |

Marking it paid is idempotent (webhook delivery is at-least-once) and refuses to
overwrite an invoice a human has moved to another state since the hand-off.

**With the customer checkout off**, the invoice is still raised on payment as it
always was: PuraMass prices the order from its own catalog, so until its webhook
reports the amounts there is nothing truthful to put on an invoice.

### The customer's view

`/account/dashboard` lists the customer's invoices above their orders, newest
first, via `GET /api/account/invoices`. Invoices carry no customer-facing RLS
policy, so that route runs on the service key and scopes every read to the
caller's own id taken from their bearer token — never from a query parameter.

A `pending_payment` invoice renders a **Complete payment** button back to the
hosted link. The link is only returned for an invoice that still needs paying;
a settled one hands back `null`, so a stale link can't invite a second payment.
Once shipped, the row also shows the courier and tracking number. The card is
hidden entirely for customers with no invoices, so nothing changes for anyone
who has only ordered the in-house way.

### Why the shipment is created on payment, not at checkout

A shipment created when the courier is picked would leave a draft in Easyship for
every abandoned checkout. The address and courier are held on the ledger row
instead, and the shipment is created once payment is confirmed. Creation is
best-effort and idempotent: a failure is recorded in
`puramass_orders.shipment_error` and never fails the webhook ACK (PuraMass would
retry the payment event forever), and a redelivered event re-uses the shipment
and order it already made. An admin can create the label by hand from the
invoice if it failed.

### Settings

| Setting | What it does |
| --- | --- |
| **Customer pricing & courier choice** | The master toggle for everything above. Only has an effect while the hosted checkout itself is on. |
| **Shipping processing fee** | Flat CAD amount or percentage of the rate, added to every courier option shown. 0 = no fee. |
| **House phone for shipments** | Recipient phone given to the courier when the customer leaves theirs blank. Blank = the built-in default. |
| **Sender address + contact** | Under *Shipping (Easyship)* — the company, contact name, **email** and **phone** on every shipment's origin. Shared with the rest of the shipping tooling. |

---

## Deliberate trade-offs (hand-off model)

Because PuraMass owns price and fulfilment for these orders, the store's own
machinery is **bypassed** for anything checked out via PuraMass:

- Per-customer pricing, pricelists, affiliate discounts, and free-shipping
  thresholds do **not** apply — *unless* **Customer pricing & courier choice** is
  on, which is exactly what that toggle restores for pricing, currency and
  shipping. (Affiliate discounts and free-shipping thresholds are still not
  applied either way.)
- The in-house warehouse/stock/fulfilment and invoice emails are **not** used.
  With the customer checkout on, a paid order does reach the warehouse queue with
  a real address and shipment — but stock is not decremented and the in-house
  order emails still don't fire.
- Affiliate commissions are not created automatically (no confirmed-payment
  signal); the referral code is recorded for manual follow-up.

Keep the toggle **off** if you need any of the above to apply to an order.
