import { describe, it, expect } from "vitest";
import {
  casePriceFromVial,
  fallbackVialPrice,
  formatMoney,
  formatMoneyNarrow,
  vialPriceFor,
  vialsPerBoxOf,
} from "./pricing";

describe("vialsPerBoxOf", () => {
  it("falls back to 10 for anything that isn't a positive number", () => {
    expect(vialsPerBoxOf(3)).toBe(3);
    expect(vialsPerBoxOf(0)).toBe(10);
    expect(vialsPerBoxOf(-2)).toBe(10);
    expect(vialsPerBoxOf(null)).toBe(10);
    expect(vialsPerBoxOf(undefined)).toBe(10);
    expect(vialsPerBoxOf("abc")).toBe(10);
  });
});

describe("case ⇄ vial conversion", () => {
  it("has no pack discount in either direction", () => {
    expect(casePriceFromVial(12.5, 10)).toBe(125);
    expect(fallbackVialPrice(125, 10)).toBe(12.5);
  });

  it("rounds to cents, so an uneven split can move the partner by a cent", () => {
    // $100 over 3 vials is $33.333…; the grid shows the rounded number and
    // converting it back lands a cent low. Documented, not a bug.
    expect(fallbackVialPrice(100, 3)).toBe(33.33);
    expect(casePriceFromVial(33.33, 3)).toBe(99.99);
  });

  it("uses the vials-per-box fallback on both sides", () => {
    expect(casePriceFromVial(5, null)).toBe(50);
    expect(fallbackVialPrice(50, 0)).toBe(5);
  });
});

describe("vialPriceFor", () => {
  it("derives from the case price when no override is stored", () => {
    expect(vialPriceFor({ price: 120, vial_price: null, vials_per_box: 10 })).toBe(12);
    expect(vialPriceFor({ price: 100, vial_price: null })).toBe(10);
  });

  it("prefers an explicit override", () => {
    expect(vialPriceFor({ price: 120, vial_price: 15, vials_per_box: 10 })).toBe(15);
  });

  it("treats a stored 0 alongside a real price as 'not set'", () => {
    expect(vialPriceFor({ price: 120, vial_price: 0, vials_per_box: 10 })).toBe(12);
  });

  it("still resolves a genuinely free product to 0", () => {
    expect(vialPriceFor({ price: 0, vial_price: null, vials_per_box: 10 })).toBe(0);
  });
});

describe("money formatting", () => {
  it("formatMoneyNarrow drops the currency code for dense numeric grids", () => {
    expect(formatMoneyNarrow(1234.5, "CAD")).toBe("$1,234.50");
    expect(formatMoneyNarrow(0, "CAD")).toBe("$0.00");
  });

  it("leaves the labelled formatMoney alone", () => {
    expect(formatMoney(12, "CAD")).toBe("$12.00 CAD");
  });
});
