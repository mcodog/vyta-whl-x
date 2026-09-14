import { describe, it, expect } from "vitest";
import type { Product } from "@/lib/supabase";
import {
  COLUMNS,
  applyCellEdit,
  buildPrintHtml,
  buildRowView,
  displayValue,
  parseNumeric,
  pruneDraft,
  rawValue,
  sameOverride,
  selectionSum,
  type Draft,
} from "./CellEditGrid";

/** A product with 43 vials on hand at 10 per case: 4 cases + 3 loose. */
const product = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "BPC-157",
    sku: "BPC-5",
    price: 120,
    vial_price: null,
    stock_quantity: 43,
    vials_per_box: 10,
    low_stock_threshold: 10,
    ...over,
  }) as Product;

describe("parseNumeric", () => {
  it("tolerates currency symbols and thousands separators", () => {
    expect(parseNumeric("$1,234.50")).toBe(1234.5);
    expect(parseNumeric("12")).toBe(12);
  });

  it("returns null for the in-progress and nonsense stages of typing", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("-")).toBeNull();
    expect(parseNumeric(".")).toBeNull();
    expect(parseNumeric("1.2.3")).toBeNull();
  });
});

describe("buildRowView", () => {
  it("projects the one stored vial count into cases + loose vials", () => {
    const view = buildRowView(product());
    expect(view.stock).toBe(43);
    expect(view.cases).toBe(4);
    expect(view.loose).toBe(3);
  });

  it("derives the vial price when no override is stored", () => {
    const view = buildRowView(product());
    expect(view.vialOverride).toBeNull();
    expect(view.vialPrice).toBe(12);
    expect([...view.dirty]).toEqual([]);
  });

  it("lights BOTH stock cells when stock changes — they are one field", () => {
    const view = buildRowView(product(), { stock_quantity: 50 });
    expect([...view.dirty].sort()).toEqual(["stock_cases", "stock_vials"]);
  });
});

describe("applyCellEdit — the stock rule", () => {
  const view = buildRowView(product());

  it("writes floor(n) straight through from the vials column", () => {
    expect(applyCellEdit(view, "stock_vials", "77", undefined)).toEqual({ stock_quantity: 77 });
    expect(applyCellEdit(view, "stock_vials", "7.9", undefined)).toEqual({ stock_quantity: 7 });
  });

  it("keeps the loose vials when whole cases are typed", () => {
    // "Make it 5 cases" must not silently destroy the 3 odd vials next to them.
    expect(applyCellEdit(view, "stock_cases", "5", undefined)).toEqual({ stock_quantity: 53 });
  });

  it("treats a decimal case count as the whole quantity, remainder included", () => {
    expect(applyCellEdit(view, "stock_cases", "2.5", undefined)).toEqual({ stock_quantity: 25 });
  });

  it("drops unusable input instead of writing it", () => {
    expect(applyCellEdit(view, "stock_vials", "-1", undefined)).toBeNull();
    expect(applyCellEdit(view, "stock_vials", "", undefined)).toBeNull();
    expect(applyCellEdit(view, "sku", "NEW-SKU", undefined)).toBeNull();
  });
});

describe("applyCellEdit — the price rule", () => {
  const auto = buildRowView(product());
  const overridden = buildRowView(product({ price: 150, vial_price: 15 }));

  it("leaves an auto row on auto when the case price changes", () => {
    expect(applyCellEdit(auto, "price_case", "150", undefined)).toEqual({ price: 150 });
  });

  it("rescales an existing override when the case price changes", () => {
    expect(applyCellEdit(overridden, "price_case", "200", undefined)).toEqual({
      price: 200,
      vial_price: 20,
    });
  });

  it("rewrites the case price when the vial price changes", () => {
    expect(applyCellEdit(auto, "price_vial", "15", undefined)).toEqual({
      vial_price: 15,
      price: 150,
    });
  });

  it("clears an override back to auto, present-and-null so the PATCH sends it", () => {
    const next = applyCellEdit(overridden, "price_vial", "", undefined);
    expect(next).toEqual({ vial_price: null });
    expect(next && "vial_price" in next).toBe(true);
  });

  it("resolves an inconsistent pasted pair to vial × per (vial lands last)", () => {
    // A paste applies a row left to right, so the vial price wins — which is
    // the number the storefront would have charged.
    let draft: Draft | null = applyCellEdit(auto, "price_case", "999", undefined);
    draft = applyCellEdit(buildRowView(product(), draft!), "price_vial", "20", draft!);
    expect(draft).toEqual({ price: 200, vial_price: 20 });
  });
});

