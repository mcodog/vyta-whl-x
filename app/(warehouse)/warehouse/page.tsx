'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  PackageCheck,
  Truck,
  Store,
  CheckCircle2,
  Boxes,
  AlertCircle,
  RefreshCw,
  Radio,
  Search,
  X,
  Trash2,
  RotateCcw,
  Loader2,
  CheckSquare,
} from 'lucide-react';
import { supabase, type FulfillmentStatus } from '@/lib/supabase';
import {
  getQueue,
  updateFulfillmentStatus,
  setQueueRemoved,
  isComplete,
  type QueueItem,
  type QueueViewer,
  type NotificationKind,
} from '@/lib/warehouse/api';
import { groupByDay, localDayKey } from '@/lib/dayGroups';
import Pagination from '@/components/admin/Pagination';
import QueueRow from './_components/QueueRow';
import QueueDetail from './_components/QueueDetail';
import FulfillmentEmailModal from '@/components/FulfillmentEmailModal';

const PAGE_SIZE = 12;

type TypeFilter = 'all' | 'shipment' | 'pickup';

const FILTERS: { key: TypeFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'all', label: 'All', icon: Boxes },
  { key: 'shipment', label: 'Shipments', icon: Truck },
  { key: 'pickup', label: 'Self-Pickups', icon: Store },
];

function WarehouseDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ids ticked for a bulk action (pack/ship/remove/restore).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Which bulk action is currently running (drives the per-button spinner), or
  // null when idle. A single in-flight action locks the others out.
  const [bulkBusy, setBulkBusy] = useState<null | 'pack' | 'ship' | 'remove' | 'restore'>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Filters/view are seeded from the URL so the queue view survives refresh and
  // Back, and can be bookmarked; they're written back whenever they change.
  const [filter, setFilter] = useState<TypeFilter>(
    () => (searchParams.get('type') as TypeFilter | null) ?? 'all',
  );
  const [labelFilter, setLabelFilter] = useState<'all' | 'with' | 'without'>(
    () => (searchParams.get('label') as 'all' | 'with' | 'without' | null) ?? 'all',
  );
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [view, setView] = useState<'active' | 'ship' | 'archive'>(() => {
    const v = searchParams.get('view');
    return v === 'archive' ? 'archive' : v === 'ship' ? 'ship' : 'active';
  });
  const [page, setPage] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (filter !== 'all') params.set('type', filter);
    if (labelFilter !== 'all') params.set('label', labelFilter);
    if (view !== 'active') params.set('view', view);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, filter, labelFilter, view, pathname, router]);
  const [live, setLive] = useState(false);
  const [viewer, setViewer] = useState<QueueViewer>({ role: 'warehouse', can_send_emails: false });
  const [notify, setNotify] = useState<{ item: QueueItem; kind: NotificationKind } | null>(null);

  const knownIdsRef = useRef<Set<string>>(new Set());
  const firstLoadDoneRef = useRef(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { items: fetched, viewer: v } = await getQueue();
      setViewer(v);
      const ids = new Set(fetched.map((i) => i.id));

      if (!firstLoadDoneRef.current) {
        knownIdsRef.current = ids;
        firstLoadDoneRef.current = true;
        // Auto-select the first order that still needs work so the detail pane
        // isn't empty on arrival.
        setSelectedId((prev) => {
          if (prev && ids.has(prev)) return prev;
          const firstActive = fetched.find((i) => !isComplete(i.fulfillment_status));
          return firstActive?.id ?? fetched[0]?.id ?? null;
        });
      } else {
        const appeared = fetched
          .filter((i) => !knownIdsRef.current.has(i.id))
          .map((i) => i.id);
        knownIdsRef.current = ids;
        setNewIds((prev) => {
          const next = new Set<string>();
          for (const id of prev) if (ids.has(id)) next.add(id); // drop vanished
          for (const id of appeared) next.add(id);
          return next;
        });
      }

      setItems(fetched);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the fulfillment queue');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void load();
  }, [load]);

  // Live updates via Supabase Realtime — any change to invoices triggers a
  // debounced refetch so the queue stays current as orders flow in and get
  // fulfilled. Requires the warehouse RLS read policy + realtime publication
  // from warehouse-activity-migration.sql.
  useEffect(() => {
    const scheduleRefetch = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => void load(), 400);
    };

    const channel = supabase
      .channel('warehouse-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices' },
        scheduleRefetch,
      )
      .subscribe((status) => {
        setLive(String(status) === 'SUBSCRIBED');
      });

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const select = (id: string) => {
    setSelectedId(id);
    setNewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // On mobile the detail pane sits below the list — bring it into view when a
    // record is tapped so the info isn't off-screen. (lg breakpoint = 1024px.)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const handleAdvance = async (id: string, next: FulfillmentStatus) => {
    const nowIso = new Date().toISOString();
    // Optimistic: reflect the new status (and stamp who/when) immediately so the
    // card visibly moves to the completed group in real time. Realtime will
    // reconcile the authoritative name shortly after.
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              fulfillment_status: next,
              packed_at: next === 'packed' && !it.packed_at ? nowIso : it.packed_at,
              packed_by_name: next === 'packed' && !it.packed_at ? 'You' : it.packed_by_name,
              fulfilled_at: next === 'shipped' || next === 'picked_up' ? nowIso : it.fulfilled_at,
              fulfilled_by_name:
                next === 'shipped' || next === 'picked_up' ? 'You' : it.fulfilled_by_name,
            }
          : it,
      ),
    );
    try {
      await updateFulfillmentStatus(id, next);
    } catch (e: any) {
      // The server refuses to mark a shipment shipped without a generated
      // courier label. Offer an explicit, audited override for manual couriers.
      if (e?.code === 'label_not_generated') {
        const ok = window.confirm(
          'No courier label has been generated for this order. Mark it shipped anyway without a label? This will be recorded.',
        );
        if (ok) {
          try {
            await updateFulfillmentStatus(id, next, { overrideNoLabel: true });
            return;
          } catch (e2) {
            await load();
            throw e2;
          }
        }
      }
      // Revert by reloading the authoritative state.
      await load();
      throw e;
    }
  };

  // ----- Bulk selection -----------------------------------------------------
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Remove (or restore) every ticked invoice at once. Reuses the per-invoice
  // PATCH so each removal is audited exactly as a single remove would be.
  const bulkSetRemoved = async (removed: boolean) => {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(removed ? 'remove' : 'restore');
    // Optimistic: reflect the new removed state immediately so the cards move
    // between the active queue and the archive without waiting on the network.
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) =>
        selectedIds.has(it.id)
          ? { ...it, removed_from_queue: removed, removed_at: removed ? nowIso : null }
          : it,
      ),
    );
    try {
      const results = await Promise.allSettled(ids.map((id) => setQueueRemoved(id, removed)));
      if (results.some((r) => r.status === 'rejected')) {
        setError(`Some orders could not be ${removed ? 'removed' : 'restored'}.`);
      }
    } finally {
      setSelectedIds(new Set());
      setBulkBusy(null);
      await load();
    }
  };

  // The terminal ("shipped") status for an item depends on how it fulfils:
  // shipments become `shipped`, self-pickups become `picked_up`. The API
  // rejects the wrong pairing, so route each item to its own terminal status.
  const terminalStatusFor = (it: QueueItem): FulfillmentStatus =>
    it.fulfillment_type === 'shipment' ? 'shipped' : 'picked_up';

  // Bulk-advance every ticked invoice through the fulfillment flow. `pack` marks
  // each as Packed (which decrements stock server-side); `ship` moves each to
  // its terminal step. A still-pending order is packed first on the ship path so
  // the stock decrement — which only fires on the pack transition — never gets
  // skipped, exactly as the per-order flow does it.
  const bulkAdvance = async (kind: 'pack' | 'ship') => {
    if (selectedIds.size === 0 || bulkBusy) return;
    const targets = items.filter((it) => selectedIds.has(it.id));
    if (targets.length === 0) return;
    setBulkBusy(kind);
    // Optimistic: stamp the new status (and who/when) so cards visibly advance —
    // packed orders stay in the queue, shipped/picked-up ones drop to the archive.
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) => {
        if (!selectedIds.has(it.id)) return it;
        const next: FulfillmentStatus = kind === 'pack' ? 'packed' : terminalStatusFor(it);
        const nowPacked = (next === 'packed' || kind === 'ship') && !it.packed_at;
        return {
          ...it,
          fulfillment_status: next,
          packed_at: nowPacked ? nowIso : it.packed_at,
          packed_by_name: nowPacked ? 'You' : it.packed_by_name,
          fulfilled_at: kind === 'ship' ? nowIso : it.fulfilled_at,
          fulfilled_by_name: kind === 'ship' ? 'You' : it.fulfilled_by_name,
        };
      }),
    );
    try {
      const results = await Promise.allSettled(
        targets.map(async (it) => {
          if (kind === 'pack') {
            await updateFulfillmentStatus(it.id, 'packed');
            return;
          }
          // Ship: pack first if the order hasn't been packed yet, so stock is
          // decremented, then move it to its terminal status.
          if (!it.packed_at && it.fulfillment_status === 'pending') {
            await updateFulfillmentStatus(it.id, 'packed');
          }
          await updateFulfillmentStatus(it.id, terminalStatusFor(it));
        }),
      );
      if (results.some((r) => r.status === 'rejected')) {
        setError(`Some orders could not be marked ${kind === 'pack' ? 'packed' : 'shipped'}.`);
      }
    } finally {
      setSelectedIds(new Set());
      setBulkBusy(null);
      await load();
    }
  };

  // Which of the three queue tabs an item belongs to:
  //  • active  — still to pack (pending)
  //  • ship    — packed, waiting to ship / hand off
  //  • archive — fulfilled (shipped/picked up) or manually removed
  const categoryOf = useCallback(
    (it: QueueItem): 'active' | 'ship' | 'archive' => {
      if (it.removed_from_queue || isComplete(it.fulfillment_status)) return 'archive';
      if (it.fulfillment_status === 'packed') return 'ship';
      return 'active';
    },
    [],
  );

  // Tab counts — every card counts toward its tab (nothing is hidden).
  const counts = useMemo(() => {
    const c = { active: 0, ship: 0, archive: 0 };
    for (const it of items) {
      c[categoryOf(it)] += 1;
    }
    return c;
  }, [items, categoryOf]);
  const activeCount = counts.active;
  const shipCount = counts.ship;
  const archiveCount = counts.archive;

  const summary = useMemo(
    () =>
      items.reduce(
        (acc, it) => {
          if (it.removed_from_queue) {
            // Removed invoices are out of the active queue entirely.
          } else if (isComplete(it.fulfillment_status)) {
            acc.completed += 1;
          } else if (it.fulfillment_status === 'packed') {
            // Packed and waiting to ship / hand off.
            acc.toShip += 1;
          } else {
            // Still to pack.
            acc.toFulfill += 1;
          }
          return acc;
        },
        { toFulfill: 0, toShip: 0, completed: 0 },
      ),
    [items],
  );

  // Filter by type/label + customer-name search, then sort into contiguous day
  // groups (newest day first). Within a day: active first, then new orders,
  // then newest — so day dividers stay clean while workflow order is preserved.
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = items.filter((it) => {
      // Primary split: to-fulfil vs to-ship vs archive (fulfilled or removed).
      if (categoryOf(it) !== view) return false;
      if (filter !== 'all' && it.fulfillment_type !== filter) return false;
      if (labelFilter === 'with' && !(it.fulfillment_type === 'shipment' && it.has_label)) return false;
      if (labelFilter === 'without' && !(it.fulfillment_type === 'shipment' && !it.has_label)) return false;
      if (q) {
        const haystack = [
          it.customer_name ?? '',
          it.customer_email ?? '',
          it.invoice_number ?? '',
          it.order_number ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return [...visible].sort((a, b) => {
      // Primary: day of creation, newest day first (keeps day groups contiguous).
      const dayA = localDayKey(a.created_at);
      const dayB = localDayKey(b.created_at);
      if (dayA !== dayB) return dayB.localeCompare(dayA);
      // Within the same day: active before completed.
      const aDone = isComplete(a.fulfillment_status);
      const bDone = isComplete(b.fulfillment_status);
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (!aDone) {
        const aNew = newIds.has(a.id);
        const bNew = newIds.has(b.id);
        if (aNew !== bNew) return aNew ? -1 : 1;
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [items, view, filter, labelFilter, search, newIds, categoryOf]);

  // Reset to the first page (and drop any bulk selection) whenever the
  // view/filters/search change — the visible set is different now.
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [view, filter, labelFilter, search]);

  // When the active tab (view) changes, move the detail pane to an order that
  // actually belongs to that tab. Without this, a pending order selected under
  // "To Fulfill" would stay shown under "To Ship" — where its action button
  // still reads "Mark Packed" — even though it isn't in that list. `sorted`
  // recomputes for the new view before this effect runs, so sorted[0] is the
  // first order of the tab we just switched to.
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && sorted.some((it) => it.id === prev)) return prev;
      return sorted[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Select-all works over the whole filtered set (every matching order across
  // pages), not just the current page.
  const allVisibleSelected =
    sorted.length > 0 && sorted.every((it) => selectedIds.has(it.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (sorted.every((it) => next.has(it.id))) {
        sorted.forEach((it) => next.delete(it.id));
      } else {
        sorted.forEach((it) => next.add(it.id));
      }
      return next;
    });
  };

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const dayGroups = useMemo(() => groupByDay(paged, (it) => it.created_at), [paged]);
  const selected = items.find((it) => it.id === selectedId) ?? null;

  return (
    <>
      {/* Heading */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
            <PackageCheck className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink flex items-center gap-2">
              Fulfillment Queue
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  live ? 'bg-emerald-500/10 text-emerald-600' : 'bg-ink-light/10 text-ink-muted'
                }`}
                title={live ? 'Live updates on' : 'Connecting to live updates…'}
              >
                <Radio className={`w-3 h-3 ${live ? '' : 'opacity-50'}`} /> {live ? 'Live' : '…'}
              </span>
            </h1>
            <p className="text-xs text-ink-muted">Pack and ship or hand off every order — grouped by day, drafts included.</p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink transition-colors shrink-0"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <SummaryCard label="To fulfill" value={summary.toFulfill} icon={Boxes} tint="indigo" loading={loading} />
        <SummaryCard label="To ship" value={summary.toShip} icon={Truck} tint="blue" loading={loading} />
        <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} tint="emerald" loading={loading} />
      </div>

      {error ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center">
          <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-ink-muted mb-4">{error}</p>
          <button onClick={() => void load()} className="text-sm text-indigo-600 hover:underline">Try again</button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5 items-start">
          {/* LEFT — order queue */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-line p-3 lg:sticky lg:top-4">
            {/* View tabs — to pack → to ship → fulfilled/removed archive */}
            <div className="grid grid-cols-3 gap-1 p-1 mb-3 rounded-lg bg-surface">
              {([
                { key: 'active', label: 'To Fulfill', count: activeCount },
                { key: 'ship', label: 'To Ship', count: shipCount },
                { key: 'archive', label: 'Fulfilled / Removed', count: archiveCount },
              ] as const).map(({ key, label, count }) => {
                const on = view === key;
                return (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      on ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[1.1rem] px-1 rounded-full text-[10px] font-bold ${
                        on ? 'bg-ink text-white' : 'bg-white text-ink-muted border border-line'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filter chips */}
            <div className="flex gap-1.5 mb-3">
              {FILTERS.map(({ key, label, icon: Icon }) => {
                const on = filter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      on ? 'bg-ink text-white' : 'bg-surface text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                );
              })}
            </div>

            {/* Label filter — only meaningful for shipments */}
            {filter !== 'pickup' && (
              <div className="flex gap-1.5 mb-3">
                {([
                  { key: 'all', label: 'Any label' },
                  { key: 'with', label: 'Label ready' },
                  { key: 'without', label: 'Needs label' },
                ] as const).map(({ key, label }) => {
                  const on = labelFilter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setLabelFilter(key)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        on ? 'bg-indigo-500 text-white' : 'bg-surface text-ink-muted hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search by customer name */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer name…"
                className="w-full pl-9 pr-8 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Bulk selection controls */}
            {!loading && sorted.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between gap-2 px-1">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink transition-colors"
                  >
                    <CheckSquare className={`w-3.5 h-3.5 ${allVisibleSelected ? 'text-indigo-600' : 'text-line'}`} />
                    {allVisibleSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      disabled={!!bulkBusy}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
                {selectedIds.size > 0 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-indigo-50 border border-indigo-200">
                    <div className="flex items-center gap-1.5 mb-2.5 px-0.5">
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="text-xs font-semibold text-indigo-700">
                        {selectedIds.size} selected
                      </span>
                    </div>
                    {view === 'archive' ? (
                      <button
                        type="button"
                        onClick={() => void bulkSetRemoved(false)}
                        disabled={!!bulkBusy}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-ink text-white hover:bg-ink/90 disabled:opacity-50 transition-colors"
                      >
                        {bulkBusy === 'restore' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        Restore to queue
                      </button>
                    ) : (
                      <div className="space-y-2">
                        {/* Advance the whole selection through the flow. In the
                            To Ship view the cards are already packed, so only
                            the ship step remains. */}
                        {view === 'active' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => void bulkAdvance('pack')}
                              disabled={!!bulkBusy}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                              {bulkBusy === 'pack' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
                              Pack
                            </button>
                            <button
                              type="button"
                              onClick={() => void bulkAdvance('ship')}
                              disabled={!!bulkBusy}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {bulkBusy === 'ship' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                              Ship
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void bulkAdvance('ship')}
                            disabled={!!bulkBusy}
                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            {bulkBusy === 'ship' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                            Ship
                          </button>
                        )}
                        {/* Destructive action, set apart from the flow buttons. */}
                        <button
                          type="button"
                          onClick={() => void bulkSetRemoved(true)}
                          disabled={!!bulkBusy}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {bulkBusy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          Remove from queue
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto pr-0.5">
              {loading ? (
                [...Array(6)].map((_, i) => <RowSkeleton key={i} />)
              ) : sorted.length === 0 ? (
                <div className="py-12 text-center">
                  <PackageCheck className="w-7 h-7 text-line mx-auto mb-2" />
                  <p className="text-xs text-ink-muted">
                    {search.trim()
                      ? 'No orders match your search.'
                      : view === 'archive'
                        ? 'No fulfilled or removed orders yet.'
                        : view === 'ship'
                          ? 'Nothing packed and waiting to ship.'
                          : 'Nothing to fulfill right now.'}
                  </p>
                </div>
              ) : (
                dayGroups.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <div className="pt-1 pb-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                        {group.label}
                      </span>
                      <span className="inline-flex items-center justify-center min-w-[1.1rem] px-1 rounded-full text-[9px] font-semibold bg-surface text-ink-muted border border-line">
                        {group.items.length}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                    {group.items.map((item) => (
                      <QueueRow
                        key={item.id}
                        item={item}
                        selected={item.id === selectedId}
                        isNew={newIds.has(item.id)}
                        onSelect={select}
                        checked={selectedIds.has(item.id)}
                        onToggleCheck={toggleSelect}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>

            {!loading && sorted.length > 0 && (
              <Pagination
                page={safePage}
                pageCount={pageCount}
                onPageChange={setPage}
                total={sorted.length}
                pageSize={PAGE_SIZE}
              />
            )}
          </div>

          {/* RIGHT (main) — detail + instructions */}
          <div
            ref={detailRef}
            className="lg:col-span-2 bg-white rounded-xl border border-line min-h-[400px] scroll-mt-4"
          >
            {loading ? (
              <DetailSkeleton />
            ) : (
              <QueueDetail
                item={selected}
                canSendEmails={viewer.can_send_emails}
                onAdvance={handleAdvance}
                onNotify={(item, kind) => setNotify({ item, kind })}
                onRefresh={load}
              />
            )}
          </div>
        </div>
      )}

      {notify && (
        <FulfillmentEmailModal
          invoiceId={notify.item.id}
          kind={notify.kind}
          fulfillmentType={notify.item.fulfillment_type}
          onClose={() => setNotify(null)}
          onSent={() => void load()}
        />
      )}
    </>
  );
}

export default function WarehouseDashboardPage() {
  // WarehouseDashboard reads the URL via useSearchParams, which Next requires to
  // sit inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <WarehouseDashboard />
    </Suspense>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tint,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tint: 'indigo' | 'blue' | 'amber' | 'emerald';
  loading: boolean;
}) {
  const tints: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-500',
    blue: 'bg-blue-500/10 text-blue-500',
    amber: 'bg-amber-500/10 text-amber-600',
    emerald: 'bg-emerald-500/10 text-emerald-500',
  };
  return (
    <div className="bg-white rounded-xl p-4 border border-line">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tints[tint]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-12 bg-surface rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-ink tabular-nums">{value}</p>
      )}
      <p className="text-xs text-ink-muted mt-0.5">{label}</p>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="rounded-lg border border-line p-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-surface" />
        <div className="h-3 w-20 bg-surface rounded" />
        <div className="ml-auto h-3 w-10 bg-surface rounded" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="h-3 w-28 bg-surface rounded" />
        <div className="h-4 w-16 bg-surface rounded-full" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-24 bg-surface rounded-full" />
        <div className="h-4 w-20 bg-surface rounded" />
      </div>
      <div className="h-6 w-40 bg-surface rounded mb-2" />
      <div className="h-3 w-56 bg-surface rounded mb-6" />
      <div className="h-12 w-full bg-surface rounded mb-4" />
      <div className="space-y-2 mb-6">
        <div className="h-3 w-full bg-surface rounded" />
        <div className="h-3 w-5/6 bg-surface rounded" />
        <div className="h-3 w-4/6 bg-surface rounded" />
      </div>
      <div className="h-10 w-40 bg-surface rounded-lg" />
    </div>
  );
}
