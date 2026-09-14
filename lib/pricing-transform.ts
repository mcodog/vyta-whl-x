/**
 * Shared price-transform helpers — the multiplier + CAD→USD convert + rounding
 * tool.
 *
 * A source "pricing record" (a saved price list, or another customer's current
 * custom prices) can be re-priced three ways before it is applied to a customer:
 *
 *   1. A percentage multiplier — a preset toggle (25 / 50 / 75 / 100 / 150 /
 *      200 / 300). 100 leaves the price unchanged; 150 is +50%; 25 is a quarter
 *      of the price.
 *   2. An optional CAD→USD conversion — only offered when the source is priced
 *      in CAD. It divides by an editable `cadPerUsd` rate (how many CAD one USD
 *      buys, e.g. 1.45), so CAD 145 → USD 100. This is a deliberately separate,
 *      per-use rate from the site-wide FX rate in Site Settings
 *      (`usd_exchange_rate`, a CAD→USD multiplier) — the tool lets an operator
 *      price a one-off USD list without touching the global rate.
 *   3. An optional rounding pass — snap each final price to a tidy number:
 *      the nearest $5 or $10, or a "charm" price ending in 9 (…9, 19, 29),
 *      rounded either up (higher) or down (lower). Applied last, after the
 *      multiplier and conversion, so it works on the number a buyer sees.
 *
 * The client preview and the server apply route both import these helpers so the
 * numbers a user previews are exactly the numbers that get written.
 */

import { round2 } from "@/lib/pricing";

/** Percentage multiplier presets shown as toggle buttons. 100 = unchanged. */
export const MULTIPLIER_PRESETS = [25, 50, 75, 100, 150, 200, 300] as const;

/**
 * Signed *adjustment* presets for the multiplier control, shown as toggle
 * buttons. These are what the operator sees: `0` = unchanged, a negative value
 * deducts (`-25` = 25% off = ×0.75) and a positive value marks up (`+50` =
 * ×1.5). They map onto the scale multiplier `transformPrice` expects via
 * `adjustToScale` (0 → 100, −25 → 75, +50 → 150), so the underlying math and the
 * apply API stay in scale terms.
 */
export const MULTIPLIER_ADJUST_PRESETS = [-75, -50, -25, 0, 25, 50, 100, 200] as const;

/** Convert a signed adjustment (%) to the scale multiplier (100 = unchanged).
 *  −25 → 75, 0 → 100, +50 → 150. Clamped to ≥ 0 so a price can't go negative. */
export function adjustToScale(adjustPct: number): number {
  const n = Number(adjustPct);
  return Math.max(0, 100 + (Number.isFinite(n) ? n : 0));
}

/** Convert a scale multiplier (100 = unchanged) back to a signed adjustment (%).
 *  75 → −25, 100 → 0, 150 → +50. Used to light up the matching preset button. */
export function scaleToAdjust(scalePct: number): number {
  const n = Number(scalePct);
  return (Number.isFinite(n) ? n : 100) - 100;
}

/** Default CAD-per-USD conversion rate (1 USD ≈ 1.45 CAD). Editable per use. */
export const DEFAULT_CAD_PER_USD = 1.45;

export type ResultCurrency = "CAD" | "USD";

/**
 * Rounding targets offered as toggles. `0` = off (exact prices); `5`/`10` snap
 * to the nearest multiple; `9` is charm pricing (values ending in 9).
 */
export const ROUND_TO_OPTIONS = [0, 5, 10, 9] as const;
export type RoundTo = (typeof ROUND_TO_OPTIONS)[number];

/** Round direction: `up` snaps to the higher target, `down` to the lower. */
export type RoundDir = "up" | "down";

/** Rounding defaults: nearest $10, rounded up (higher). */
export const DEFAULT_ROUND_TO: RoundTo = 10;
export const DEFAULT_ROUND_DIR: RoundDir = "up";

export interface TransformOptions {
  /** Percentage multiplier, e.g. 100 = unchanged, 150 = +50%, 25 = quarter. */
  multiplierPct: number;
  /** Convert CAD → USD. Ignored unless the source currency is CAD. */
  convertToUsd: boolean;
  /** CAD per 1 USD (the divisor for CAD → USD). */
  cadPerUsd: number;
  /** Rounding target ($5 / $10 / $9); 0 or omitted = no rounding. */
  roundTo?: RoundTo;
  /** Round direction; defaults to 'up' (higher). */
  roundDir?: RoundDir;
}

