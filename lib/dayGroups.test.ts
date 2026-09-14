import { describe, it, expect } from "vitest";
import { toLocalDate, localDayKey, groupByDay } from "./dayGroups";

describe("toLocalDate / localDayKey — date-only strings", () => {
  it("reads a bare YYYY-MM-DD as a local calendar day, not UTC midnight", () => {
    // `new Date('2026-07-30')` is UTC midnight, which is the 29th in any
    // behind-UTC zone. Parsed as a local day it must stay the 30th regardless
    // of the runner's timezone.
    const d = toLocalDate("2026-07-30");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(30);
    expect(localDayKey("2026-07-30")).toBe("2026-07-30");
  });

  it("leaves full timestamps and Date instances untouched", () => {
    const iso = "2026-07-30T15:00:00.000Z";
    expect(toLocalDate(iso).getTime()).toBe(new Date(iso).getTime());
    const now = new Date();
    expect(toLocalDate(now)).toBe(now);
  });
});

describe("groupByDay", () => {
  it("merges same-day rows even when they are not adjacent", () => {
    // A list ordered by created_at but grouped by issue_date: the back-dated
    // row (issue_date 07-01) sits first, its day-mates come later. They must
    // land in ONE group, and each group key must be unique (no duplicate React
    // keys → no double-rendered row).
    const rows = [
      { id: "a", issue_date: "2026-07-01" }, // back-dated, newest created_at
      { id: "b", issue_date: "2026-07-30" },
      { id: "c", issue_date: "2026-07-30" },
      { id: "d", issue_date: "2026-07-01" },
    ];
    const groups = groupByDay(rows, (r) => r.issue_date);

    expect(groups.map((g) => g.key)).toEqual(["2026-07-01", "2026-07-30"]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    expect(groups[0].items.map((r) => r.id)).toEqual(["a", "d"]);
    expect(groups[1].items.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("buckets missing/invalid dates into a single 'unknown' group", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const groups = groupByDay(rows, () => null);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("unknown");
    expect(groups[0].items.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
