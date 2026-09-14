# Sending pricing to the PuraMass payment-link endpoint

How to ask the Stealth Health partner API for a hosted-checkout payment link
(`app.puramass.com`) **and name the amounts yourself**, so the customer is
charged your prices rather than PuraMass's catalog prices.

This is the contract behind `lib/payments/puramass.ts` — read it when you're
adding a new caller (a new checkout, an invoice flow, a script), or when you
need to know exactly what a hand-off sends.

---

## The endpoint

```
POST https://api.stealth.health/partner/store/orders
X-Partner-ID: ptr_puramass
X-Api-Key: sk_live_…
Content-Type: application/json
```

Both headers are required. The API key is **server-side only** — it is read from
`PURAMASS_API_KEY` and must never reach the browser.

The response carries a `payment_link` on the PuraMass patient-portal domain;
redirect the customer there to pay.

---

## The payload

The complete body for a priced hand-off:

```json
{
  "items": [
    { "sku": "puramass-5-amino-1mq-10mg-vial", "quantity": 1, "unit_price_cents": 15600 }
  ],
  "currency": "cad",
  "customer": { "email": "test@aminocan.com" },
  "shipping_total_cents": 0,
  "payment": { "mode": "customer" },
  "partner_reference": "amc_5f2c…"
}
```

| Field | Required | What it does |
| --- | --- | --- |
| `items[].sku` | yes | A PuraMass SKU — `puramass-…-case` for a pack, `puramass-…-vial` for a single vial. |
| `items[].quantity` | yes | Units of that SKU: **packs** for a case SKU, **vials** for a vial SKU. 1–99 per line. |
| `items[].unit_price_cents` | no | What **one unit of that SKU** costs, in whole cents. Omit it and PuraMass charges its own catalog price. |
| `currency` | no | The currency every amount on the order is in: `"cad"` or `"usd"`. Omit and the API uses its account default (USD). |
| `customer.email` | yes | Where the order confirmation goes. `first_name`, `last_name`, `phone` are optional. |
| `shipping_total_cents` | no | Shipping for the whole order, in whole cents. Omit and PuraMass applies its own default rate ($35.00); send `0` for free shipping. |
| `payment.mode` | yes | `"customer"` — the customer pays on the hosted page. |
| `partner_reference` | yes | Your own reference (≤120 chars), echoed back. Make it unique so a retry maps to the same hand-off. |

No shipping address is sent. PuraMass collects it on its own page — unless you
collect it yourself (as the signed-in customer checkout does), in which case it
is used for the Easyship shipment on your side and still isn't sent here.

### The three amount rules

1. **Cents, always whole numbers.** `15600` is $156.00. A fractional, negative,
   or absurd value (> `10_000_000`, i.e. $100,000.00) is rejected with
   `STORE_PRICE_OVERRIDE_INVALID`.

2. **`0` is a real value, not "unset".** `shipping_total_cents: 0` is how you
   switch off PuraMass's default $35.00 rate. Build the payload by testing for
   `undefined`, never for falsiness — a truthiness check silently drops a zero
   and the customer gets billed $35.00 you never meant to charge.

3. **A line may not go below wholesale.** `unit_price_cents` cannot be under the
   wholesale price PuraMass invoices you for that SKU — that is owed regardless
   of what you charge your own customer. Below it, the whole order is rejected
   with `400 STORE_PRICE_BELOW_WHOLESALE` and a message naming the SKU and its
   floor. **That floor is your cost: keep it out of customer-facing messages.**

Prices apply to **that order only**. Nothing is saved as a new default, so the
same SKU can be a different price on the next hand-off.

### Naming amounts is all-or-nothing per order

Send `currency` whenever you send any amount. Without it, a CAD customer's
`unit_price_cents: 15600` is charged as **USD 156.00** — the customer pays more
than the storefront quoted and nothing in the response looks wrong.

Equally, a line you leave without `unit_price_cents` is priced from PuraMass's
catalog, in PuraMass's currency. Don't mix priced and unpriced lines on one
order.

---

## Calling it from this codebase

Use `createPuramassOrder` — never `fetch` the partner API by hand. It attaches
the credentials, validates every amount before sending, and turns a price
rejection into something you can branch on.

```ts
import {
  createPuramassOrder,
  isPuramassPriceRejection,
  PuramassApiError,
} from '@/lib/payments/puramass';

const order = await createPuramassOrder({
  items: [
    { sku: 'puramass-5-amino-1mq-10mg-vial', quantity: 1, unit_price_cents: 15600 },
  ],
  currency: 'cad',
  customer: { email: 'test@aminocan.com' },
  shippingTotalCents: 0,
  partnerReference: `amc_${randomUUID()}`,
});

// → order.payment_link, order.transaction_id, order.status, order.total_cents
```

