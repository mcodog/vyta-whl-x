import { describe, it, expect } from "vitest";
import {
  MAX_SALES_PEOPLE,
  assignmentsFromBody,
  commissionAmountFor,
  normalizeAssignments,
  primaryInvoiceColumns,
  resolveAssignments,
  salesPersonLabel,
} from "./sales-attribution";

const seat = (id: string, rate: number) => ({ sales_person_id: id, commission_rate: rate });

describe("normalizeAssignments", () => {
  it("keeps the order it was given — entry 0 is the primary", () => {
    expect(normalizeAssignments([seat("a", 5), seat("b", 2.5)])).toEqual([
      seat("a", 5),
      seat("b", 2.5),
    ]);
  });

  it("drops a person listed twice, keeping their first (higher-ranked) seat", () => {
    expect(normalizeAssignments([seat("a", 5), seat("b", 3), seat("a", 99)])).toEqual([
      seat("a", 5),
      seat("b", 3),
    ]);
  });

  it("clamps rates into 0–100 and reads a missing one as zero", () => {
    expect(normalizeAssignments([seat("a", -5)])).toEqual([seat("a", 0)]);
    expect(normalizeAssignments([seat("b", 250)])).toEqual([seat("b", 100)]);
    expect(normalizeAssignments([{ sales_person_id: "c" }])).toEqual([seat("c", 0)]);
  });

  it("caps the roster at five — the same cap the database enforces", () => {
    const many = Array.from({ length: 9 }, (_, i) => seat(`sp${i}`, 1));
    expect(normalizeAssignments(many)).toHaveLength(MAX_SALES_PEOPLE);
    expect(normalizeAssignments(many)[4]).toEqual(seat("sp4", 1));
  });

  it("ignores anything that isn't a real assignment", () => {
    expect(normalizeAssignments([null, 7, { commission_rate: 5 }, seat("", 5)])).toEqual([]);
    expect(normalizeAssignments("nope")).toEqual([]);
    expect(normalizeAssignments(undefined)).toEqual([]);
  });
});

describe("assignmentsFromBody", () => {
  it("takes the roster when one is sent", () => {
    expect(assignmentsFromBody({ sales_people: [seat("a", 5)] })).toEqual([seat("a", 5)]);
  });

  it("reads an empty roster as 'clear every attribution', not 'unchanged'", () => {
    expect(assignmentsFromBody({ sales_people: [] })).toEqual([]);
  });

  it("still honours the legacy single-person pair as a one-seat roster", () => {
    expect(
      assignmentsFromBody({ sales_person_id: "a", sales_person_commission_rate: 7.5 }),
    ).toEqual([seat("a", 7.5)]);
    expect(assignmentsFromBody({ sales_person_id: null })).toEqual([]);
  });

  it("prefers the roster over the legacy pair when a client sends both", () => {
    expect(
      assignmentsFromBody({
        sales_people: [seat("a", 5), seat("b", 1)],
        sales_person_id: "a",
        sales_person_commission_rate: 5,
      }),
    ).toEqual([seat("a", 5), seat("b", 1)]);
  });

  it("returns null when the body says nothing about attribution", () => {
    expect(assignmentsFromBody({ notes: "hi" })).toBeNull();
  });
});

describe("commissionAmountFor", () => {
  it("is a percentage of the invoice total, rounded to cents", () => {
    expect(commissionAmountFor(1000, 5)).toBe(50);
    expect(commissionAmountFor(333.33, 7.5)).toBe(25);
    expect(commissionAmountFor(0, 5)).toBe(0);
  });
});

describe("resolveAssignments", () => {
  const resolved = resolveAssignments([seat("a", 5), seat("b", 2.5)], 1000);

  it("gives every person their OWN cut — the rates are not slices of one pot", () => {
    expect(resolved.map((r) => r.commission_amount)).toEqual([50, 25]);
  });

  it("numbers the seats from zero so the primary is unambiguous", () => {
    expect(resolved.map((r) => r.position)).toEqual([0, 1]);
  });

  it("lets the rates sum past 100% — that's a business call, not a bug", () => {
    const heavy = resolveAssignments([seat("a", 60), seat("b", 60)], 100);
    expect(heavy.map((r) => r.commission_amount)).toEqual([60, 60]);
  });
});

describe("primaryInvoiceColumns", () => {
  it("mirrors the roster's primary onto the legacy invoice columns", () => {
    expect(primaryInvoiceColumns(resolveAssignments([seat("a", 5), seat("b", 1)], 200))).toEqual({
      sales_person_id: "a",
      sales_person_commission_rate: 5,
      sales_person_commission_amount: 10,
    });
  });

  it("clears them when nobody is credited", () => {
    expect(primaryInvoiceColumns([])).toEqual({
      sales_person_id: null,
      sales_person_commission_rate: 0,
      sales_person_commission_amount: 0,
    });
  });
});

describe("salesPersonLabel", () => {
  it("prefers the full name, falls back to the email, then a placeholder", () => {
    expect(salesPersonLabel({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
    expect(salesPersonLabel({ first_name: null, last_name: null, email: "a@b.co" })).toBe("a@b.co");
    expect(salesPersonLabel(null)).toBe("Unknown");
  });
});
