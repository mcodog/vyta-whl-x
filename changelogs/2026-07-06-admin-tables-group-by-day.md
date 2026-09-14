# Admin Tables — Grouped by Day

Date: 2026-07-06

The three main admin tables — **Orders**, **Invoices**, and the **Dashboard**'s
Recent Orders list — now group their rows by day. A divider row is inserted
before the first row of each day, showing the date in a readable format so it's
easy to see at a glance which rows belong to which day.

## What changed

- Rows are split into per-day groups. Each group is preceded by a full-width
  divider row with a calendar icon, the day heading, and a count of how many
  rows fall on that day.
- The day heading reads **"Today"** or **"Yesterday"** for the two most recent
  days, and otherwise a full readable date like **"Monday, July 6, 2026"**.
- Grouping runs over the rows already shown (the current page after search,
  filters, and pagination), so it adds no extra data fetching and respects
  every existing filter.
- Orders are grouped by order date, invoices by issue date, and the dashboard's
  Recent Orders by order date. Rows already arrive newest-first, so days appear
  in descending order.

## Implementation

- New helper `lib/dayGroups.ts`:
  - `localDayKey` — a stable local-time `YYYY-MM-DD` key for a date.
  - `formatDayHeading` — the "Today" / "Yesterday" / full-date label.
  - `groupByDay` — splits an ordered list into consecutive per-day buckets via a
    caller-supplied date accessor; rows with a missing/invalid date fall into an
    "Unknown date" group.
- New component `components/admin/DayDivider.tsx` (`DayDividerRow`) — the
  full-width `<tr>` divider spanning all columns, reused by every table.

## Files

- `lib/dayGroups.ts` (new)
- `components/admin/DayDivider.tsx` (new)
- `app/(admin)/admin/orders/page.tsx`
- `app/(admin)/admin/invoices/page.tsx`
- `app/(admin)/admin/page.tsx`
