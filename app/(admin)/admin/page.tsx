'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getAllOrders } from '@/lib/admin/api';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { LoadingError } from '@/components/LoadingFeedback';
import { useUserRole } from '@/app/(admin)/admin/layout';
import AffiliateDashboard from './_components/AffiliateDashboard';
import FulfillmentAlerts from './_components/FulfillmentAlerts';
import NeedsAttention from './_components/NeedsAttention';
import DashboardOverview from './_components/DashboardOverview';
import WarehouseTail from './_components/WarehouseTail';
import GuidesStrip from './_components/GuidesStrip';

// Status color rides on a small dot only (an accent); the row stays neutral.
const statusDot: Record<string, string> = {
  pending: 'bg-amber-500',
  paid: 'bg-blue-500',
  processing: 'bg-purple-500',
  shipped: 'bg-indigo-500',
  delivered: 'bg-emerald-500',
  cancelled: 'bg-red-500',
};

export default function AdminDashboard() {
  const role = useUserRole();
  // Affiliates get a trimmed dashboard scoped to their own customers/earnings.
  if (role === 'affiliate') return <AffiliateDashboard />;
  return <FullAdminDashboard />;
}

function FullAdminDashboard() {
  return (
    <>
      {/* Compact header */}
      <div className="mb-3">
        <h1 className="text-lg sm:text-xl font-bold text-ink leading-tight">Dashboard</h1>
        <p className="text-xs text-ink-muted">Orders, revenue, affiliates and fulfillment at a glance.</p>
      </div>

      {/* Slim, low-focus guides strip */}
      <GuidesStrip />

      {/* Live fulfillment activity (packed/shipped) with quick notify — transient */}
      <FulfillmentAlerts />

      {/* KPI strip + revenue / affiliates / products charts */}
      <DashboardOverview />

      {/* Standing action items: restock + auto-shipment failures */}
      <div className="mt-4">
        <NeedsAttention />
      </div>

      {/* Bottom row: warehouse live tail + recent orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WarehouseTail />
        <RecentOrders />
      </div>
    </>
  );
}

function RecentOrders() {
  const orders = useSmartLoad(() => getAllOrders().then((o) => o.slice(0, 7)), []);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-sm font-bold text-ink">Recent orders</h3>
        <Link href="/admin/orders" className="inline-flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="scrollbar-hide max-h-72 min-h-[8rem] flex-1 overflow-y-auto">
        {orders.error ? (
          <LoadingError onRetry={orders.reload} />
        ) : orders.loading ? (
          <ul className="divide-y divide-line/50">
            {[...Array(5)].map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-surface" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 rounded bg-surface" />
                </div>
                <div className="h-3 w-12 rounded bg-surface" />
              </li>
            ))}
          </ul>
        ) : (orders.data ?? []).length === 0 ? (
          <div className="flex h-32 items-center justify-center text-center text-xs text-ink-muted">No orders yet</div>
        ) : (
          <ul className="divide-y divide-line/50">
            {(orders.data ?? []).map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[order.status] || 'bg-ink-light'}`}
                    title={order.status}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      <span className="font-mono">{order.order_number}</span>
                      <span className="text-ink-muted"> · {order.customer_name || 'Guest'}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                    ${order.total?.toFixed(2)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
