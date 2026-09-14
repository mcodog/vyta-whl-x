'use client';

import React, { useMemo, useState } from 'react';
import { X, Copy, Check, ExternalLink, FileText, CalendarDays } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/supabase';
import { localDayKey } from '@/lib/dayGroups';
import { categoryLabel } from '@/lib/admin/changelog';
import ChangelogCalendar from './ChangelogCalendar';

/** Readable full date for a `YYYY-MM-DD` key (e.g. "Monday, July 6, 2026"). */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * "Create Report" popup: pick a day and get a copyable list of that day's
 * update titles plus a shareable, pre-filtered changelog link.
 */
export default function ChangelogReportModal({
  entries,
  daysWithEntries,
  initialDay,
  onClose,
  onOpenFiltered,
}: {
  entries: ChangelogEntry[];
  daysWithEntries: Set<string>;
  initialDay: string | null;
  onClose: () => void;
  /** Apply the day filter to the timeline behind the modal and close it. */
  onOpenFiltered: (day: string) => void;
}) {
  const [day, setDay] = useState<string | null>(initialDay);
  const [copied, setCopied] = useState<'titles' | 'link' | null>(null);

  const dayEntries = useMemo(
    () => (day ? entries.filter((e) => localDayKey(e.entry_date) === day) : []),
    [entries, day],
  );

  const link = useMemo(() => {
    if (!day) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/admin/changelog?date=${day}`;
  }, [day]);

  const titlesReport = useMemo(() => {
    if (!day) return '';
    const header = `Changelog — ${formatDay(day)}`;
    const lines = dayEntries.map((e) => `- ${e.title}`);
    return [header, ...lines].join('\n');
  }, [day, dayEntries]);

  const copy = async (text: string, which: 'titles' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <FileText className="w-4 h-4 text-vital" /> Create Report
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-3 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Select a day
            </h3>
            <div className="max-w-xs">
              <ChangelogCalendar
                daysWithEntries={daysWithEntries}
                selectedDay={day}
                onSelectDay={setDay}
              />
            </div>
          </div>

          {!day ? (
            <p className="text-sm text-ink-muted">
              Pick a day above to build a report of that day's updates.
            </p>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {formatDay(day)}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {dayEntries.length} {dayEntries.length === 1 ? 'update' : 'updates'}
                    </span>
                  </h3>
                  {dayEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => copy(titlesReport, 'titles')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink hover:border-ink/30 transition-colors"
                    >
                      {copied === 'titles' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy titles
                        </>
                      )}
                    </button>
                  )}
                </div>

                {dayEntries.length === 0 ? (
                  <p className="text-sm text-ink-muted">No updates on this day.</p>
                ) : (
                  <ul className="bg-surface border border-line rounded-lg divide-y divide-line/70">
                    {dayEntries.map((e) => (
                      <li key={e.id} className="flex items-start gap-2 px-3 py-2 text-sm text-ink">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-vital shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium">{e.title}</span>
                          <span className="ml-2 text-xs text-ink-muted">{categoryLabel(e.category)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-2">
                  Shareable link (filtered to this day)
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-3 py-2 bg-surface border border-line rounded-lg text-xs text-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                  <button
                    type="button"
                    onClick={() => copy(link, 'link')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-sm font-medium text-ink hover:border-ink/30 transition-colors shrink-0"
                  >
                    {copied === 'link' ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => onOpenFiltered(day)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" /> Open filtered view
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
