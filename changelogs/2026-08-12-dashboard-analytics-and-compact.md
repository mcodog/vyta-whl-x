# Admin dashboard — analytics widgets, corrected KPIs, compact bento

**Date:** 2026-08-12
**Area:** Admin › Dashboard

## Summary

A second pass on the admin dashboard adds four data widgets, **re-wires the top
KPI cards** (they were reading the wrong sources), moves guides to a slim strip
at the top, and re-lays the page as a dense **bento grid** to minimize scrolling.

## New widgets

- **Top affiliates by commission** — a bar chart of the top 5 affiliates ranked
  by total commission **including pending**, split paid (solid bronze) vs pending
  (light bronze). Commission combines **both** ledgers per affiliate: referral
  (`commissions`) and invoice (`sales_commissions`, mapped via each affiliate's
  linked `sales_persons.user_id`).
- **Revenue breakdown (paid vs outstanding)** — a stacked bar + legend from the
  invoice book (paid = per-invoice payments capped at total; outstanding =
  invoiced − paid).
- **Most-ordered products** — horizontal bars of the top 5 products by units sold
  (aggregated from line items on revenue invoices).
- **Warehouse activity live tail** — a compact, auto-refreshing (20s) feed of
  warehouse actions (packs, ships, checklist edits, photos, customer emails),
  aggregated server-side from the audit log.
- **Revenue by month** — a full-width **line chart** of the last 12 months, two
  series: Paid (solid bronze, with markers + a faint area fill) and Invoiced
  (dashed light bronze). Built as an inline SVG (normalized viewBox +
  non-scaling strokes), month buckets computed server-side from invoice
  `issue_date`.

All charts are hand-built (no chart library) and stay on the bronze palette —
paid/primary is solid bronze, pending/secondary is a lighter bronze, identity is
carried by labels and a legend, not by color alone.

## KPI cards re-wired

The previous cards read the wrong data:

- **Total Revenue** summed `orders.total` across *all* orders (including
  cancelled and unpaid). Replaced with **Paid revenue** and **Outstanding** from
  the invoice book — the same math as the Analytics page, so they can't drift.
- **Pending Commissions** summed only the referral ledger. Now it sums pending
  across **both** ledgers (referral + every invoice commission, reps included).
- The strip is now: **Paid revenue · Outstanding · New customers (this month) ·
  Pending commissions**. New customers counts buyer accounts (`role = 'customer'`)
  registered since the start of the current month.

New endpoint `GET /api/admin/dashboard/overview` (service-role, admin/assistant)
computes the KPIs + the three static charts in one call.

## Layout & guides

- **Guides** moved from a card section at the bottom to a **slim single-row strip
  near the top** — present and discoverable, but low-focus.
- The page is re-laid as a compact bento: KPI strip (4) → charts row (3) → needs-
  attention → bottom row (warehouse tail + recent orders), with tighter spacing,
  a slim "all caught up" state, and a compact recent-orders list. Far less
  vertical scrolling on a normal screen.

## Files

- `app/api/admin/dashboard/overview/route.ts` — new overview endpoint.
- `app/(admin)/admin/_components/DashboardOverview.tsx` — KPI strip + revenue /
  affiliate / product charts.
- `app/(admin)/admin/_components/WarehouseTail.tsx` — live warehouse feed (polls
  `/api/admin/warehouse/activity`).
- `app/(admin)/admin/_components/GuidesStrip.tsx` — slim top guides strip
  (replaces `GuidesPanel.tsx`, removed).
- `app/(admin)/admin/page.tsx` — compact bento layout + compact recent orders.
- `app/(admin)/admin/_components/NeedsAttention.tsx` — slim all-clear + tighter
  spacing. `CollapsibleAlert.tsx` — tighter margin.
- `lib/admin/authed-fetch.ts` — shared bearer-token GET helper.
