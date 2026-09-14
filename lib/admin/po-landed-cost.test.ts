import { describe, it, expect } from "vitest";
import { computeLandedCosts, resolveDiscountAmount, round2, round4 } from "./po-landed-cost";

describe("computeLandedCosts", () => {
  it("allocates shipping across lines by value (pricier line absorbs more)", () => {
    const landed = computeLandedCosts({
      lines: [
        { qty: 10, unit_price: 30 }, // $300, 75% of order
        { qty: 10, unit_price: 10 }, // $100, 25% of order
      ],
      shippingFee: 40,
      discountAmount: 0,
    });
    expect(landed[0].shippingShare).toBeCloseTo(30);
    expect(landed[1].shippingShare).toBeCloseTo(10);
    expect(landed[0].landedUnitCost).toBeCloseTo(33); // (300 + 30) / 10
    expect(landed[1].landedUnitCost).toBeCloseTo(11); // (100 + 10) / 10
  });

  it("folds in both shipping and discount", () => {
    const landed = computeLandedCosts({
      lines: [
        { qty: 10, unit_price: 20 }, // $200, 50%
        { qty: 5, unit_price: 40 }, // $200, 50%
      ],
      shippingFee: 30,
      discountAmount: 40,
    });
    // Each line: 200 + 15 shipping − 20 discount = 195
    expect(landed[0].landedLineTotal).toBeCloseTo(195);
    expect(landed[1].landedLineTotal).toBeCloseTo(195);
    expect(landed[0].landedUnitCost).toBeCloseTo(19.5); // 195 / 10
    expect(landed[1].landedUnitCost).toBeCloseTo(39); // 195 / 5
  });

  it("reconciles: landed line totals sum to subtotal + shipping − discount", () => {
    const lines = [
      { qty: 3, unit_price: 12.5 },
      { qty: 7, unit_price: 4.2 },
      { qty: 1, unit_price: 99 },
    ];
    const shippingFee = 17.77;
    const discountAmount = 9.13;
    const landed = computeLandedCosts({ lines, shippingFee, discountAmount });
    const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
    const sumLanded = landed.reduce((s, l) => s + l.landedLineTotal, 0);
    expect(sumLanded).toBeCloseTo(subtotal + shippingFee - discountAmount, 6);
  });

  it("falls back to per-quantity allocation when the order has zero value", () => {
    const landed = computeLandedCosts({
      lines: [
        { qty: 3, unit_price: 0 },
        { qty: 1, unit_price: 0 },
      ],
      shippingFee: 8,
      discountAmount: 0,
    });
    // Split by qty: 3/4 and 1/4 of $8.
    expect(landed[0].shippingShare).toBeCloseTo(6);
    expect(landed[1].shippingShare).toBeCloseTo(2);
    expect(landed[0].landedUnitCost).toBeCloseTo(2); // 6 / 3
    expect(landed[1].landedUnitCost).toBeCloseTo(2); // 2 / 1
  });

  it("is a no-op when there is no shipping or discount", () => {
    const landed = computeLandedCosts({
      lines: [{ qty: 2, unit_price: 15 }],
      shippingFee: 0,
      discountAmount: 0,
    });
    expect(landed[0].landedUnitCost).toBeCloseTo(15);
    expect(landed[0].landedLineTotal).toBeCloseTo(30);
  });

  it("handles an empty order without throwing", () => {
    expect(computeLandedCosts({ lines: [], shippingFee: 10, discountAmount: 5 })).toEqual([]);
  });
});

describe("resolveDiscountAmount", () => {
  it("returns the flat amount for a fixed discount", () => {
    expect(resolveDiscountAmount("fixed", 25, 400)).toBe(25);
  });
  it("returns a percentage of subtotal for a percentage discount", () => {
    expect(resolveDiscountAmount("percentage", 10, 400)).toBeCloseTo(40);
  });
  it("never returns a negative amount", () => {
    expect(resolveDiscountAmount("fixed", -5, 400)).toBe(0);
  });
});

describe("rounding helpers", () => {
  it("round2 keeps two decimals", () => {
    expect(round2(19.499)).toBe(19.5);
    expect(round2(19.494)).toBe(19.49);
  });
  it("round4 keeps four decimals", () => {
    expect(round4(0.123456)).toBe(0.1235);
  });
});
