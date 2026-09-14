'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localDayKey } from '@/lib/dayGroups';

/**
 * Month calendar for the changelog sidebar. Days that have at least one entry
 * show a small dot; clicking a day filters the timeline to that date (clicking
 * the selected day again clears the filter).
 */
export default function ChangelogCalendar({
  daysWithEntries,
  selectedDay,
  onSelectDay,
}: {
  /** Set of `YYYY-MM-DD` keys that have at least one entry. */
  daysWithEntries: Set<string>;
  /** Currently selected `YYYY-MM-DD`, or null. */
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  // The visible month. Start on the selected day's month, else today.
  const [view, setView] = useState(() => {
    const base = selectedDay ? new Date(`${selectedDay}T00:00:00`) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const todayKey = localDayKey(new Date());

  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const startWeekday = (first.getDay() + 6) % 7; // Monday-first (0 = Mon)
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);

  const dayKey = (d: number) =>
    `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const shift = (delta: number) => {
    setView((v) => {
      const m = v.month + delta;
      const year = v.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-ink">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-ink-light uppercase">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((d, i) => {
          if (d === null) return <div key={`e-${i}`} />;
          const key = dayKey(d);
          const hasEntries = daysWithEntries.has(key);
          const isSelected = selectedDay === key;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(isSelected ? null : key)}
              className={`relative aspect-square flex items-center justify-center rounded-md text-xs transition-colors ${
                isSelected
                  ? 'bg-ink text-white font-semibold'
                  : isToday
                    ? 'bg-surface text-ink font-semibold ring-1 ring-line'
                    : 'text-ink hover:bg-surface'
              }`}
            >
              {d}
              {hasEntries && (
                <span
                  className={`absolute bottom-1 w-1 h-1 rounded-full ${
                    isSelected ? 'bg-white' : 'bg-vital'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <button
          type="button"
          onClick={() => onSelectDay(null)}
          className="mt-3 w-full text-center text-xs text-vital hover:text-vital-dark font-medium"
        >
          Clear date filter
        </button>
      )}
    </div>
  );
}