describe("pruneDraft", () => {
  it("drops a value edited back to what the product already has", () => {
    expect(pruneDraft(product(), { stock_quantity: 43 })).toBeNull();
    expect(pruneDraft(product(), { price: 120 })).toBeNull();
    expect(pruneDraft(product(), { vial_price: null })).toBeNull();
  });

  it("keeps a real change and prunes only the no-op key beside it", () => {
    expect(pruneDraft(product(), { price: 130, stock_quantity: 43 })).toEqual({ price: 130 });
    expect(pruneDraft(product({ vial_price: 15 }), { vial_price: null })).toEqual({
      vial_price: null,
    });
  });
});

describe("rawValue / displayValue", () => {
  it("copies an auto vial price out BLANK so an Excel round-trip stays auto", () => {
    expect(rawValue(buildRowView(product()), "price_vial")).toBe("");
    expect(rawValue(buildRowView(product({ price: 150, vial_price: 15 })), "price_vial")).toBe(
      "15.00",
    );
  });

  it("shows money with a bare $ and stock as a plain count", () => {
    const view = buildRowView(product());
    expect(displayValue(view, "price_case")).toBe("$120.00");
    expect(displayValue(view, "stock_vials")).toBe("43");
    expect(rawValue(view, "stock_cases")).toBe("4");
  });
});

describe("sameOverride", () => {
  it("compares at cents and treats null as distinct from 0", () => {
    expect(sameOverride(null, null)).toBe(true);
    expect(sameOverride(null, 0)).toBe(false);
    expect(sameOverride(15, 15.001)).toBe(true);
  });
});

describe("selectionSum", () => {
  const rows = [buildRowView(product()), buildRowView(product({ id: "p2", stock_quantity: 7 }))];

  it("sums a single numeric column spanning at least two rows", () => {
    // Column 2 is Stock (vials); column 5 is Case price — the Notes column at
    // index 4 pushes the two price columns one to the right.
    expect(selectionSum(rows, { r1: 0, r2: 1, c1: 2, c2: 2 })).toBe("50");
    expect(selectionSum(rows, { r1: 0, r2: 1, c1: 5, c2: 5 })).toBe("$240.00");
  });

  it("has nothing to sum for one row, several columns, or a text column", () => {
    expect(selectionSum(rows, { r1: 0, r2: 0, c1: 2, c2: 2 })).toBeNull();
    expect(selectionSum(rows, { r1: 0, r2: 1, c1: 2, c2: 3 })).toBeNull();
    expect(selectionSum(rows, { r1: 0, r2: 1, c1: 0, c2: 0 })).toBeNull();
  });

  it("has nothing to sum for the text Notes column", () => {
    expect(selectionSum(rows, { r1: 0, r2: 1, c1: 4, c2: 4 })).toBeNull();
  });
});

