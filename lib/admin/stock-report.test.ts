import { describe, it, expect } from "vitest";
import {
  stockReportPrintHtml,
  toStockReportAudience,
  CUSTOMER_STOCK_REPORT_COLUMN_KEYS,
  STOCK_REPORT_COLUMN_KEYS,
  type StockReportData,
} from "./stock-report";

/**
 * Two products, one of them short of its minimum, so every purchasing figure
 * (Min Quantity / On Order / Need To Order) has a non-zero value to leak.
 */
const data = (): StockReportData => ({
  rows: [
    {
      id: "p1",
      name: "BPC-157",
      slug: "bpc-157",
      sku: "BPC-5",
      strength: "5mg",
      category: "Healing",
      active: true,
      stock: 43,
      vialsPerBox: 10,
      minQty: 100,
      onOrder: 30,
      needToOrder: 27,
    },
    {
      id: "p2",
      name: "TB-500",
      slug: "tb-500",
      sku: "TB-5",
      strength: "5mg",
      category: "Healing",
      active: true,
      stock: 500,
      vialsPerBox: 10,
      minQty: 100,
      onOrder: 0,
      needToOrder: 0,
    },
  ],
  totals: {
    products: 2,
    active: 2,
    units: 543,
    onOrder: 30,
    needToOrder: 27,
    needCount: 1,
    outOfStock: 0,
    lowStock: 1,
  },
  contributingPos: [{ poNumber: "PO-1001", status: "pending", units: 30 }],
  filters: [],
});

const internal = () => stockReportPrintHtml(data(), { autoPrint: false });
const customer = () =>
  stockReportPrintHtml(data(), { autoPrint: false, audience: "customer" });

describe("toStockReportAudience", () => {
  it("only ever opts in to the customer copy explicitly", () => {
    expect(toStockReportAudience("customer")).toBe("customer");
    expect(toStockReportAudience("internal")).toBe("internal");
    expect(toStockReportAudience("CUSTOMER")).toBe("internal");
    expect(toStockReportAudience(undefined)).toBe("internal");
    expect(toStockReportAudience(null)).toBe("internal");
  });
});

describe("the internal Stock Report", () => {
  it("still shows every purchasing column, card and note", () => {
    const html = internal();
    expect(html).toContain("Min Quantity");
    expect(html).toContain("On Order");
    expect(html).toContain("Need To Order");
    // The per-row figures and the summary cards.
    expect(html).toContain("30 units");
    expect(html).toContain("27 units");
    // The "how On Order is calculated" note names its purchase orders.
    expect(html).toContain("PO-1001");
  });
});

describe("the Customer Stock Report", () => {
  it("drops Min Quantity, On Order and Need To Order", () => {
    const html = customer();
    expect(html).not.toContain("Min Quantity");
    expect(html).not.toContain("On Order");
    expect(html).not.toContain("Need To Order");
  });

  it("drops the purchase orders behind On Order", () => {
    expect(customer()).not.toContain("PO-1001");
  });

  it("keeps what the customer is actually being told: what's on the shelf", () => {
    const html = customer();
    expect(html).toContain("BPC-157");
    expect(html).toContain("TB-500");
    expect(html).toContain("SKU");
    expect(html).toContain("Stock (boxes)");
    expect(html).toContain("Stock On Hand");
    expect(html).toContain("Stock levels (2)");
  });

  it("cannot be talked back into a purchasing column by the cols param", () => {
    // A caller asking for every column still gets only the customer-safe ones:
    // the audience filter is an intersection, never a union.
    const html = stockReportPrintHtml(data(), {
      autoPrint: false,
      audience: "customer",
      columns: [...STOCK_REPORT_COLUMN_KEYS],
    });
    expect(html).not.toContain("Min Quantity");
    expect(html).not.toContain("Need To Order");
    expect(html).toContain("BPC-157");
  });

  it("still honours a column the operator switched off", () => {
    const html = stockReportPrintHtml(data(), {
      autoPrint: false,
      audience: "customer",
      columns: ["sku", "description", "stock"],
    });
    expect(html).not.toContain("Strength");
    expect(html).toContain("BPC-157");
  });

  it("allows exactly the four availability columns", () => {
    expect(CUSTOMER_STOCK_REPORT_COLUMN_KEYS).toEqual([
      "sku",
      "description",
      "strength",
      "stock",
    ]);
    // Every allowed column is a real report column.
    for (const key of CUSTOMER_STOCK_REPORT_COLUMN_KEYS) {
      expect(STOCK_REPORT_COLUMN_KEYS).toContain(key);
    }
  });
});
