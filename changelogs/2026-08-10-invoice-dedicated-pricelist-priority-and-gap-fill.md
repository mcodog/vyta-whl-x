# New/Edit Invoice — dedicated customer price list is now clearly prioritized, with an opt-out for filling gaps

Date: 2026-08-10

The invoice form has always had a **Price List** selector that defaults to the
globally *active* price list. It kept showing that active list even after you
picked a customer who has **their own dedicated price list** — which was
confusing, because the customer's own prices silently take priority over
whatever the selector shows.

This clears up the priority and gives you control over the one place the
selector still matters for those customers: products the customer's list
doesn't price.

## How pricing is prioritized (unchanged, now surfaced)

For every product line, the price is resolved in this order:

1. **The customer's dedicated price list** — their per-customer overrides
   (admin/pricing → Customer Pricing). These always win.
2. **The price list picked in the selector** — only for products the
   customer's list doesn't cover.
3. **Website Pricing** — the catalog default (`products` table) for anything
   left.

The dedicated list always winning is not new — it's how `priceForProduct`
already worked. What's new is that the form now *says so*, and lets you decide
how the gaps in step 2 are filled.

## What changed

The Price List panel was revamped to say all of this clearly without clutter:

- **A `?` help tooltip on the "Price List" label** spells out the pricing
  priority (dedicated → selected list → Website Pricing) and notes that **line
  items are saved as a snapshot** — editing a catalog price or price list later
  never changes an existing invoice. The tooltip is role-aware: affiliates
  instead see that their prices come from an admin-assigned list and can't be
  edited here.
- **A "Customer price list" tag** sits under the selector with an **active
  (bronze)** state when the linked customer has their own list and a **greyed
  (inactive)** state when they don't. The old inline paragraph
  (*"{Customer} has a dedicated price list — those prices take priority…"*) now
  lives in that tag's **hover tooltip**, so the panel stays compact.
- **Gap-fill is now a toggle switch** (styled like the "With labels" switch)
  rather than a checkbox: on → *"Fill gaps from {selected list}"*, off →
  *"Gaps use Website Pricing"*, with a one-line subtext defining "gaps" as the
  products the customer's list doesn't price and reminding that their own
  prices always win. **On by default** (gaps fall back to the selected list,
  then the catalog); off routes uncovered products straight to Website Pricing.
- **Compact status tags.** The verbose "Pricing from … · Active · USD prices
  shown as-is · Active list: …" line became a short *"Fills from {list}"* plus
  small **Active** / **USD as-is** pills.
- **Selector stays usable** as the gap-filler; the toggle only appears when the
  customer has a dedicated list *and* a real list is selected to fill from
  (Website Pricing has nothing to fill from).
- **Quieter per-line note.** The line-level *"Not in {list} — using Website
  Pricing"* hint no longer shows when you've deliberately turned gap-fill off —
  catalog pricing for gaps is the intended outcome then.

## Unchanged behaviour

- **Dedicated prices always win.** The opt-out only moves the price for
  products the customer's list doesn't cover — never the ones it does.
- **Resets per customer.** Switching customers restores the default (gap-fill
  on), so it never carries a previous customer's choice.
- **Affiliates are unaffected** — their lines still price from their own
  assigned list, and the selector/tag/toggle are admin-only.
- **Nothing new is persisted.** The toggle only shapes the default unit prices
  the form computes; the saved line prices are what they've always been.

## Files

- `components/admin/InvoiceForm.tsx` — new `fillGapsFromList` state (default
  on, reset on customer change); `priceForProduct`/`priceForType`/
  `repriceLinesFrom` thread a `fillGaps` flag so gaps skip the selected list
  and fall to the catalog when it's off; `changeFillGaps` re-prices lines on
  toggle. The Price List panel was revamped: a `?` `InfoHint` on the label
  (pricing priority + snapshot, role-aware), a "Customer price list" tag with
  active/greyed states whose detail lives in a hover `Tooltip`, the gap-fill
  control as a switch styled like the "With labels" toggle, and a compact tags
  row. The per-line pricelist-fallback hint is suppressed while gap-fill is off.
  Reuses the shared `components/Tooltip.tsx` (`Tooltip` + `InfoHint`); `Field`
  gains an optional `hint` slot.
