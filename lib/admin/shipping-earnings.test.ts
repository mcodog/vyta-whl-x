import { describe, it, expect } from "vitest";
import { computeShippingEarnings, paidRatio } from "./shipping-earnings";

const inv = (
  shipping_cost: number,
  total: number,
  paid: number[],
  currency: string | null = "CAD",
  issue_date: string | null = "2026-03-14",
) => ({
  issue_date,
  total,
  shipping_cost,
  currency,
  payments: paid.map((amount) => ({ amount })),
});

describe("paidRatio", () => {
  it("clamps to 0–1 even when payments exceed the total", () => {
    expect(paidRatio(100, 150)).toBe(1);
    expect(paidRatio(100, 25)).toBe(0.25);
    expect(paidRatio(100, 0)).toBe(0);
  });

  it("treats a zero-total invoice with a payment as fully paid", () => {
    expect(paidRatio(0, 10)).toBe(1);
    expect(paidRatio(0, 0)).toBe(0);
  });
});

describe("computeShippingEarnings", () => {
  it("sums billed shipping and pro-rates the collected share", () => {
    const out = computeShippingEarnings([
      inv(20, 100, [100]), // fully paid → all $20 collected
      inv(30, 200, [50]), // 25% paid → $7.50 collected
      inv(10, 100, []), // unpaid → nothing collected
    ]);
    expect(out.charged).toBe(60);
    expect(out.collected).toBe(27.5);
    expect(out.uncollected).toBe(32.5);
    expect(out.invoice_count).toBe(3);
    expect(out.avg_per_invoice).toBe(20);
  });

  it("ignores invoices with no shipping charge", () => {
    const out = computeShippingEarnings([inv(0, 100, [100]), inv(15, 100, [100])]);
    expect(out.invoice_count).toBe(1);
    expect(out.charged).toBe(15);
  });

  it("keeps CAD and USD apart and never converts", () => {
    const out = computeShippingEarnings([
      inv(20, 100, [100], "CAD"),
      inv(40, 200, [100], "USD"),
      inv(10, 100, [0], null), // legacy null currency counts as CAD
    ]);
    expect(out.by_currency.CAD).toEqual({
      charged: 30,
      collected: 20,
      uncollected: 10,
      invoice_count: 2,
    });
    expect(out.by_currency.USD).toEqual({
      charged: 40,
      collected: 20,
      uncollected: 20,
      invoice_count: 1,
    });
    expect(out.charged).toBe(70); // nominal, both currencies combined
  });

  it("buckets by issue month, oldest first, skipping undated invoices", () => {
    const out = computeShippingEarnings([
      inv(10, 100, [100], "CAD", "2026-02-02"),
      inv(5, 100, [50], "CAD", "2026-01-31"),
      inv(7, 100, [100], "CAD", "2026-02-27"),
      inv(9, 100, [100], "CAD", null),
    ]);
    expect(out.monthly).toEqual([
      { month: "2026-01", charged: 5, collected: 2.5 },
      { month: "2026-02", charged: 17, collected: 17 },
    ]);
  });

  it("reports shipping as a share of invoiced revenue", () => {
    const out = computeShippingEarnings([inv(25, 500, [500])], 500);
    expect(out.share_of_invoiced).toBe(5);
  });

  it("returns zeroes for an empty range", () => {
    const out = computeShippingEarnings([], 0);
    expect(out).toMatchObject({
      charged: 0,
      collected: 0,
      uncollected: 0,
      invoice_count: 0,
      avg_per_invoice: 0,
      share_of_invoiced: 0,
      monthly: [],
    });
  });

  it("tolerates numeric strings and missing payment arrays from PostgREST", () => {
    const out = computeShippingEarnings([
      { issue_date: "2026-05-01", total: "100.00", shipping_cost: "12.50", currency: "CAD", payments: null },
      { issue_date: "2026-05-02", total: "50.00", shipping_cost: "5.00", currency: "CAD", payments: [{ amount: "50.00" }] },
    ]);
    expect(out.charged).toBe(17.5);
    expect(out.collected).toBe(5);
  });
});
