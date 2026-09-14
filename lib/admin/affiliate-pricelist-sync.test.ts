import { describe, it, expect } from "vitest";
import { sellableAffiliateRows } from "./affiliate-pricelist-sync";

describe("sellableAffiliateRows", () => {
  it("keeps positive, visible box prices", () => {
    expect(
      sellableAffiliateRows([
        { product_id: "a", override_price: 100, is_visible: true },
        { product_id: "b", override_price: 42.5 },
      ]),
    ).toEqual([
      { product_id: "a", override_price: 100 },
      { product_id: "b", override_price: 42.5 },
    ]);
  });

  it("drops $0 'hidden' markers and explicitly hidden rows", () => {
    expect(
      sellableAffiliateRows([
        { product_id: "zero", override_price: 0 },
        { product_id: "hidden", override_price: 80, is_visible: false },
        { product_id: "ok", override_price: 25, is_visible: true },
      ]),
    ).toEqual([{ product_id: "ok", override_price: 25 }]);
  });

  it("drops visibility-only / vial-only rows that carry no box price", () => {
    expect(
      sellableAffiliateRows([
        { product_id: "vis-only", override_price: null, is_visible: false },
        { product_id: "vial-only", override_price: null, is_visible: true },
      ]),
    ).toEqual([]);
  });

  it("coerces numeric-string prices from the database", () => {
    expect(
      sellableAffiliateRows([
        { product_id: "a", override_price: "30" as unknown as number },
      ]),
    ).toEqual([{ product_id: "a", override_price: 30 }]);
  });
});
