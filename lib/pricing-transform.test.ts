import { describe, it, expect } from "vitest";
import {
  roundPrice,
  transformPrice,
  isTransformed,
  normalizeRoundTo,
  normalizeRoundDir,
  adjustToScale,
  scaleToAdjust,
  catalogVialPrice,
  vialBasisValue,
  normalizeVialBasis,
  DEFAULT_ROUND_TO,
  DEFAULT_ROUND_DIR,
  type TransformOptions,
} from "./pricing-transform";

describe("roundPrice", () => {
  it("returns the value untouched when rounding is off", () => {
    expect(roundPrice(47.31, 0, "up")).toBe(47.31);
    expect(roundPrice(47.31, 0, "down")).toBe(47.31);
  });

  it("rounds to the nearest $5 up and down", () => {
    expect(roundPrice(47, 5, "up")).toBe(50);
    expect(roundPrice(47, 5, "down")).toBe(45);
    expect(roundPrice(45, 5, "up")).toBe(45); // already on the grid
    expect(roundPrice(45, 5, "down")).toBe(45);
  });

  it("rounds to the nearest $10 up and down", () => {
    expect(roundPrice(47, 10, "up")).toBe(50);
    expect(roundPrice(47, 10, "down")).toBe(40);
    expect(roundPrice(140, 10, "up")).toBe(140);
    expect(roundPrice(141, 10, "down")).toBe(140);
  });

  it("snaps to a charm price ending in 9", () => {
    expect(roundPrice(47, 9, "up")).toBe(49);
    expect(roundPrice(47, 9, "down")).toBe(39);
    expect(roundPrice(49, 9, "up")).toBe(49); // already ends in 9
    expect(roundPrice(49, 9, "down")).toBe(49);
    expect(roundPrice(50, 9, "up")).toBe(59);
    expect(roundPrice(50, 9, "down")).toBe(49);
    expect(roundPrice(140, 9, "up")).toBe(149);
    expect(roundPrice(140, 9, "down")).toBe(139);
  });

  it("never floors a positive price to $0 / below the smallest target", () => {
    expect(roundPrice(3, 10, "down")).toBe(10); // would floor to 0
    expect(roundPrice(3, 5, "down")).toBe(5); // would floor to 0
    expect(roundPrice(3, 9, "down")).toBe(9); // no positive …9 below 9
  });

  it("leaves non-positive inputs untouched (to cents)", () => {
    expect(roundPrice(0, 10, "up")).toBe(0);
    expect(roundPrice(-5, 10, "up")).toBe(-5);
  });
});

describe("normalizeRoundTo / normalizeRoundDir", () => {
  it("accepts supported targets and rejects the rest", () => {
    expect(normalizeRoundTo(5)).toBe(5);
    expect(normalizeRoundTo(10)).toBe(10);
    expect(normalizeRoundTo(9)).toBe(9);
    expect(normalizeRoundTo(0)).toBe(0);
    expect(normalizeRoundTo(7)).toBe(0); // unsupported → off
    expect(normalizeRoundTo(undefined)).toBe(0);
    expect(normalizeRoundTo("10")).toBe(10);
  });

  it("defaults direction to 'up' for anything but 'down'", () => {
    expect(normalizeRoundDir("down")).toBe("down");
    expect(normalizeRoundDir("up")).toBe("up");
    expect(normalizeRoundDir(undefined)).toBe("up");
    expect(normalizeRoundDir("sideways")).toBe("up");
  });
});

describe("transformPrice with rounding", () => {
  const opts = (over: Partial<TransformOptions> = {}): TransformOptions => ({
    multiplierPct: 100,
    convertToUsd: false,
    cadPerUsd: 1.45,
    ...over,
  });

  it("applies the multiplier before rounding", () => {
    // 100 × 1.5 = 150 → already on the $10 grid.
    expect(transformPrice(100, "CAD", opts({ multiplierPct: 150, roundTo: 10, roundDir: "up" }))).toBe(150);
    // 95 × 1.5 = 142.5 → round up to 150, down to 140.
    expect(transformPrice(95, "CAD", opts({ multiplierPct: 150, roundTo: 10, roundDir: "up" }))).toBe(150);
    expect(transformPrice(95, "CAD", opts({ multiplierPct: 150, roundTo: 10, roundDir: "down" }))).toBe(140);
  });

  it("rounds after the CAD→USD conversion", () => {
    // 145 CAD ÷ 1.45 = 100 USD → charm price 99 rounding down.
    expect(
      transformPrice(145, "CAD", opts({ convertToUsd: true, cadPerUsd: 1.45, roundTo: 9, roundDir: "down" })),
    ).toBe(99);
  });

  it("is a no-op transform when rounding is off and multiplier is 100", () => {
    expect(transformPrice(47.31, "CAD", opts({ roundTo: 0 }))).toBe(47.31);
  });
});

