# 1. Affiliate invoice line prices are locked to the assigned price list

- **Status:** Accepted
- **Date:** 2026-07-28
- **Area:** Invoicing / AR, Pricing, Access control
- **Related code:**
  - `components/admin/InvoiceForm.tsx` (create/edit form)
  - `app/api/admin/invoices/route.ts` (POST)
  - `app/api/admin/invoices/[id]/route.ts` (PATCH)
  - `lib/admin/affiliate-pricing.ts` (server-side price enforcement)
  - `lib/permissions.ts` (role model)

## Context

The admin area exposes an invoice **create/edit** form (`/admin/invoices/new`,
`/admin/invoices/[id]/edit`) built from a single component, `InvoiceForm`. It is
reachable by more than one role:

- **admin** — full access.
- **affiliate** — surfaced in the product as **"Client"** (a sales
  person / reseller). Affiliates operate inside `/admin` over a restricted set
  of pages, scoped to the customers bound to them (`AFFILIATE_PAGES` in
  `lib/permissions.ts`). They can create and edit invoices for their own
  customers via `canEditInvoice`.
- **assistant** — read-only on invoices (cannot create/edit).

Each product an affiliate can sell has a price defined by the **price list an
admin assigns them** in `admin/pricing` (stored as rows in
`customer_price_overrides` keyed to the affiliate's own customer record). The
whole point of that screen is that an admin controls what price a given
affiliate/client sells at.

**The problem:** the invoice form rendered a free-form, always-editable
`Unit $` (unit price) and `Disc %` (discount) field on every line — for
*everyone*, including affiliates. An affiliate could add a line item and simply
type any price (or discount), completely bypassing the price list an admin set
for them. Worse, the API trusted whatever prices the client submitted: the POST
and PATCH invoice routes already locked an affiliate's *commission rate* and
*sales person* server-side ("never trusted from the request body"), but they
copied each line's `unit_price` / `discount_pct` straight from the request body
into the invoice. So even a UI fix alone would be bypassable by crafting an API
request.

We want the price an affiliate quotes to be **exactly** the price list an admin
gave them — no more ad-hoc price changes by the affiliate.

## Decision

**Only admins may set or override an invoice line's price. Affiliates (and any
non-admin role) are locked to the prices resolved from their admin-assigned
price list.** This is enforced in two layers:

### 1. UI (the requested change)

In `InvoiceForm`, the per-line `Unit $` input is **read-only for non-admins**
(`canEditLinePrices = isAdmin`). Affiliates still add line items and pick products
exactly as before — the price auto-fills from their assigned price list when a
product is chosen — but they cannot type over it. The line-items helper text for
affiliates now says prices come from their assigned price list and the unit price
can't be changed (previously it misleadingly said "editable per line"). The
price-list selector was hidden for affiliates at the time of this decision; it is
now shown **locked** (read-only, with a template/dedicated badge) instead of
hidden — see ADR 0005.

**Discounts are allowed for everyone, including clients.** The per-line `Disc %`
field stays editable for affiliates — a client may discount their own quoted
price — but it is clamped to **0–100%** so a negative discount can't inflate the
line total. (An earlier revision of this ADR locked the discount field too; that
was reversed on product feedback: clients need to be able to give a discount,
just not rewrite the base price.)

### 2. Server (the real boundary)

A UI lock is cosmetic, so the API must not trust affiliate-submitted prices. For
any caller with `role === "affiliate"`, both the POST and PATCH invoice routes
**re-derive every line's `unit_price` from the affiliate's own pricing**, ignoring
the price in the request body, while **keeping the submitted discount clamped to
0–100%**. The re-derivation (`lib/admin/affiliate-pricing.ts`) mirrors the invoice
form's client-side `priceForType`/`priceForProduct` precedence exactly, so a
legitimate affiliate invoice is priced identically — only tampering is
neutralized:

- **Box lines:** affiliate's `customer_price_overrides` → globally active price
  list → product catalog default, with labeled/unlabeled selection and CAD↔USD
  conversion handled the same way the form does.
- **Vial lines:** affiliate's `vial_override_price` (their own single-vial price)
  → catalog `vial_price` → box price ÷ 10. See ADR 0002.
- **Manual (non-product) lines:** $0 — an affiliate cannot invent a free-form
  price.

Discount clamping (`clampDiscount`) is applied to **all** roles, not just
affiliates, so no invoice line can carry a negative discount.

Admins are unchanged — they keep full control over line prices and discounts,
including quoting off any price list or the catalog default.

## Consequences

**Positive**

- Affiliates/clients can only sell at the price an admin set for them; the price
  list in `admin/pricing` is now the single source of truth for their pricing.
- The rule is a genuine authorization boundary, enforced server-side, not just a
  disabled input — it can't be bypassed through the API.
- No behavior change for legitimate affiliate invoices: prices already came from
  their price list; they simply can no longer be overridden.
- Consistent with the existing server-side locking of an affiliate's commission
  rate and sales person.

**Negative / trade-offs**

- The server re-derivation duplicates the form's pricing precedence. If the
  client pricing logic changes, `lib/admin/affiliate-pricing.ts` must be kept in
  sync (both are documented as mirrors of each other).
- Affiliates can no longer set an ad-hoc unit price on an invoice. This is by
  design; a special base price must be set by an admin (as a price-list override
  for that client, or by the admin editing the invoice). They can still apply a
  per-line discount.

**Neutral**

- Assistants already cannot create/edit invoices, so the price lock has no
  effect for them; gating on `isAdmin` is simply future-proof.

## Alternatives considered

- **UI-only lock (disable the fields, trust the client).** Rejected: the API
  would still accept arbitrary prices from an affiliate, so "only admins can
  change the price" would not actually hold.
- **Reject the request when an affiliate submits a mismatched price.** Rejected
  in favor of silently re-deriving: a hard 400 on a rounding difference would be
  fragile and user-hostile, whereas re-deriving guarantees the correct price
  regardless of what was sent.
- **Move all pricing server-side for every role.** Out of scope: admins
  legitimately need to override prices per line, and the existing per-line
  editing for admins is a wanted feature.
