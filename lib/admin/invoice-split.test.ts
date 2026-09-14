import { describe, it, expect } from "vitest";
import { computeStockSplit, type SplitLine } from "./invoice-split";

const line = (over: Partial<SplitLine>): SplitLine => ({
  product_id: "p1",
  description: "Widget",
  qty: 1,
  unit_price: 10,
  discount_pct: 0,
  line_total: 10,
  price_type: "box",
  vials_per_box: 10,
  ...over,
});

describe("computeStockSplit box/vial conversion", () => {
  it("allocates box lines against vial stock in whole boxes", () => {
    // 53 vials on hand, 10 vials/box -> 5 whole boxes available; ordering 6.
    const { inStock, backordered, backorderItems } = computeStockSplit(
      [line({ qty: 6 })],
      new Map([["p1", 53]]),
    );
    expect(inStock[0].qty).toBe(5);
    expect(backordered[0].qty).toBe(1);
    expect(backorderItems[0]).toMatchObject({
      qty_ordered: 6,
      qty_available: 5,
      qty_backordered: 1,
    });
  });

  it("keeps a box line fully in stock when enough whole boxes exist", () => {
    const { inStock, backordered } = computeStockSplit(
      [line({ qty: 2 })], // 2 boxes = 20 vials, 50 on hand
      new Map([["p1", 50]]),
    );
    expect(inStock[0].qty).toBe(2);
    expect(backordered).toHaveLength(0);
  });

  it("treats vial lines one-for-one against vial stock", () => {
    const { inStock, backordered } = computeStockSplit(
      [line({ price_type: "vial", qty: 60 })],
      new Map([["p1", 50]]),
    );
    expect(inStock[0].qty).toBe(50);
    expect(backordered[0].qty).toBe(10);
  });

  it("lets a later vial line consume the vials a box line left behind", () => {
    // 53 vials: box line takes 3 whole boxes (30 vials), leaving 23 for vials.
    const [boxLine, vialLine] = [
      line({ qty: 3 }),
      line({ price_type: "vial", qty: 30, description: "loose" }),
    ];
    const { inStock, backordered } = computeStockSplit(
      [boxLine, vialLine],
      new Map([["p1", 53]]),
    );
    expect(inStock.find((l) => l.description === "Widget")?.qty).toBe(3);
    // 53 - 30 = 23 vials remain; the 30-vial line ships 23, backorders 7.
    expect(inStock.find((l) => l.description === "loose")?.qty).toBe(23);
    expect(backordered.find((l) => l.description === "loose")?.qty).toBe(7);
  });

  it("defaults missing vials_per_box to 10", () => {
    const { inStock } = computeStockSplit(
      [line({ qty: 1, vials_per_box: undefined })], // 1 box -> 10 vials
      new Map([["p1", 25]]), // 2 whole boxes available
    );
    expect(inStock[0].qty).toBe(1);
  });

  it("treats lines without a product as always in stock", () => {
    const { inStock, backordered } = computeStockSplit(
      [line({ product_id: null, qty: 99 })],
      new Map(),
    );
    expect(inStock[0].qty).toBe(99);
    expect(backordered).toHaveLength(0);
  });
});
