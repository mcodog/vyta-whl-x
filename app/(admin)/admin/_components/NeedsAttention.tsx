'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PackageX,
  Boxes,
  AlertTriangle,
  ArrowRight,
  Trash2,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  getLowStockProducts,
  getAutoShipmentFailures,
  deleteAutoShipmentFailure,
  clearAutoShipmentFailures,
  type LowStockProduct,
  type AutoShipmentLog,
} from '@/lib/admin/api';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canDelete } from '@/lib/permissions';

const PREVIEW = 5;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * The dashboard "Needs attention" section — a single, calm home for the two
 * standing action items an admin should notice: products to restock and
 * auto-shipment failures. Replaces the two stacked color-filled banners.
 *
 * Design: white cards on the neutral line color; red/amber appear only as
 * accents (an icon, a count, the "N left" number) — never as a filled box.
 * Items are shown inline (not hidden behind a collapse) with a "view all" link.
 */
export default function NeedsAttention() {
  const role = useUserRole();
  const mayDelete = canDelete(role);

  const lowStock = useSmartLoad(() => getLowStockProducts(), []);
  const failuresLoad = useSmartLoad(() => getAutoShipmentFailures(15), []);

  // Local mirror so dismiss/clear reflect immediately.
  const [failures, setFailures] = useState<AutoShipmentLog[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (failuresLoad.data) setFailures(failuresLoad.data);
  }, [failuresLoad.data]);

  const products: LowStockProduct[] = lowStock.data ?? [];
  const loading = lowStock.loading || failuresLoad.loading;

  const dismissOne = async (id: string) => {
    setBusyId(id);
    const prev = failures;
    setFailures((list) => list.filter((f) => f.id !== id));
    try {
      await deleteAutoShipmentFailure(id);
    } catch {
      setFailures(prev);
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    const prev = failures;
    setFailures([]);
    try {
      await clearAutoShipmentFailures();
    } catch {
      setFailures(prev);
    } finally {
      setClearing(false);
    }
  };

  const total = products.length + failures.length;

  return (
    <section className="mb-4">
      {/* Section header */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light">
          Needs attention
        </h2>
        {total > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-vital/12 text-vital text-[11px] font-bold leading-none tabular-nums">
            {total}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : total === 0 ? (
        <AllClear />
      ) : (
        <div
          className={`grid grid-cols-1 gap-4 ${
            products.length > 0 && failures.length > 0 ? 'md:grid-cols-2' : ''
          }`}
        >
          {/* Auto-shipment failures */}
          {failures.length > 0 && (
            <Panel
              icon={<PackageX className="h-5 w-5 text-red-500" />}
              title="Auto-shipment failures"
              subtitle="Shipment/label creation failed — retry manually"
              count={failures.length}
              countClass="text-red-600"
              action={
                <div className="flex items-center gap-1">
                  {mayDelete && (
                    <button
                      type="button"
                      onClick={clearAll}
                      disabled={clearing}
                      title="Clear all failures"
                      aria-label="Clear all auto-shipment failures"
                      className="p-1.5 rounded-lg text-ink-muted hover:text-red-600 hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                  <Link
                    href="/admin/orders"
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
                  >
                    Orders <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              }
              footer={
                failures.length > PREVIEW ? (
                  <Link
                    href="/admin/orders"
                    className="flex items-center justify-between px-5 py-2.5 text-xs text-ink-muted hover:bg-surface transition-colors"
                  >
                    <span>+{failures.length - PREVIEW} more</span>
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      View all <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                ) : null
              }
            >
              {failures.slice(0, PREVIEW).map((f) => {
                const inner = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <span className="font-mono truncate">{f.order_number || 'Unknown order'}</span>
                        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                          {f.stage === 'label' ? 'Label' : 'Shipment'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
                        <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />
                        <span className="truncate">{f.error || 'Unknown error'}</span>
                      </div>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-ink-light">{timeAgo(f.created_at)}</span>
                  </>
                );
                return (
                  <li key={f.id} className="flex items-center gap-2 px-5">
                    {f.order_id ? (
                      <Link
                        href={`/admin/orders/${f.order_id}`}
                        className="-mx-2 flex flex-1 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface min-w-0"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex flex-1 items-center gap-3 py-2.5 min-w-0">{inner}</div>
                    )}
                    {mayDelete && (
                      <button
                        type="button"
                        onClick={() => dismissOne(f.id)}
                        disabled={busyId === f.id}
                        title="Dismiss this failure"
                        aria-label={`Dismiss auto-shipment failure for ${f.order_number || 'order'}`}
                        className="shrink-0 rounded-lg p-1.5 text-ink-light hover:text-red-600 hover:bg-surface transition-colors disabled:opacity-50"
                      >
                        {busyId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </li>
                );
              })}
            </Panel>
          )}

          {/* Restock needed */}
          {products.length > 0 && (
            <Panel
              icon={<Boxes className="h-5 w-5 text-amber-600" />}
              title="Restock needed"
              subtitle="At or below the low-stock threshold"
              count={products.length}
              countClass="text-amber-700"
              action={
                <Link
                  href="/admin/products"
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
                >
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              footer={
                products.length > PREVIEW ? (
                  <Link
                    href="/admin/products"
                    className="flex items-center justify-between px-5 py-2.5 text-xs text-ink-muted hover:bg-surface transition-colors"
                  >
                    <span>+{products.length - PREVIEW} more</span>
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      View all <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                ) : null
              }
            >
              {products.slice(0, PREVIEW).map((p) => {
                const out = p.stock_quantity <= 0;
                return (
                  <li key={p.id}>
                    <Link
                      href="/admin/products"
                      className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink">{p.name}</div>
                        {p.strength && <div className="text-xs text-ink-muted">{p.strength}</div>}
                      </div>
                      <div className="whitespace-nowrap text-right">
                        <span className={`text-sm font-semibold tabular-nums ${out ? 'text-red-600' : 'text-amber-700'}`}>
                          {out ? 'Out of stock' : `${p.stock_quantity} left`}
                        </span>
                        <span className="text-xs text-ink-light"> / {p.low_stock_threshold}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </Panel>
          )}
        </div>
      )}
    </section>
  );
}

/* A single attention card: white surface, neutral borders, accent-only color. */
function Panel({
  icon,
  title,
  subtitle,
  count,
  countClass,
  action,
  footer,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  countClass: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <span className="truncate">{title}</span>
            <span className={`text-sm font-bold tabular-nums ${countClass}`}>{count}</span>
          </h3>
          <p className="truncate text-xs text-ink-muted">{subtitle}</p>
        </div>
        {action}
      </header>
      <ul className="divide-y divide-line/60">{children}</ul>
      {footer}
    </div>
  );
}

function AllClear() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      <p className="text-sm text-ink">
        <span className="font-semibold">All caught up</span>
        <span className="text-ink-muted"> — no restocks or shipment failures need attention.</span>
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white animate-pulse">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-surface" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-40 rounded bg-surface" />
          <div className="h-2.5 w-28 rounded bg-surface" />
        </div>
      </div>
      <div className="space-y-3 px-5 py-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-3 w-36 rounded bg-surface" />
            <div className="h-3 w-12 rounded bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
