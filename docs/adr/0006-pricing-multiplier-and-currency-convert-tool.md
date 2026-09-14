# 6. Re-pricing a source with a multiplier and an optional CAD→USD convert

- **Status:** Accepted
- **Date:** 2026-08-10
- **Area:** Pricing, Affiliates
- **Related code:**
  - `lib/pricing-transform.ts` (shared transform — multiplier + convert)
  - `app/api/admin/pricing/apply-transformed/route.ts` (server apply)
  - `app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx` (the reusable form)
  - `app/(admin)/admin/pricing/page.tsx` + `_components/AffiliatePricingView.tsx` (Affiliate Pricing tab)
  - `app/(admin)/admin/pricing/customer/[id]/page.tsx`, `app/(admin)/admin/sales-people/[id]/page.tsx` (ported form)
  - ADR 0001 (affiliate invoice pricing), 0004 (affiliate list sync), 0005 (template vs dedicated)

## Context

Applying prices to a customer was a straight copy: `apply-to-customer` writes a
price list's item prices verbatim onto `customer_price_overrides` (ADR 0004/0005).
Operators, though, routinely want the *same* list re-priced before it lands:

- Sell a shared list at a **percentage** of its numbers (a 150% "premium"
  tier, a 25% sample price), without hand-maintaining a parallel list per tier.
- Price a one-off **USD** book from a CAD list. The site-wide FX rate in Site
  Settings (`usd_exchange_rate`, a CAD→USD multiplier ≈ 0.73) is deliberately
  *global*: nudging it to price one customer would silently re-price every auto
  USD number across the storefront and every invoice.
- Copy **another customer's** bespoke ("dedicated", ADR 0005) prices as a
  starting point, re-priced, onto a new customer.

There was also no single home for "affiliate pricing": affiliates and the
bound-customer prices their list drives (ADR 0004) were only visible by walking
the sales-people pages.

## Decision

**Add a re-pricing transform in front of the apply step, expressed once and
reused everywhere the "apply a price list" form appears.**

1. **A shared, pure transform** (`lib/pricing-transform.ts`): a percentage
   **multiplier** chosen from preset toggles (25 / 50 / 75 / 100 / 150 / 200 /
   300; 100 = unchanged) and an optional **CAD→USD convert** that divides by an
   editable, **per-use** `cadPerUsd` rate (default **1.45** — CAD per one USD, so
   `USD = CAD ÷ 1.45`). Convert is offered **only for CAD sources**; a USD source
   is already in the target currency. The same helper powers the client preview
   and the server write, so previewed numbers are exactly the numbers stored.

2. **A per-use rate, separate from Site Settings.** The 1.45 default is a
   convenience for one-off USD pricing and never touches the global
   `usd_exchange_rate`. It is expressed as CAD-per-USD (a division) rather than
   the global CAD→USD multiplier, matching how an operator thinks about it
   ("one US dollar is about 1.45 loonies").

3. **One server route** (`apply-transformed`) supersedes the copy: it reads a
   source (a **price list** or **another customer's** current custom prices),
   applies the transform, and upserts the result onto the target's overrides.
   An untransformed price-list copy (×100, no convert, override mode) is recorded
   as `template` with `applied_pricelist_id` set — identical to the old path;
   anything transformed, kept-existing-with-skips, or copied from a customer is
   `dedicated` with no single list to point at (ADR 0005). It sets the target's
   `price_currency` to the result currency and calls the affiliate list sync
   (ADR 0004), so all existing invariants still hold.

4. **The form is reused, not re-implemented.** `CustomerPricingPanel` gains the
   source picker, multiplier, and convert controls, and is embedded in the
   customer create/edit modals, the per-customer pricing editor
   (`/admin/pricing/customer/[id]`), and — for affiliates — the sales-person
   detail page. A new **Affiliate Pricing** tab on the Pricing page shows each
   affiliate with the bound-customer prices their list drives. Applying always
   targets **the entity in context** (the customer/affiliate whose form it is).

5. **The Customer Pricing cards** collapse "Add override" + "See all" into a
   single **Edit pricelist** action that opens the per-customer editor (which now
   hosts the form), removing the redundant inline create.

## Consequences

**Positive**

- Percentage tiers and one-off USD books come from an existing list with two
  clicks — no parallel lists to maintain, and the global FX rate is untouched.
- Preview and write share one transform, so what you see is what is saved.
- The apply path stays a single, audited chokepoint; template/dedicated,
  currency tagging, and affiliate sync keep working unchanged.

**Negative / trade-offs**

- A transformed apply writes *literal* numbers: it is a snapshot, not a live
  link. Change the source list later and transformed customers do not follow
  (same as a manual override — and by design, since the transform is bespoke).
- Two conversion conventions now coexist: the global CAD→USD multiplier
  (Site Settings) and this per-use CAD-per-USD divisor. They are documented as
  distinct on purpose; the divisor is scoped to this tool only.
- `apply-transformed` is admin-scoped (like `apply-to-customer`), so the form is
  shown only to admins on the ported pages even where affiliates can view them.

## Update — 2026-08-12: an optional rounding pass

The transform gained a third, optional step after the multiplier and convert: a
**rounding** pass that snaps each final price to a tidy number.

- Targets: the **nearest $5** or **$10**, or a **charm** price ending in 9
  (…9, 19, 29 — i.e. `10k − 1`). `Off` = exact (the prior behaviour).
- Direction: **Higher** (round up) or **Lower** (round down).
- Default: **nearest $10, Higher**.
- It runs **last** — on the post-multiplier, post-convert number — because that
  is the buyer-facing figure being tidied. A positive price never floors to `$0`
  when rounding down (it keeps at least the smallest positive target).

It lives in the same shared helper (`roundPrice` / `transformPrice` /
`isTransformed`), so preview and server write stay identical, and a rounded apply
is `dedicated` (like any other transform). The `apply-transformed` route accepts
two new optional body fields, `round_to` (`0 | 5 | 10 | 9`) and `round_dir`
(`up | down`), both audited; absence means no rounding, so existing callers are
unaffected. Unit-tested in `lib/pricing-transform.test.ts`.

## Alternatives considered

- **Reuse the global `usd_exchange_rate` for convert.** Rejected: pricing one
  customer in USD would require moving a rate that re-prices the whole site.
- **Store the multiplier/convert as a live rule on the customer.** Rejected as
  premature: it complicates every price read for a feature that is, in practice,
  "stamp these numbers now." Overrides already model a stamped price.
- **A separate one-off "transformed list" object.** Rejected: it re-introduces
  the parallel-list maintenance the multiplier exists to avoid.
