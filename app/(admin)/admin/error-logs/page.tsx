'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bug, Search, X, CalendarDays, CalendarRange, AlertTriangle, CheckCircle2, Repeat, Layers, ChevronRight } from 'lucide-react';
import {
  getErrorStats,
  getErrorList,
  setErrorResolved,
  type ErrorStats,
  type ErrorEntry,
} from '@/lib/admin/errorLogs';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit } from '@/lib/permissions';
import { groupByDay } from '@/lib/dayGroups';
import { timeAgo } from '@/lib/timeAgo';
import PillToggle from '@/components/admin/PillToggle';
import Pagination from '@/components/admin/Pagination';
import ErrorStatTile from './_components/ErrorStatTile';
import ErrorRow from './_components/ErrorRow';

const PAGE_SIZE = 20;
type StatusFilter = 'all' | 'false' | 'true'; // false = unresolved, true = resolved

export default function AdminErrorLogs() {
  const role = useUserRole();
  const canResolve = canEdit(role);

  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [area, setArea] = useState<string>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    getErrorStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, status, area]);

  const loadList = useCallback(() => {
    let cancelled = false;
    setListLoading(true);
    getErrorList({
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch || undefined,
      resolved: status === 'all' ? undefined : status,
      area: area !== 'all' ? area : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setPageCount(res.pageCount);
        setTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setPageCount(1);
          setTotal(0);
        }
      })
      .finally(() => !cancelled && setListLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, status, area]);

  useEffect(() => {
    const cleanup = loadList();
    return cleanup;
  }, [loadList]);

  const handleToggleResolved = async (entry: ErrorEntry) => {
    const next = !entry.resolved;
    // Optimistic update.
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, resolved: next } : e)));
    try {
      await setErrorResolved({ id: entry.id }, next);
      loadStats();
    } catch {
      // Revert on failure.
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, resolved: !next } : e)));
    }
  };

  const resolveFingerprint = async (fingerprint: string) => {
    try {
      await setErrorResolved({ fingerprint }, true);
      loadStats();
      loadList();
    } catch {
      /* non-fatal */
    }
  };

  const dayGroups = useMemo(() => groupByDay(entries, (e) => e.created_at), [entries]);
  const topArea = stats?.areas?.[0];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Bug className="w-6 h-6 text-vital" />
          Error Logs
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          Every API failure across the platform, grouped and triaged.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statsLoading || !stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[76px] rounded-xl border border-line bg-white animate-pulse" />
          ))
        ) : (
          <>
            <ErrorStatTile icon={CalendarDays} label="Errors today" value={stats.today} tone={stats.today > 0 ? 'danger' : 'good'} />
            <ErrorStatTile icon={CalendarRange} label="This week" value={stats.week} tone={stats.week > 0 ? 'warn' : 'good'} />
            <ErrorStatTile icon={AlertTriangle} label="Unresolved" value={stats.unresolved} tone={stats.unresolved > 0 ? 'danger' : 'good'} />
            <ErrorStatTile
              icon={Layers}
              label="Top area"
              value={topArea ? topArea.area : '—'}
              hint={topArea ? `${topArea.count} recent error${topArea.count === 1 ? '' : 's'}` : undefined}
            />
          </>
        )}
      </div>

      {/* Insight panels: repeated errors + area breakdown */}
      {stats && (stats.repeated.length > 0 || stats.areas.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Repeated errors */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-line shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-line/70">
              <Repeat className="w-4 h-4 text-vital" />
              <h2 className="text-sm font-semibold text-ink">Repeated errors</h2>
              <span className="text-xs text-ink-muted">recent window</span>
            </div>
            {stats.repeated.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-muted text-center">No repeated errors — nice.</p>
            ) : (
              <div className="divide-y divide-line/60">
                {stats.repeated.map((g) => (
                  <div key={g.fingerprint} className="flex items-center gap-3 px-5 py-3">
                    <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded-full bg-red-50 text-red-600 text-xs font-bold tabular-nums shrink-0">
                      {g.count}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{g.message}</p>
                      <p className="text-[11px] text-ink-muted">
                        {g.area} · last seen {timeAgo(g.last_seen)}
                        {g.unresolved > 0 ? ` · ${g.unresolved} unresolved` : ' · all resolved'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setArea('all');
                        setStatus('all');
                        setSearch(g.message.slice(0, 40));
                      }}
                      className="inline-flex items-center gap-1 text-xs text-vital-dark hover:underline shrink-0"
                    >
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    {canResolve && g.unresolved > 0 && (
                      <button
                        type="button"
                        onClick={() => resolveFingerprint(g.fingerprint)}
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline shrink-0"
                        title="Mark all in this group resolved"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Resolve all
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Area breakdown */}
          <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-line/70">
              <Layers className="w-4 h-4 text-vital" />
              <h2 className="text-sm font-semibold text-ink">Errors by area</h2>
            </div>
            {stats.areas.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-muted text-center">No errors recorded.</p>
            ) : (
              <div className="px-5 py-3 space-y-2.5">
                {stats.areas.slice(0, 8).map((a) => {
                  const max = stats.areas[0]?.count || 1;
                  const pct = Math.round((a.count / max) * 100);
                  const active = area === a.area;
                  return (
                    <button
                      key={a.area}
                      type="button"
                      onClick={() => setArea(active ? 'all' : a.area)}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className={`truncate ${active ? 'text-vital-dark font-medium' : 'text-ink'}`}>{a.area}</span>
                        <span className="text-ink-muted tabular-nums ml-2">{a.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${active ? 'bg-vital' : 'bg-vital/50 group-hover:bg-vital/70'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message, route, or area…"
            className="w-full pl-10 pr-9 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-sm text-ink"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {area !== 'all' && (
          <button
            onClick={() => setArea('all')}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-line bg-white text-sm text-ink-muted hover:text-ink"
          >
            {area} <X className="w-3.5 h-3.5" />
          </button>
        )}
        <PillToggle<StatusFilter>
          ariaLabel="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'false', label: 'Unresolved' },
            { value: 'true', label: 'Resolved' },
          ]}
        />
      </div>

      {/* Error list */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        {listLoading ? (
          <div className="divide-y divide-line/60">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse bg-surface/40" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-ink-muted">
              {debouncedSearch || status !== 'all' || area !== 'all'
                ? 'No errors match your filters.'
                : 'No API errors recorded. All clear.'}
            </p>
          </div>
        ) : (
          <div>
            {dayGroups.map((group) => (
              <div key={group.key}>
                <div className="flex items-center gap-2 px-5 py-2 bg-surface/60 border-y border-line/60">
                  <CalendarDays className="w-3.5 h-3.5 text-ink-muted" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{group.label}</span>
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[10px] font-semibold bg-white text-ink-muted border border-line">
                    {group.items.length}
                  </span>
                </div>
                <div className="divide-y divide-line/60">
                  {group.items.map((e) => (
                    <ErrorRow
                      key={e.id}
                      entry={e}
                      canResolve={canResolve}
                      onToggleResolved={handleToggleResolved}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
}
