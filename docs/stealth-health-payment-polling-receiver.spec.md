# Stealth Health — Payment Confirmation by Polling (Build Spec)

> Portable spec for a **second project** that already uses the Stealth Health /
> PuraMass hosted checkout and needs to learn when its orders are **paid**, but
> **cannot receive the portal's webhook** (only one webhook URL is registered on
> the shared partner account, and Stealth Health won't add a second).
>
> The solution needs **nothing from Stealth Health and nothing from the other
> ("primary") project**: this project polls the portal's own read endpoints with
> the shared API key and updates its own orders. Precise enough that an AI can
> build it from this doc alone. Stack-neutral (examples in TypeScript).
>
> This mirrors, in pull form, the webhook receiver the primary project uses. If a
> webhook ever becomes available, prefer it — this polling path is the fallback
> that depends on no provider changes.

---

## 1. Overview

Today this project already:
1. Builds a cart and **POSTs it** to `POST /partner/store/orders` (server-side,
   with the partner credentials), getting back a `transaction_id` and a
   `payment_link`.
2. Redirects the customer to the `payment_link`; the customer pays on the
   Stealth Health hosted page.

What's missing: after the redirect, **nothing tells this project the order was
paid**, because the portal's `store_order.payment_complete` webhook is delivered
only to the primary project's URL.

This spec adds a **scheduled poller** that asks the portal for the current status
of this project's own pending orders and, when one flips to `paid`, updates the
local order (marks it paid, kicks off fulfilment/emails — whatever "paid" means
here). It relies only on:
- the **shared API credentials** this project already uses to create orders, and
- the portal's **read endpoints** (already live), not any webhook config.

---

## 2. Portal read contract (universal — fixed by Stealth Health)

### 2.1 Base + auth
- **Base URL:** `https://api.stealth.health` (configurable).
- **Headers on every call, SERVER-SIDE ONLY** (the key is a live secret):
  - `X-Partner-ID: ptr_…`
  - `X-Api-Key: sk_live_…`

### 2.2 `GET /partner/store/orders/{transaction_id}` — order status (primary)

The `transaction_id` is the one returned when the order was created. Same auth
headers, no body.

```jsonc
{
  "order": {
    "transaction_id": "aBc123…",
    "status": "paid",                 // see status vocabulary below
    "payment_mode": "customer",
    "partner_reference": "your-internal-id",  // whatever you sent at create time
    "currency": "usd",
    "subtotal_cents": 8700,
    "payment_link": "https://app.puramass.com/transaction/aBc123…",
    "created_at": "2026-08-05T14:00:00.000Z",
    "paid_at":    "2026-08-05T14:12:31.000Z",  // set when paid, else null
    "expires_at": "2026-08-12T14:00:00.000Z",  // 7 days after creation
    "items": [ { "sku": "…", "name": "…", "quantity": 2, "unit_price_cents": 2900 } ]
  }
}
```

Parse defensively: the order may be at the top level or under `order`.

**Status vocabulary + transitions**
| status | meaning | terminal? |
| --- | --- | --- |
| `payment_pending` | link minted, customer hasn't paid | no |
| `paid` | payment captured; `paid_at` set; order confirmed → fulfilment | **yes** |
| `expired` | the 7-day link lapsed unpaid; mint a new order to retry | **yes** |
| `cancelled` | cancelled by Stealth Health staff (rare) | **yes** |

Note: `items` reflect what the customer **actually paid for** — a line removed on
the hosted page before paying won't appear.

### 2.3 `GET /partner/events` — event replay (optional optimization)

Same API-key auth. Lets you pull `store_order.payment_complete` events instead of
polling each order. **Contract unconfirmed** (pagination / cursor / filtering are
not documented to us) — treat as a later optimization; build §4 on the status
endpoint first, which is fully specified. See §9.

### 2.4 Create-order response (for reference — you already call this)

`POST /partner/store/orders` returns the `order` with `transaction_id`,
`payment_link`, `status: "payment_pending"`, `subtotal_cents`, and echoes your
`partner_reference`. **Persist `transaction_id` + `partner_reference` at this
point** — the poller keys off them.

---

## 3. Prerequisites in this project

1. **A local order/hand-off record** per checkout, storing at least:
   `transaction_id`, `partner_reference`, `status` (default `payment_pending`),
   `created_at`, and your own order id / customer linkage. Add `paid_at` and
   (optional) `expires_at`. If you already store the transaction, just add a
   `status`/`paid_at` if missing.
2. **The shared partner credentials** available server-side
   (`STEALTH_API_KEY`, `STEALTH_PARTNER_ID`, `STEALTH_API_BASE_URL`) — the same
   ones used to create orders. **Never expose them to the browser.**
