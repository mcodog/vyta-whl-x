'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Radio, PackageCheck, ArrowRight } from 'lucide-react';
import { authedGet } from '@/lib/admin/authed-fetch';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';

interface LogRow {
  at: string;
  actor_name: string;
  actor_role: string | null;
  action: string;
  to: string | null;
  invoice_number: string | null;
  order_number: string | null;
}

const POLL_MS = 20000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/**
 * Live tail of warehouse actions — packs, ships, checklist edits, photos,
 * customer emails — aggregated server-side from the audit log. Polls every
 * 20s so the feed stays current without a realtime subscription.
 */
export default function WarehouseTail() {
  const feed = useSmartLoad(() => authedGet<{ logs: LogRow[] }>('/api/admin/warehouse/activity'), []);

  // Poll for fresh activity.
  useEffect(() => {
    const t = setInterval(() => feed.reload(), POLL_MS);
    return () => clearInterval(t);
  }, [feed.reload]);

  const logs = feed.data?.logs ?? [];

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-vital/10 text-vital">
          <PackageCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink leading-tight">
            Warehouse activity
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
              <Radio className="h-3 w-3" /> Live
            </span>
          </h3>
          <p className="text-[11px] text-ink-muted leading-tight">Packs, ships & queue actions</p>
        </div>
        <Link href="/admin/warehouse" className="inline-flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink">
          View <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="scrollbar-hide max-h-72 min-h-[8rem] flex-1 overflow-y-auto">
        {feed.loading ? (
          <ul className="divide-y divide-line/50">
            {[...Array(5)].map((_, i) => (
              <li key={i} className="flex items-center gap-2.5 px-4 py-2.5 animate-pulse">
                <div className="h-6 w-6 shrink-0 rounded-md bg-surface" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 rounded bg-surface" />
                  <div className="h-2.5 w-20 rounded bg-surface" />
                </div>
                <div className="h-2.5 w-8 rounded bg-surface" />
              </li>
            ))}
          </ul>
        ) : logs.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-ink-muted">
            No warehouse activity yet
          </div>
        ) : (
          <ul className="divide-y divide-line/50">
            {logs.slice(0, 20).map((l, i) => {
              const ref = l.invoice_number || l.order_number;
              return (
                <li key={`${l.at}-${i}`} className="flex items-center gap-2.5 px-4 py-2.5">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-vital" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      <span className="font-medium">{l.actor_name}</span>{' '}
                      <span className="text-ink-muted">{l.action.toLowerCase()}</span>
                    </div>
                    {ref && <div className="font-mono text-[11px] text-ink-light">{ref}</div>}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-light">{timeAgo(l.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
