# 7. Admin / client / analytics panels are made mobile-friendly without touching desktop

- **Status:** Accepted
- **Date:** 2026-08-14
- **Area:** Admin, Client (customer account), Analytics — UI / layout
- **Related code:**
  - `app/(admin)/admin/layout.tsx` (the admin shell — already responsive; prior art)
  - `app/layout.tsx` (`viewport` with `viewportFit: 'cover'` — safe-area insets already wired)
  - `tailwind.config.ts` (default Tailwind breakpoints — no custom `screens`)
  - `app/(admin)/admin/invoices/page.tsx` (first page ported — the table→card archetype)
  - Future: every `app/(admin)/admin/**`, `app/(customer)/account/**`, and the
    `/admin/analytics` page, ported page-by-page under this ADR.

## Context

The internal panels — the admin console (~35 routes), the client (customer)
account area, and the analytics dashboard — were built desktop-first. The
**shell** is already responsive: `app/(admin)/admin/layout.tsx` renders a mobile
top bar + slide-in drawer below `lg` and a static sidebar rail at `lg` and up,
and the root `viewport` already exposes the iOS safe-area insets. What is *not*
mobile-friendly is the **content** of the pages inside that shell.

The dominant offender is the data table. Every list page follows the same shape:

```
<div className="overflow-x-auto">
  <table className="w-full min-w-[840px]"> … </table>
</div>
```

On a 390px iPhone this means a horizontally-scrolling 8-column table. Invoices
went further and shrank the whole table to `text-[7px]`–`text-[9.8px]` to cram
the columns in — legible on a 27" monitor, unreadable on a phone. Forms, stat
grids, toolbars, modals and pagination have similar desktop-only assumptions.

Two hard constraints framed the work:

1. **Desktop must not change — at all.** These are the tools the team uses all
   day on large screens. A mobile pass that shifts a desktop pixel is a
   regression, not a feature. We needed a mechanism that makes "did this touch
   desktop?" mechanically checkable, not a matter of eyeballing.
2. **iPhone is the priority target.** When iOS Safari and Android Chrome
   disagree, iOS wins. In practice this is about Safari's quirks (focus-zoom,
   `100vh`, the notch/home-indicator), not two separate implementations.

## Decision

### 1. `lg` (1024px) is the desktop freeze line

The admin shell already switches between mobile and desktop at Tailwind's `lg`
breakpoint. We adopt the same line everywhere: **at `≥1024px` every panel renders
byte-identical to before this work.** Below `lg` is where mobile improvements
live. We do not introduce custom breakpoints — default Tailwind (`sm` 640, `md`
768, `lg` 1024, `xl` 1280, `2xl` 1536) is enough, and adding `screens` to the
config would be a global change that risks desktop.

"Desktop" therefore means "≥ `lg`". Tablets in landscape (iPad ~1024) get the
desktop layout; phones and portrait tablets get the mobile layout. This is a
deliberate simplification — one mobile layout, one desktop layout, one seam.

### 2. Mobile changes are *additive* — two allowed techniques

Because Tailwind is mobile-first (an unprefixed utility applies at every width;
a `lg:`-prefixed one wins at ≥1024px), we can always restore the desktop value at
`lg`. Every change on a ported page uses one of exactly two techniques:

- **(A) Restate the desktop value at `lg`.** When an existing *unprefixed* class
  defines the desktop layout, re-express it as `«mobile-value» lg:«original»`.
  The `lg:` copy reproduces the desktop value exactly, so ≥1024px is unchanged
  while below `lg` gets the new value.

  ```diff
  - <div className="flex gap-8">                     {/* row, everywhere */}
  + <div className="flex flex-col gap-8 lg:flex-row"> {/* stacked <lg, row ≥lg */}
  ```

  Classes that are *already* correct at desktop and only need a smaller-screen
  variant (e.g. `grid-cols-2 lg:grid-cols-4`) need no restatement — desktop
  already reads the `lg:` value.

