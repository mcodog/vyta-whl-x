# Price Rounding Options + Full-Width Affiliate Pricing Tab

**Date:** August 12, 2026
**Type:** Feature Addition / UI Polish
**Status:** Completed ✅

---

## Overview

Added a **rounding** step to the reusable "apply a price list" form (multiplier →
convert → **round**), so an operator can snap re-priced numbers to tidy,
buyer-friendly amounts. Also widened the **Pricing** tab on the sales-person /
affiliate detail page so the price-list box uses the full width of the page.

---

## What Was Added / Changed

### 1. Rounding transform (nearest $5 / $10 / charm $9, up or down)
**Files:** `lib/pricing-transform.ts`,
`app/api/admin/pricing/apply-transformed/route.ts`,
`app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`

- The shared, pure transform gains a rounding pass applied **last** — after the
  multiplier and the optional CAD→USD conversion — so it acts on the final
  buyer-facing number:
  - **Nearest $5** / **Nearest $10** — snap to the closest multiple.
  - **Ends in $9** — "charm" pricing: the nearest value ending in 9
    (…9, 19, 29 — i.e. `10k − 1`).
  - **Off** — exact prices (previous behaviour).
- A **direction** control chooses **Higher** (round up) or **Lower** (round
  down). Defaults, as requested: **Nearest $10 · Higher**.
- Guardrails: a positive price never floors to `$0` (rounding down keeps at least
  the smallest positive target), and non-positive inputs pass through untouched.
- The client preview and the server write share the same helper
  (`roundPrice` / `transformPrice`), so the previewed numbers are exactly what
  gets stored. Rounding counts as a transform (`isTransformed`), so a rounded
  apply is recorded as a **dedicated** price set (not a faithful template copy)
  and is captured in the audit payload (`round_to`, `round_dir`).

### 2. Rounding UI in the pricing panel
**File:** `app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`

- A new **Round prices** card sits under the Convert control, matching the
  existing design language: pill toggles for **Off / Nearest $5 / Nearest $10 /
  Ends in $9**, a compact **Lower / Higher** segmented direction switch, and a
  live worked example (`e.g. $47 → $50`) so the effect is obvious at a glance.
- Because the panel is shared, the rounding option appears everywhere the
  "apply a price list · multiply · convert" form is used (affiliate pricing tab,
  the per-customer pricing editor, and the customer create/edit modals). With the
  default on, a plain list apply now rounds up to the nearest $10 unless the
  operator switches rounding **Off** — the preview always shows the exact result.

### 3. Full-width Pricing tab on the sales-person / affiliate page
**File:** `app/(admin)/admin/sales-people/[id]/page.tsx`

- Removed the `max-w-3xl` constraint on the **Pricing** tab so the price-list box
  fills the page's content width (up to the page's `max-w-6xl`), with slightly
  roomier card padding. The intro copy now mentions rounding alongside multiply
  and convert.

---

## Files

- `lib/pricing-transform.ts`
- `lib/pricing-transform.test.ts` (new — covers `roundPrice`, `transformPrice`,
  `isTransformed`, and the normalizers)
- `vitest.config.ts` (new — resolves the `@/…` path alias for unit tests)
- `app/api/admin/pricing/apply-transformed/route.ts`
- `app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`
- `app/(admin)/admin/sales-people/[id]/page.tsx`
- `docs/adr/0006-pricing-multiplier-and-currency-convert-tool.md` (updated)

No schema or API-shape changes: `round_to` / `round_dir` are optional body
fields on the existing `apply-transformed` route and default to no rounding when
absent (server-side), preserving backwards compatibility for any other caller.