describe("isTransformed", () => {
  const base: TransformOptions = { multiplierPct: 100, convertToUsd: false, cadPerUsd: 1.45 };

  it("is false for a plain ×100 no-convert no-round apply", () => {
    expect(isTransformed({ ...base, roundTo: 0 }, "CAD")).toBe(false);
  });

  it("is true once any rounding is on", () => {
    expect(isTransformed({ ...base, roundTo: 10 }, "CAD")).toBe(true);
    expect(isTransformed({ ...base, roundTo: 9, roundDir: "down" }, "CAD")).toBe(true);
  });

  it("is true for a non-100 multiplier or an active CAD→USD convert", () => {
    expect(isTransformed({ ...base, multiplierPct: 150 }, "CAD")).toBe(true);
    expect(isTransformed({ ...base, convertToUsd: true }, "CAD")).toBe(true);
    // Convert on a USD source is a no-op.
    expect(isTransformed({ ...base, convertToUsd: true }, "USD")).toBe(false);
  });
});

describe("defaults", () => {
  it("default rounding is the nearest $10, higher", () => {
    expect(DEFAULT_ROUND_TO).toBe(10);
    expect(DEFAULT_ROUND_DIR).toBe("up");
  });
});

describe("adjustToScale / scaleToAdjust", () => {
  it("maps a signed adjustment onto a scale multiplier (100 = unchanged)", () => {
    expect(adjustToScale(0)).toBe(100);
    expect(adjustToScale(-25)).toBe(75);
    expect(adjustToScale(-75)).toBe(25);
    expect(adjustToScale(50)).toBe(150);
    expect(adjustToScale(200)).toBe(300);
  });

  it("clamps to zero so a price can't go negative, and tolerates junk", () => {
    expect(adjustToScale(-150)).toBe(0);
    expect(adjustToScale(NaN as unknown as number)).toBe(100);
  });

  it("round-trips back to the adjustment", () => {
    expect(scaleToAdjust(100)).toBe(0);
    expect(scaleToAdjust(75)).toBe(-25);
    expect(scaleToAdjust(150)).toBe(50);
    expect(scaleToAdjust(NaN as unknown as number)).toBe(0);
  });
});

describe("catalogVialPrice", () => {
  it("uses the explicit vial price when set and positive", () => {
    expect(catalogVialPrice(100, 15)).toBe(15);
  });

  it("falls back to box ÷ 10 when the vial price is missing or non-positive", () => {
    expect(catalogVialPrice(100, null)).toBe(10);
    expect(catalogVialPrice(100, 0)).toBe(10);
    expect(catalogVialPrice(100, undefined)).toBe(10);
  });
});

describe("normalizeVialBasis", () => {
  it("accepts supported bases and defaults the rest to catalog_vial", () => {
    expect(normalizeVialBasis("box_div_10")).toBe("box_div_10");
    expect(normalizeVialBasis("retail")).toBe("retail");
    expect(normalizeVialBasis("source_vial")).toBe("source_vial");
    expect(normalizeVialBasis("catalog_vial")).toBe("catalog_vial");
    expect(normalizeVialBasis("nonsense")).toBe("catalog_vial");
    expect(normalizeVialBasis(undefined)).toBe("catalog_vial");
  });
});

describe("vialBasisValue", () => {
  const args = { sourceBox: 80, sourceVial: 12, catalogBox: 100, catalogVial: 15 };

  it("catalog_vial uses the product's own vial price (else box ÷ 10)", () => {
    expect(vialBasisValue("catalog_vial", args)).toBe(15);
    expect(vialBasisValue("catalog_vial", { ...args, catalogVial: null })).toBe(10);
  });

  it("box_div_10 uses a tenth of the source box price", () => {
    expect(vialBasisValue("box_div_10", args)).toBe(8);
    expect(vialBasisValue("box_div_10", { ...args, sourceBox: null })).toBeNull();
  });

  it("retail uses the catalog box price", () => {
    expect(vialBasisValue("retail", args)).toBe(100);
  });

  it("source_vial uses the source's vial, falling back to the catalog vial", () => {
    expect(vialBasisValue("source_vial", args)).toBe(12);
    expect(vialBasisValue("source_vial", { ...args, sourceVial: null })).toBe(15);
  });
});
