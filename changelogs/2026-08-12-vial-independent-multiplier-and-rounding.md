# Pricing panel — vials get their own multiplier & rounding

Date: 2026-08-12

Follow-up to the vial-pricing panel work. Previously the **vial** price shared
the box price's multiplier and skipped the "$ rounding" entirely. Now the
**"Apply a price list · multiply · convert"** panel gives the **box (case)** and
the **vial** each their **own** adjustment multiplier and rounding config, in a
clearer side-by-side layout.

## Panel (`CustomerPricingPanel`)

- The transform controls are now two panels:
  - **Box (case) price** — Adjust % + Round.
  - **Vial price** — From (basis) + Adjust % + Round.
- Each panel has an independent **Adjust** (signed multiplier: 0% = unchanged,
  ±%) and an independent **Round** (Off / $5 / $10 / $9-ends, higher/lower).
- **Round is now wired to vials** — pick any rounding for the vial column just
  like the box. Vial rounding defaults to **Off** (a $5/$10 snap is coarse for a
  small vial price); turn it on when you want it.
- **Convert CAD → USD** stays shared (it applies to both box and vial — a
  mixed-currency override makes no sense).
- The `Preview` and `Current prices` tables already show box vs vial side by
  side; they now reflect each column's own multiplier + rounding.

## Apply API (`/api/admin/pricing/apply-transformed`)

- New body fields `vial_multiplier_pct`, `vial_round_to`, `vial_round_dir` drive
  the vial's own transform (defaults: multiplier 100 = unchanged, rounding off).
  The box fields (`multiplier_pct`, `round_to`, `round_dir`) are unchanged and
  the CAD→USD convert is shared. Recorded in the audit payload.