- **(B) Dual-render tables: desktop table + mobile cards.** A `<table>` cannot
  reflow into cards without fragile CSS. Instead we wrap the *existing* table
  container in `hidden lg:block` (so it is untouched at ≥1024px and simply hidden
  below `lg`) and add a **sibling** `lg:hidden` stacked-card list that renders the
  same rows as tap-to-open cards. Desktop never sees the cards; mobile never sees
  the table. The two share the same data, handlers and dialogs.

  This is the archetype for every list page. The card is a per-page component
  (co-located under the page's `_components/`, or inline when small) because each
  table surfaces different fields; there is no single generic card. What is
  shared is the *pattern*, documented here and demonstrated on Invoices.

**Forbidden:** editing or deleting any `lg:` / `xl:` / `2xl:` class that already
governs desktop, or changing an unprefixed class in a way that is *not* restored
at `lg`. Either would move a desktop pixel.

**Scope of (B): page-flow tables, not bounded ones.** The card treatment targets
tables whose `overflow-x-auto` sits in normal page flow — those force the *whole
page* to scroll sideways on a phone. A table already inside a height-capped,
self-scrolling box (`max-h-* overflow-auto`, e.g. a modal's CSV-import preview, a
bulk-apply "what will change" panel, a bulk price-entry grid) scrolls **within its
own box**, not the page, and these are desktop-centric power/confirmation flows.
Those are left as bounded internal scrolls rather than carded — a deliberate,
consistent line, not an oversight.

### 3. iPhone-first rules of thumb (apply below `lg`)

- **Primary width: 390px** (iPhone 15/14/13/12). Must also hold at **375px**
  (iPhone SE / mini). Check both edges.
- **Tap targets ≥ 44×44px** (Apple HIG). Icon-only controls that are `w-8 h-8`
  (32px) on desktop get bumped below `lg` (e.g. `h-11 w-11 lg:h-8 lg:w-8`) or
  gain padding; adjacent tap targets keep spacing so fingers don't mis-hit.
- **Inputs use ≥ 16px font on mobile** (`text-base lg:text-sm`, or `text-[16px]`).
  iOS Safari auto-zooms the page when focusing an input smaller than 16px; this
  prevents that jarring zoom. Applies to `<input>`, `<textarea>`, `<select>`.
- **Full-height uses `dvh`, not `vh`.** iOS Safari's `100vh` sits under the
  URL bar; prefer `min-h-[100dvh]` / `h-dvh` for anything meant to fill the
  screen. (`globals.css` still has one `min-height: 100vh` on `body`; leave it —
  it is a minimum, not a lock, and changing global CSS is out of scope per §1.)
- **Respect the safe area.** Bottom-anchored, fixed, or sticky mobile UI pads
  itself past the notch/home indicator with `env(safe-area-inset-*)` (already
  exposed via `viewportFit: 'cover'`). Tailwind arbitrary values work:
  `pb-[env(safe-area-inset-bottom)]`.
- **No hover-only affordances on mobile.** Anything revealed on `:hover` (row
  action bars, tooltips) must be reachable by tap, since iOS has no hover.
- Android Chrome is expected to work and is sanity-checked, but is not the
  design target and does not get its own code paths.

### 4. One page (or tightly-scoped batch) at a time

We port **page-by-page**, not with a global sweep, so each change is small
enough to review intricately and to confirm "desktop unchanged" by inspection.
Ordering, busiest/most-reused patterns first:

1. **Admin — Invoices** (list, then detail) — establishes the table→card
   archetype the rest of admin reuses. *(this ADR's reference implementation)*
2. Remaining admin data-table pages (customers, products, orders, purchase
   orders, …), reusing the archetype.
3. **Analytics** (`/admin/analytics`) — stat tiles, charts, ranked tables.
4. **Client** (`/account/*`) — dashboard, orders, order detail.

Each ported batch is committed on its own and, where it introduces a
non-obvious decision, notes it here or in a follow-up ADR.

### 5. How "desktop unchanged" is verified

- **Static check:** the diff for a ported page adds mobile/`lg:`-restored classes
  and `hidden lg:block` / `lg:hidden` wrappers; it never removes or edits an
  existing `lg:`+ class that governs desktop. A reviewer can confirm this from
  the diff alone.
- **Visual check:** the page is eyeballed at 390, 768, 1024 and 1440px. The 1024
  and 1440 renders must match `main` (the freeze line and above).

## Consequences

**Positive**

- Desktop is provably untouched: the freeze line is a single breakpoint (`lg`)
  and the two techniques both preserve the ≥1024px cascade, so the guarantee is
  checkable from the diff, not just by looking.
- The table→card archetype, proven once on Invoices, drops onto the other ~34
  admin lists with only per-page field choices to make.
- iPhone quirks (focus-zoom, safe area, hover) are handled once as rules of
  thumb rather than rediscovered per page.
- No global CSS or Tailwind-config change, so no page can regress as a side
  effect of the mobile work.

**Negative / trade-offs**

- **Two renderings per list page.** The desktop table and the mobile card render
  the same row twice. They can drift if a new column is added to one and not the
  other. Mitigation: both live in the same file/feature folder and read the same
  row type, so the second rendering is right there when editing.
- **Verbosity.** Restating desktop values at `lg` makes class lists longer
  (`flex flex-col gap-8 lg:flex-row`). Accepted as the cost of the guarantee.
- **The `lg` seam is coarse.** A landscape phone (~900px wide) still gets the
  mobile layout; a portrait iPad Pro (1024) gets desktop. Matching the shell's
  existing seam is worth more than per-page fine-tuning of the boundary.
- **Incremental coverage.** Until every page is ported, the panels are a mix of
  mobile-ready and horizontal-scroll pages. The batching plan (§4) makes the
  order explicit rather than leaving it ad hoc.

## Alternatives considered

- **A global responsive sweep / shared CSS layer.** One pass adding a generic
  "responsive table" utility across all pages. Rejected: it touches every page at
  once (maximal desktop-regression risk), and the tables differ enough that a
  generic card would be wrong for most of them. Page-by-page keeps the blast
  radius reviewable.
- **CSS-only table reflow** (`display:block` on `td`/`tr` with `::before` data
  labels below `lg`). No duplicate markup, but it fights the table's own layout,
  breaks with the checkbox/inline-select/action-button cells these tables carry,
  and is hard to make look intentional. Rejected in favor of purpose-built cards.
- **A separate `/m` mobile app or route tree.** Fully divorces mobile from
  desktop. Massive duplication, two code paths to keep in sync, and the shell is
  already responsive. Rejected.
- **Introducing a custom breakpoint for the seam** (e.g. a `tablet` screen).
  Adding to `tailwind.config.ts` `screens` is a global change and risks desktop;
  the default `lg` already matches the shell. Rejected.
- **Making the design mobile-first and re-deriving desktop from it.** The honest
  "right" long-term architecture, but it rewrites desktop wholesale — exactly the
  regression risk constraint §1 forbids. Rejected in favor of additive changes.
</content>
</invoke>