describe("the Notes column", () => {
  it("sits between Stock (cases) and Case price, and is the only text cell", () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      "sku",
      "name",
      "stock_vials",
      "stock_cases",
      "note",
      "price_case",
      "price_vial",
    ]);
    const note = COLUMNS.find((c) => c.key === "note")!;
    expect(note.editable).toBe(true);
    expect(note.numeric).toBe(false);
  });

  it("reads the note off the product, and blank when there isn't one", () => {
    expect(rawValue(buildRowView(product()), "note")).toBe("");
    const noted = buildRowView(product({ grid_note: "waiting on Jason" }));
    expect(rawValue(noted, "note")).toBe("waiting on Jason");
    expect(displayValue(noted, "note")).toBe("waiting on Jason");
  });

  it("stages free text — no number parsing anywhere near it", () => {
    const view = buildRowView(product());
    expect(applyCellEdit(view, "note", "check lot 24-B", undefined)).toEqual({
      grid_note: "check lot 24-B",
    });
    // The stages that are unusable in a number column are ordinary text here.
    expect(applyCellEdit(view, "note", "-", undefined)).toEqual({ grid_note: "-" });
  });

  it("clears to null on blank (or whitespace), present-and-null so the PATCH sends it", () => {
    const noted = buildRowView(product({ grid_note: "old" }));
    const next = applyCellEdit(noted, "note", "   ", undefined);
    expect(next).toEqual({ grid_note: null });
    expect(next && "grid_note" in next).toBe(true);
  });

  it("caps a runaway paste at the length the API stores", () => {
    const next = applyCellEdit(buildRowView(product()), "note", "x".repeat(900), undefined);
    expect(next?.grid_note).toHaveLength(500);
  });

  it("strips tabs and newlines — they are the TSV separators", () => {
    const next = applyCellEdit(
      buildRowView(product()),
      "note",
      "call\tKat\nabout lot 24-B",
      undefined,
    );
    expect(next).toEqual({ grid_note: "call Kat about lot 24-B" });
  });

  it("lights the cell only when the note actually changed", () => {
    const unchanged = buildRowView(product({ grid_note: "same" }), { grid_note: "same" });
    expect([...unchanged.dirty]).toEqual([]);
    const changed = buildRowView(product({ grid_note: "same" }), { grid_note: "new" });
    expect([...changed.dirty]).toEqual(["note"]);
  });

  it("prunes a note typed back to what the product already had", () => {
    expect(pruneDraft(product({ grid_note: "keep" }), { grid_note: "keep" })).toBeNull();
    // A product with no note and an emptied cell are the same thing.
    expect(pruneDraft(product(), { grid_note: null })).toBeNull();
    expect(pruneDraft(product({ grid_note: "old" }), { grid_note: null })).toEqual({
      grid_note: null,
    });
  });
});

describe("buildPrintHtml", () => {
  it("prints every visible row in the grid's column order, with the gutter", () => {
    const html = buildPrintHtml([
      buildRowView(product()),
      buildRowView(product({ id: "p2", name: "TB-500", sku: "TB-5", price: 90 })),
    ]);

    expect(html).toContain("BPC-157");
    expect(html).toContain("TB-500");
    expect(html).toContain("2 rows");
    // The grid's own header: label + unit sub-line, left to right.
    const labels = [...html.matchAll(/<div class="label">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toEqual(COLUMNS.map((c) => c.label));
    // Row numbers, exactly as column index −1 renders them.
    expect(html).toContain('<th class="gutter">1</th>');
    expect(html).toContain('<th class="gutter">2</th>');
  });

  it("keeps the grid's cell styling rather than a report template", () => {
    const html = buildPrintHtml([buildRowView(product())]);

    // Column proportions carry over from COLUMNS, so the print is the same
    // table shape scaled to the page.
    expect(html).toContain("table-layout: fixed");
    expect(html).toContain("<col style=\"width:");
    // A row on auto keeps its badge; nothing branded creeps in.
    expect(html).toContain('<span class="auto">auto</span>');
    expect(html).not.toContain("PURAMASS");
    expect(html).not.toContain("pill");
  });

  it("prints the staged value, tinted, rather than the saved one", () => {
    const draft: Draft = { stock_quantity: 100, grid_note: "count me" };
    const html = buildPrintHtml([buildRowView(product(), draft)], { dirtyCount: 1 });

    expect(html).toContain("1 unsaved");
    expect(html).toContain('<td class="num dirty">100</td>');
    expect(html).toContain('<td class="dirty">count me</td>');
    expect(html).not.toContain(">43<");
  });

  it("flags low and out-of-stock rows the way the grid colours them", () => {
    expect(buildPrintHtml([buildRowView(product({ stock_quantity: 0 }))])).toContain(
      '<span class="out">0</span>',
    );
    expect(
      buildPrintHtml([buildRowView(product({ stock_quantity: 5, low_stock_threshold: 10 }))]),
    ).toContain('<span class="low">5</span>');
  });

  it("escapes note text instead of letting it become markup", () => {
    const html = buildPrintHtml([
      buildRowView(product({ grid_note: "<b>bold</b>" })),
    ]);

    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("says so plainly when the grid is showing nothing", () => {
    expect(buildPrintHtml([])).toContain("No products in view.");
  });
});