/** Clamp a multiplier to a sane positive percentage (falls back to 100). */
export function normalizeMultiplier(pct: unknown): number {
  const n = Number(pct);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/** Clamp a CAD-per-USD rate to a positive number (falls back to the default). */
export function normalizeRate(rate: unknown): number {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAD_PER_USD;
}

/** Coerce a rounding target to a supported option (unknown/none → 0 = off). */
export function normalizeRoundTo(v: unknown): RoundTo {
  const n = Number(v);
  return (ROUND_TO_OPTIONS as readonly number[]).includes(n) ? (n as RoundTo) : 0;
}

/** Coerce a round direction (anything but 'down' → 'up'). */
export function normalizeRoundDir(v: unknown): RoundDir {
  return v === "down" ? "down" : "up";
}

/**
 * Snap a price to a rounding target in the given direction.
 *   - 5 / 10 → the nearest multiple of $5 or $10.
 *   - 9 → the nearest "charm" price ending in 9 (…9, 19, 29 — i.e. 10k − 1).
 * `up` rounds to the next-higher target, `down` to the next-lower. Rounding off
 * (0) or a non-positive input returns the value untouched (to cents). A positive
 * price never floors below the smallest positive target, so it can't drop to $0.
 */
export function roundPrice(value: number, roundTo: RoundTo, dir: RoundDir): number {
  const v = Number(value) || 0;
  if (!roundTo || v <= 0) return round2(v);

  if (roundTo === 9) {
    // Charm prices sit at (multiple of 10) − 1; shift by 1, snap to the 10-grid,
    // shift back so the result ends in 9.
    const snapped =
      dir === "up"
        ? Math.ceil((v + 1) / 10) * 10 - 1
        : Math.floor((v + 1) / 10) * 10 - 1;
    // The smallest positive value ending in 9 is $9 — don't undercut it.
    return snapped < 9 ? 9 : snapped;
  }

  const step = roundTo; // 5 or 10
  const snapped =
    dir === "up" ? Math.ceil(v / step) * step : Math.floor(v / step) * step;
  // Rounding a sub-step price down would hit $0; keep one step so a positive
  // price never floors to free.
  return snapped <= 0 ? step : snapped;
}

/**
 * Apply the multiplier, optional CAD→USD conversion, and optional rounding to
 * one base price. Rounds to cents and never returns a negative value.
 */
export function transformPrice(
  base: number,
  sourceCurrency: ResultCurrency,
  opts: TransformOptions,
): number {
  const b = Number(base) || 0;
  const mult = normalizeMultiplier(opts.multiplierPct) / 100;
  let out = b * mult;
  // Conversion only makes sense (and is only offered) for CAD sources.
  if (opts.convertToUsd && sourceCurrency === "CAD") {
    out = out / normalizeRate(opts.cadPerUsd);
  }
  // Rounding runs last, on the final buyer-facing number.
  out = roundPrice(out, normalizeRoundTo(opts.roundTo), normalizeRoundDir(opts.roundDir));
  return Math.max(0, round2(out));
}

/** The currency the transformed prices end up in. */
export function resultCurrency(
  sourceCurrency: ResultCurrency,
  convertToUsd: boolean,
): ResultCurrency {
  return convertToUsd && sourceCurrency === "CAD" ? "USD" : sourceCurrency;
}

/** Whether the transform actually changes the source numbers at all. */
export function isTransformed(opts: TransformOptions, sourceCurrency: ResultCurrency): boolean {
  return (
    normalizeMultiplier(opts.multiplierPct) !== 100 ||
    (opts.convertToUsd && sourceCurrency === "CAD") ||
    normalizeRoundTo(opts.roundTo) !== 0
  );
}

/**
 * How the per-vial price is derived when a price list / customer is applied.
 * A price list only stores box (pack) prices, so the single-vial override has
 * to come from one of these bases (each then run through the same multiplier /
 * convert / round as the box):
 *
 *   - `catalog_vial` — the product's own single-vial price (`vial_price`, else
 *      box ÷ 10). Preserves any premium single-vial pricing. The default.
 *   - `box_div_10`   — the *source* box price ÷ 10. Keeps the vial proportional
 *      to the box discount (a pure per-unit model).
 *   - `retail`       — the catalog retail (box) price, used as the vial basis.
 *   - `source_vial`  — the source customer's own per-vial override (only when
 *      copying from a customer; falls back to `catalog_vial` when absent).
 */
export const VIAL_BASES = ["catalog_vial", "box_div_10", "retail", "source_vial"] as const;
export type VialBasis = (typeof VIAL_BASES)[number];

/** Coerce an incoming value to a supported vial basis (default `catalog_vial`). */
export function normalizeVialBasis(v: unknown): VialBasis {
  return (VIAL_BASES as readonly string[]).includes(v as string)
    ? (v as VialBasis)
    : "catalog_vial";
}

/** The catalog single-vial price: explicit `vial_price` when set, else box ÷ 10. */
export function catalogVialPrice(boxPrice: number, vialPrice: number | null | undefined): number {
  const v = vialPrice != null ? Number(vialPrice) : NaN;
  if (Number.isFinite(v) && v > 0) return v;
  return (Number(boxPrice) || 0) / 10;
}

/**
 * The pre-transform vial price for a product under the chosen basis, in the
 * source currency. Returns `null` when the basis has no value for the product
 * (e.g. `source_vial` with no source vial and no catalog fallback available).
 * Callers run the result through `transformPrice` for the multiplier / convert /
 * round pass, exactly like the box price.
 */
export function vialBasisValue(
  basis: VialBasis,
  args: {
    /** The source box price for this product (list item / source override). */
    sourceBox: number | null;
    /** The source customer's own per-vial override, when copying a customer. */
    sourceVial?: number | null;
    /** The catalog box price (products.price). */
    catalogBox: number;
    /** The catalog single-vial price (products.vial_price). */
    catalogVial?: number | null;
  },
): number | null {
  const catalog = catalogVialPrice(args.catalogBox, args.catalogVial);
  switch (basis) {
    case "box_div_10":
      return args.sourceBox != null ? (Number(args.sourceBox) || 0) / 10 : null;
    case "retail":
      return Number(args.catalogBox) || 0;
    case "source_vial":
      return args.sourceVial != null ? Number(args.sourceVial) : catalog;
    case "catalog_vial":
    default:
      return catalog;
  }
}
