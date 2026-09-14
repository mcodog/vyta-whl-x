# Admin dashboard remodel + Guides wiki

**Date:** 2026-08-12
**Area:** Admin › Dashboard, Admin › Guides (new)

## Summary

The admin **Dashboard** is reorganized and re-skinned to the site palette, and a
new **Guides & How-tos** wiki is added (seeded with two guides). Two goals drove
the change:

1. **A calmer, palette-first look.** The old dashboard leaned on full color-fill
   boxes — a red banner for auto-shipment failures, an amber banner for
   low-stock, and a rainbow of icon chips on the stat cards. Those are replaced
   with white cards on the neutral line color. Off-palette colors (red / amber /
   status hues) now appear **only as accents** — an icon, a count, a status dot —
   never as a filled background.
2. **A better home for "what needs attention."** Products to restock and
   auto-shipment failures were two separate stacked banners that started
   collapsed. They're now a single **Needs attention** section that shows the
   items inline, side by side.

## Dashboard layout

- New page header (**Dashboard** + one-line subtitle).
- Order: header → live fulfillment activity → stat cards → **Needs attention** →
  Recent Orders → **Guides & How-tos**.
- **Stat cards**: all four icons now use the single **bronze** palette accent
  instead of emerald / bronze / blue / purple, so the row reads as one system.
- **Recent Orders status**: the colored status pills become a neutral pill with a
  small colored **dot** (the only accent), so the table reads calmly.

## Needs attention

- A new `NeedsAttention` component replaces the separate `AutoShipmentAlerts`
  banner and the inline low-stock banner.
- Renders up to two white cards in a responsive grid:
  - **Auto-shipment failures** — order number, stage (Shipment/Label), error and
    time; red survives only on the alert icon and the count. Admins keep the
    per-row **dismiss** and **clear all** actions (service-role delete, optimistic
    update), and rows still link to the order.
  - **Restock needed** — product, "N left / threshold" (amber, or red when out of
    stock); links to Products.
- Each card previews the first 5 items with a **View all** link to the full page.
- Stable **"You're all caught up"** state when nothing needs attention (instead of
  the section simply vanishing).

## Guides & How-tos (new)

- New internal wiki at **/admin/guides** (index) and **/admin/guides/[slug]**
  (reader), plus a **Guides** item under a new **Help** group in the sidebar and a
  featured **Guides & How-tos** section on the dashboard.
- Content lives in a small hand-authored registry (`lib/admin/guides.tsx`); adding
  a guide is a single entry there.
- Seeded with four guides across two categories:
  - **How to set up an affiliate** — create a sales person, promote them to an
    affiliate (login + referral code), set commission rates, share the referral
    link.
  - **Affiliate vs. Sales Person** — the same person in two tiers; who logs in,
    who earns what, and when to promote. Includes a comparison table.
  - **How to set up pricing for a customer** — apply a price list vs. set
    dedicated prices, the re-price multiplier + CAD→USD convert, per-vial prices,
    and the implications (template-vs-dedicated stickiness, snapshot-not-live
    applies, the per-use convert rate vs. the global FX rate).
  - **How to set up pricing for affiliates** — same flow plus the affiliate-only
    rules: invoice prices are locked (server-enforced, discount still allowed),
    the affiliate's two price lists are kept in sync with their bound customers,
    and affiliates can't manage their own pricing.
- Admin/assistant only; affiliates never reach it (the existing admin page guard
  bounces non-allowed pages).

## Files

- `app/(admin)/admin/page.tsx` — new layout, bronze stat icons, dotted status
  pills, wires in `NeedsAttention` + `GuidesPanel`.
- `app/(admin)/admin/_components/NeedsAttention.tsx` — new combined attention
  section (absorbs the old auto-shipment dismiss/clear logic).
- `app/(admin)/admin/_components/AutoShipmentAlerts.tsx` — removed (folded in).
- `app/(admin)/admin/_components/CollapsibleAlert.tsx` — tones re-skinned to white
  cards with a thin left accent rail (used by `FulfillmentAlerts`).
- `app/(admin)/admin/_components/FulfillmentAlerts.tsx` — bronze header icon,
  neutral row icon chips.
- `app/(admin)/admin/_components/GuidesPanel.tsx` — new dashboard guides section.
- `lib/admin/guides.tsx` — guide registry + prose primitives + two guides.
- `app/(admin)/admin/guides/page.tsx`, `app/(admin)/admin/guides/[slug]/page.tsx`
  — new wiki index + reader.
- `app/(admin)/admin/layout.tsx` — new **Help › Guides** nav item.
