'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Activity, CalendarClock, Layers } from 'lucide-react';
import {
  getAuditSummary,
  getAuditList,
  actorName,
  actorInitials,
  type AuditCard,
  type AuditEntry,
} from '@/lib/admin/auditLogs';
import { describeAction, entityLabel, toneDotClass } from '@/lib/admin/auditActions';
import { groupByDay } from '@/lib/dayGroups';
import { clockTime, timeAgo } from '@/lib/timeAgo';
import Pagination from '@/components/admin/Pagination';

const PAGE_SIZE = 30;

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  assistant: 'Assistant',
  affiliate: 'Client',
  warehouse: 'Warehouse',
};

export default function AdminAuditDetail() {
  const params = useParams();
  const actorId = String(params?.actorId ?? '');

  const [card, setCard] = useState<AuditCard | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);

  // Actor identity + headline stats come from the summary endpoint.
  useEffect(() => {
    getAuditSummary()
      .then((cards) => setCard(cards.find((c) => c.actor.id === actorId) ?? null))
      .catch(() => setCard(null))
      .finally(() => setMetaLoading(false));
  }, [actorId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAuditList({ actorId, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setPageCount(res.pageCount);
        setTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [actorId, page]);

  // Fall back to the actor embedded in the first entry if summary missed them.
  const actor = card?.actor ?? entries[0]?.actor ?? null;
  const dayGroups = useMemo(() => groupByDay(entries, (e) => e.created_at), [entries]);

  return (
    <div>
      <Link
        href="/admin/audit-logs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-5"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Audit Logs
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* Sticky identity sidebar */}
        <aside className="lg:sticky lg:top-6">
          <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
            <div className="flex flex-col items-center text-center px-6 pt-8 pb-6 bg-gradient-to-b from-vital/10 to-transparent">
              <div className="flex items-center justify-center w-20 h-20 rounded-full bg-vital/20 text-vital-dark font-bold text-2xl mb-3">
                {actorInitials(actor)}
              </div>
              <h2 className="text-lg font-bold text-ink">
                {metaLoading && !actor ? 'Loading…' : actorName(actor)}
              </h2>
              {actor?.role && (
                <span className="mt-1 inline-flex items-center rounded-full bg-surface-2 border border-line px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                  {ROLE_LABEL[actor.role] ?? actor.role}
                </span>
              )}
              {actor?.email && (
                <p className="mt-2 text-xs text-ink-muted break-all">{actor.email}</p>
              )}
            </div>

            <div className="grid grid-cols-2 divide-x divide-line/70 border-t border-line/70">
              <Stat
                icon={Activity}
                label="Today"
                value={card ? card.today_actions : '—'}
              />
              <Stat
                icon={Layers}
                label="Total"
                value={card ? card.total_actions : total}
              />
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-line/70 text-xs text-ink-muted">
              <CalendarClock className="w-3.5 h-3.5" />
              Last active{' '}
              <span className="text-ink font-medium ml-auto">
                {card?.last_active ? timeAgo(card.last_active) : '—'}
              </span>
            </div>
          </div>
        </aside>

        {/* Day-grouped activity timeline */}
        <div className="min-w-0">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-line bg-white animate-pulse" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="bg-white rounded-xl border border-line shadow-sm px-6 py-16 text-center">
              <p className="text-sm text-ink-muted">No recorded activity for this admin.</p>
            </div>
          ) : (
            <>
              <div className="space-y-6">
                {dayGroups.map((group) => (
                  <section key={group.key}>
                    {/* Day divider */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        {group.label}
                      </span>
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 rounded-full text-[10px] font-semibold bg-white text-ink-muted border border-line">
                        {group.items.length}
                      </span>
                      <div className="flex-1 h-px bg-line/70" />
                    </div>

                    {/* Timeline */}
                    <div className="bg-white rounded-xl border border-line shadow-sm divide-y divide-line/60">
                      {group.items.map((e) => {
                        const desc = describeAction(e.action, e.entity_type);
                        return (
                          <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${toneDotClass(desc.tone)}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-ink">
                                <span className="font-medium">{desc.verbLabel}</span>{' '}
                                <span className="text-ink-muted">{entityLabel(e.entity_type).toLowerCase()}</span>
                                {e.entity_id && (
                                  <span className="ml-1.5 text-[11px] font-mono text-ink-light">
                                    #{e.entity_id.slice(0, 8)}
                                  </span>
                                )}
                              </p>
                            </div>
                            <span className="text-xs text-ink-light tabular-nums shrink-0">
                              {clockTime(e.created_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className="mt-4 bg-white rounded-xl border border-line shadow-sm overflow-hidden">
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  total={total}
                  pageSize={PAGE_SIZE}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-4">
      <Icon className="w-4 h-4 text-vital mb-1" />
      <span className="text-xl font-bold text-ink tabular-nums leading-none">{value}</span>
      <span className="text-[11px] text-ink-muted mt-1 uppercase tracking-wide">{label}</span>
    </div>
  );
}
