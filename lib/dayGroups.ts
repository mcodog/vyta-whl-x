/**
 * Helpers for splitting a list of rows into per-day groups so admin tables can
 * render a readable date divider between days.
 *
 * Rows are grouped by their local-time day; a day is emitted at most once (see
 * groupByDay), so a list ordered by a *different* field than it's grouped by
 * still yields one divider per day rather than fragmenting.
 */

/**
 * Coerce a date value to a `Date`. A bare calendar date (`YYYY-MM-DD`, how
 * Postgres `date` columns serialize) is read as a *local* day: `new
 * Date('2026-07-30')` would otherwise parse as UTC midnight and slip to the
 * previous day in any behind-UTC timezone. Full timestamps and existing
 * `Date`s are returned unchanged.
 */
export function toLocalDate(input: string | Date): Date {
  if (input instanceof Date) return input;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return new Date(`${input}T00:00:00`);
  return new Date(input);
}

/** A stable local-time day key (`YYYY-MM-DD`) identifying the day a date falls on. */
export function localDayKey(input: string | Date): string {
  const d = toLocalDate(input);
  if (isNaN(d.getTime())) return 'unknown';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * A friendly heading for a day divider: "Today", "Yesterday", or a full
 * readable date like "Monday, July 6, 2026".
 */
export function formatDayHeading(input: string | Date): string {
  const d = toLocalDate(input);
  if (isNaN(d.getTime())) return 'Unknown date';

  const todayKey = localDayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const key = localDayKey(d);

  if (key === todayKey) return 'Today';
  if (key === localDayKey(yesterday)) return 'Yesterday';

  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export interface DayGroup<T> {
  /** Local-time `YYYY-MM-DD` key for the day (or `unknown` for missing dates). */
  key: string;
  /** Readable heading shown in the divider row. */
  label: string;
  items: T[];
}

/**
 * Group a list into per-day buckets. `getDate` pulls the date each row is
 * grouped by. Rows sharing a day are merged into a single group even when they
 * are not adjacent (e.g. the list is ordered by a different field than it's
 * grouped by), so a day never produces two dividers — nor two rendered
 * children with the same key. Group order follows each day's first appearance,
 * preserving the incoming row order. Rows with a missing/invalid date fall into
 * a single "Unknown date" group.
 */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => string | Date | null | undefined,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();

  for (const item of items) {
    const raw = getDate(item);
    const key = raw ? localDayKey(raw) : 'unknown';
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: raw ? formatDayHeading(raw) : 'Unknown date', items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