3. **A scheduler** (cron, queue, or your framework's scheduled function) that can
   run every minute or few minutes.
4. Outbound network access to `api.stealth.health`.

---

## 4. Polling design

### 4.1 The status client (server-only)

```ts
async function fetchOrderStatus(transactionId: string): Promise<{
  status: string; paid_at: string | null; subtotal_cents?: number; currency?: string;
}> {
  const res = await fetch(
    `${BASE_URL}/partner/store/orders/${encodeURIComponent(transactionId)}`,
    { headers: { 'X-Partner-ID': PARTNER_ID, 'X-Api-Key': API_KEY }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = await res.json();
  const order = body?.order ?? body;
  if (!order || typeof order.status !== 'string') throw new Error('bad status response');
  return {
    status: order.status,
    paid_at: order.paid_at ?? null,
    subtotal_cents: order.subtotal_cents,
    currency: order.currency,
  };
}
```

### 4.2 The scheduled poll (every 1–5 min)

```
For each local order where status = 'payment_pending'
                     AND created_at >= now - 7 days:        // link-expiry window
  try:
    s = fetchOrderStatus(order.transaction_id)
    if s.status != order.status:
      applyStatus(order, s)          // idempotent; see 4.3
  catch (transient error):
    leave as-is; next run retries
```

- **Selection bounds the work**: only non-terminal, non-expired orders are
  polled, so cost stays flat as history grows.
- **Concurrency / rate**: cap in-flight requests (e.g. 5–10) and, if the portal
  rate-limits, back off on 429. One request per pending order per run.
- **Cadence**: every 1–5 min is plenty (a customer pays within minutes). Optional
  refinement: poll fresh orders (< 1 h old) every minute and older-but-still-
  pending ones every 10–15 min to cut calls.
- **Expiry**: once `created_at` passes the 7-day window, stop polling and mark the
  order `expired` locally (optionally do a final status read first).

### 4.3 Applying a status change (idempotent)

```
applyStatus(order, s):
  if order.status is terminal: return           // never move off a terminal state
  if s.status == 'paid':
      set order.status = 'paid', order.paid_at = s.paid_at ?? now
      --> run the "order is paid" side effects EXACTLY ONCE
          (mark paid, decrement stock / create fulfilment, send confirmation email)
  elif s.status in ('expired','cancelled'):
      set order.status = s.status
  else: return                                   // still pending, no-op
```

- **Idempotency is the whole game**: guard the paid side-effects on the local
  transition `payment_pending → paid`. A repeated `paid` read must be a no-op.
  Do the state flip and the side-effect trigger in one transaction, or set a
  `paid_processed` flag, so two overlapping poll runs can't double-fire.
- Prevent overlapping runs of the whole job (a lock / "skip if previous still
  running") so the same order isn't processed twice concurrently.

---

## 5. Edge cases & failure modes

- **Transient API/network error / timeout / 5xx**: skip that order this run; the
  next run retries. Polling is naturally self-healing — no lost updates.
- **429 rate-limit**: back off (respect `Retry-After` if present); reduce
  concurrency.
- **Unexpected/unknown status string**: store it, don't fire paid side-effects;
  surface for a human.
- **`paid` with no `paid_at`**: use "now".
- **Order never pays**: expires after 7 days → mark `expired`, stop polling.
- **Two poll runs overlap**: the idempotency guard (§4.3) + a job lock prevent
  double processing.
- **Clock skew on the 7-day window**: add a small grace (e.g. poll up to 7 days +
  6 h) so a just-in-time payment isn't missed.

---

## 6. Security

- Credentials are **server-only** (env), never shipped to the browser, never
  logged. The poller runs in the backend / a scheduled worker.
- Only **read** endpoints are used — polling can't mutate portal state.
- Treat the API key like a payment secret; scope it to the worker that needs it.

---

## 7. Reference: how the primary project does the same thing (for parity)

The primary project receives the webhook and, on `paid`, updates its ledger and
creates a fulfilment record. Its admin also has a **manual "Refresh"** action
that calls this exact status endpoint for one order and applies the result — i.e.
one iteration of §4.2. This poller is that logic on a timer. Keeping the
**status vocabulary and the paid side-effects identical** to the primary project
keeps the two consistent.

---

## 8. Implementation checklist

1. **Config**: `STEALTH_API_KEY`, `STEALTH_PARTNER_ID`, `STEALTH_API_BASE_URL`
   (server-only).
2. **Persist** `transaction_id` + `partner_reference` + `status` on each order at
   create time (§2.4) if not already.
3. **Status client** (§4.1) — defensive parse, timeout, no-store, no key in logs.
4. **Scheduled job** (§4.2) — select pending + non-expired, poll, cap
   concurrency, back off on 429.
5. **Idempotent apply** (§4.3) — transition guard + one-time paid side-effects +
   job lock.
6. **Expiry sweep** — mark orders `expired` past the 7-day window.
7. **Observability** — log status transitions and API errors; alert if the job
   hasn't succeeded in N minutes.
8. **(Later) events feed** — once the `GET /partner/events` contract is
   confirmed, replace per-order polling with a cursor-based pull filtered by
   `partner_reference` to cut request volume (§9).

---

## 9. Open questions & unverified items

- **`GET /partner/events` contract** — it exists ("replay any time, same API key
  auth") but its response shape, pagination/cursor, and filtering aren't
  documented to us. Confirm before building the events-feed optimization; the
  per-order status endpoint (§2.2) needs no such confirmation.
- **Rate limits** on the read endpoints are unspecified — implement backoff and
  bounded concurrency defensively; confirm limits if you expect high volume.
- **Exact status strings** beyond the four documented (`payment_pending`, `paid`,
  `expired`, `cancelled`) — handle unknowns conservatively (store, don't act).
- **Shared vs separate partner account** — this spec assumes the shared-account
  setup (one webhook URL, this project polls with the shared key). If this
  project has its *own* account, it can register its *own* webhook and skip
  polling entirely.
