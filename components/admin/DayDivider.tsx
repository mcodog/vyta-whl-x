import React from 'react';
import { CalendarDays } from 'lucide-react';

/**
 * A full-width table row that separates day groups in admin tables, showing a
 * readable date (e.g. "Today", "Yesterday", "Monday, July 6, 2026") and how
 * many rows fall on that day.
 *
 * When `selectable` is set, a checkbox is shown so the whole day's rows can be
 * bulk-selected/deselected in one click (used on the orders table).
 */
export default function DayDividerRow({
  colSpan,
  label,
  count,
  selectable = false,
  allSelected = false,
  someSelected = false,
  onToggleSelect,
}: {
  colSpan: number;
  label: string;
  count?: number;
  /** Show a select-all-for-this-day checkbox. */
  selectable?: boolean;
  /** Every row in this day is currently selected. */
  allSelected?: boolean;
  /** Some (but not all) rows in this day are selected → indeterminate. */
  someSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const checkboxRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = !allSelected && someSelected;
  }, [allSelected, someSelected]);

  const content = (
    <div className="flex items-center gap-2">
      {selectable && (
        <input
          ref={checkboxRef}
          type="checkbox"
          aria-label={`Select all orders on ${label}`}
          checked={allSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
        />
      )}
      <CalendarDays className="w-3.5 h-3.5 text-ink-muted" />
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      {count != null && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[10px] font-semibold bg-white text-ink-muted border border-line">
          {count}
        </span>
      )}
    </div>
  );

  return (
    <tr className="bg-surface/60">
      <td colSpan={colSpan} className="px-5 py-2 border-y border-line/70">
        {selectable && onToggleSelect ? (
          <button
            type="button"
            onClick={onToggleSelect}
            title={allSelected ? 'Deselect this day' : 'Select this day'}
            className="w-full text-left cursor-pointer"
          >
            {content}
          </button>
        ) : (
          content
        )}
      </td>
    </tr>
  );
}
