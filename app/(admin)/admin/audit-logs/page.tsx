'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, LayoutGrid, Table as TableIcon, ShieldCheck, X, Filter } from 'lucide-react';
import Link from 'next/link';
import {
  getAuditSummary,
  getAuditList,
  actorName,
  actorInitials,
  type AuditCard,
  type AuditEntry,
} from '@/lib/admin/auditLogs';
import { describeAction, entityLabel } from '@/lib/admin/auditActions';
import { groupByDay } from '@/lib/dayGroups';
import { clockTime } from '@/lib/timeAgo';
import PillToggle from '@/components/admin/PillToggle';
import Pagination from '@/components/admin/Pagination';
import DayDividerRow from '@/components/admin/DayDivider';
import TableSkeleton from '@/components/admin/TableSkeleton';
import AdminAuditCard from './_components/AdminAuditCard';
import AuditActionBadge from './_components/AuditActionBadge';

const PAGE_SIZE = 20;
type View = 'card' | 'table';

export default function AdminAuditLogs() {
  const [view, setView] = useState<View>('card');
  const [search, setSearch] = useState('');

  // Card view (per-admin summary) — also feeds the actor filter dropdown.
  const [cards, setCards] = useState<AuditCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  // Table view (paginated ledger).
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [actorId, setActorId] = useState<string>('all');

  // Debounced search term so we don't refetch on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    getAuditSummary()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setCardsLoading(false));
  }, []);

  // Reset to first page whenever a table filter changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, actorId, view]);

  // Fetch the table page when in table view or its inputs change.
  useEffect(() => {
    if (view !== 'table') return;
    let cancelled = false;
    setTableLoading(true);
    getAuditList({
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch || undefined,
      actorId: actorId !== 'all' ? actorId : undefined,
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
      .finally(() => !cancelled && setTableLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, page, debouncedSearch, actorId]);

  // Client-side filter for the card grid (small set, no need to refetch).
  const filteredCards = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const hay = `${actorName(c.actor)} ${c.actor.email ?? ''} ${c.actor.role ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, debouncedSearch]);

  const dayGroups = useMemo(
    () => groupByDay(entries, (e) => e.created_at),
    [entries],
  );

  const totalActionsToday = cards.reduce((sum, c) => sum + c.today_actions, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-vital" />
            Audit Logs
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Every admin action, who did it, and when.
            {!cardsLoading && (
              <span className="ml-1 text-ink">
                {totalActionsToday} action{totalActionsToday === 1 ? '' : 's'} logged today.
              </span>
            )}
          </p>
        </div>
        <PillToggle<View>
          ariaLabel="Toggle view"
          value={view}
          onChange={setView}
          options={[
            { value: 'card', label: 'Cards', icon: LayoutGrid },
            { value: 'table', label: 'Table', icon: TableIcon },
          ]}
        />
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by admin, action, or entity…"
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
        {view === 'table' && (
          <div className="relative sm:w-64">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
            <select
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-sm text-ink appearance-none"
            >
              <option value="all">All admins</option>
              {cards.map((c) => (
                <option key={c.actor.id} value={c.actor.id}>
                  {actorName(c.actor)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Card view */}
      {view === 'card' && (
        <>
          {cardsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-64 rounded-xl border border-line bg-white animate-pulse" />
              ))}
            </div>
          ) : filteredCards.length === 0 ? (
            <EmptyState label={debouncedSearch ? 'No admins match your search.' : 'No admin activity recorded yet.'} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCards.map((c) => (
                <AdminAuditCard key={c.actor.id} card={c} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Admin</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {tableLoading ? (
                  <TableSkeleton rows={8} cols={4} />
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-16 text-center text-sm text-ink-muted">
                      No matching audit entries.
                    </td>
                  </tr>
                ) : (
                  dayGroups.map((group) => (
                    <React.Fragment key={group.key}>
                      <DayDividerRow colSpan={4} label={group.label} count={group.items.length} />
                      {group.items.map((e) => {
                        const desc = describeAction(e.action, e.entity_type);
                        return (
                          <tr key={e.id} className="hover:bg-surface/50 transition-colors">
                            <td className="px-5 py-3 whitespace-nowrap text-ink-muted tabular-nums">
                              {clockTime(e.created_at)}
                            </td>
                            <td className="px-5 py-3">
                              <Link
                                href={`/admin/audit-logs/${e.actor_id ?? ''}`}
                                className="inline-flex items-center gap-2 group"
                              >
                                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-vital/15 text-vital-dark text-[11px] font-semibold shrink-0">
                                  {actorInitials(e.actor)}
                                </span>
                                <span className="text-ink group-hover:text-vital-dark truncate max-w-[160px]">
                                  {actorName(e.actor)}
                                </span>
                              </Link>
                            </td>
                            <td className="px-5 py-3">
                              <AuditActionBadge action={e.action} entityType={e.entity_type} />
                            </td>
                            <td className="px-5 py-3 text-ink-muted">
                              <span className="text-ink">{entityLabel(e.entity_type)}</span>
                              {e.entity_id && (
                                <span className="ml-1.5 text-[11px] font-mono text-ink-light">
                                  #{e.entity_id.slice(0, 8)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            total={total}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-xl border border-line shadow-sm px-6 py-16 text-center">
      <p className="text-sm text-ink-muted">{label}</p>
    </div>
  );
}