Note the camelCase on the input (`shippingTotalCents`, `partnerReference`); the
client maps them to the snake_case wire format above.

### Handling a rejection

```ts
try {
  order = await createPuramassOrder(input);
} catch (err) {
  if (isPuramassPriceRejection(err)) {
    // A price we named was refused (below wholesale, or malformed).
    // Log the detail for an admin; show the customer something generic —
    // the wholesale floor is our cost.
    console.error('PuraMass rejected pricing:', (err as PuramassApiError).message);
    return json({ error: 'Checkout could not be completed for one of these items.' }, 409);
  }
  if (err instanceof PuramassApiError) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return json({ error: err.message }, status);
  }
  throw err;
}
```

An amount that **cannot** be sent throws rather than being dropped. That is
deliberate: dropping it would hand the customer PuraMass's catalog price instead
of the one you meant to charge, and the order would look like it succeeded.

---

## Where the amounts come from

Two callers in this codebase name their own amounts. Both resolve them
**server-side from the database** and never trust a number sent by the browser.

### 1. The storefront checkout (`POST /api/checkout/puramass`)

Gated by `site_settings.puramass_customer_checkout_enabled`. With it on, the
route resolves each cart line through `lib/payments/puramass-pricing.ts`:

- the customer's `customer_price_overrides` row wins over the catalog price;
- a pack line is priced per **case**, a single-vial line per **vial**;
- the amount is expressed in the customer's own `customers.price_currency`.
  Whether it is **converted** to get there depends on
  `customers.convert_storefront_prices` (default **off**): off, the configured
  figure is sent as-is and merely denominated in that currency, so a list at 156
  sends `unit_price_cents: 15600` with `currency: "usd"`; on, it is converted at
  `site_settings.usd_exchange_rate` first. A product's catalog `price_usd` is
  itself a converted figure, so it only applies when the switch is on;
- shipping is the courier the customer picked, **re-quoted server-side** at
  hand-off (`lib/payments/puramass-shipping.ts`) with the configured processing
  fee added.

The request body the browser sends carries no prices at all:

```json
{
  "items": [{ "id": "<product uuid>", "packSize": 10, "quantity": 20 }],
  "customer": { "email": "…", "firstName": "…", "lastName": "…", "phone": "" },
  "shipping": {
    "line1": "…", "city": "…", "state": "ON", "postalCode": "M5V 2T6",
    "country": "CA", "courierId": "<easyship courier_service id>"
  },
  "referralCode": "ABC123"
}
```

`packSize` is `1` (single vial) or `10` (pack); `quantity` is **total vials** on
the line. The server maps those to SKUs, prices them, and re-quotes `courierId`.

With the toggle off, the same route sends SKU + quantity only and PuraMass
prices the order — the original behaviour.

### 2. An invoice's payment link (`POST /api/pay/<token>/checkout`)

Each line carries the invoice's own `unit_price_cents` (its `line_total` ÷
quantity, so a per-line discount is included), and the order carries
`shipping_total_cents` from the invoice's shipping — `0` unless
`invoices.charge_shipping_on_checkout` is ticked.

Because the amounts are baked into the link, a pending link is reused only while
it still matches the invoice. Edit an item, a quantity, a price or the shipping
and the next visit mints a fresh hand-off rather than charging the old total.

---

## Reading the money back

A create response, a status read, and a webhook payload each carry a different
combination of totals. Use `puramassChargedCents(source)` rather than reaching
for a field directly: it prefers an explicit grand total, falls back to
`subtotal_cents` **plus the shipping the same payload reports**, and returns
`null` when the source names no amount at all.

`null` must never be read as "free" — settle the balance in full instead, and
let the shortfall show up as a partially paid invoice for an admin.

---

## What the API can't express

Two things have no field on a partner order, so an order carrying either is
charged its lines + shipping only:

- **tax**
- **a processing fee as its own line** — fold it into the shipping figure (which
  is what the hosted checkout's processing fee does) or into the unit prices.

Both surface as a *partially paid* invoice for an admin to reconcile rather than
being silently treated as settled.

---

## Related

- `docs/PURAMASS_HOSTED_CHECKOUT.md` — the whole integration: configuration,
  SKU mapping, the webhook, reconciliation, and the fulfillment queue.
- `lib/payments/puramass.ts` — the API client.
- `lib/payments/puramass-pricing.ts` — resolving a customer's prices.
- `lib/payments/puramass-shipping.ts` — courier options and the processing fee.
