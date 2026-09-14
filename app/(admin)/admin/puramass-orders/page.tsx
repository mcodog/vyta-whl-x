'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, ExternalLink, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

interface PuramassOrderItem {
  sku?: string;
  quantity?: number;
  /** Present on invoice hand-offs, which name their own price per unit. */
  unit_price_cents?: number;
}

interface PuramassOrderRow {
  id: string;
  partner_reference: string;
  transaction_id: string | null;
  payment_link: string | null;
  status: string;
  subtotal_cents: number | null;
  currency?: string | null;
  paid_at?: string | null;
  customer_email: string | null;
  items: PuramassOrderItem[] | null;
  referral_code: string | null;
  created_at: string;
}

const PAGE_SIZE = 25;

function money(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return `$${(cents / 100).toFixed(2)} USD`;
}

function statusClasses(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('paid') || s.includes('complete') || s.includes('fulfill'))
    return 'bg-green-50 text-green-700 border-green-200';
  if (s.includes('pending')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (s.includes('cancel') || s.includes('fail') || s.includes('expire'))
    return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-surface text-ink-muted border-line';
}

export default function PuramassOrdersPage() {
  const toast = useToast();
  const [orders, setOrders] = useState<PuramassOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  // transaction_ids currently being refreshed via the polling endpoint.
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          toast.error('Not authenticated');
          return;
        }
        const res = await fetch(
          `/api/admin/puramass/orders?page=${p}&pageSize=${PAGE_SIZE}`,
          { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load');
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setPage(data.page ?? p);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load PuraMass orders');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  // Poll PuraMass for one order's current status and update the row in place.
  const refreshRow = useCallback(
    async (transactionId: string) => {
      setRefreshing((s) => new Set(s).add(transactionId));
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          toast.error('Not authenticated');
          return;
        }
        const res = await fetch('/api/admin/puramass/orders/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ transaction_id: transactionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Refresh failed');
        setOrders((rows) =>
          rows.map((r) =>
            r.transaction_id === transactionId
              ? { ...r, status: data.status ?? r.status, paid_at: data.paid_at ?? r.paid_at }
              : r,
          ),
        );
        toast.success(`Status: ${data.status}`);
      } catch (err: any) {
        toast.error(err.message || 'Refresh failed');
      } finally {
        setRefreshing((s) => {
          const n = new Set(s);
          n.delete(transactionId);
          return n;
        });
      }
    },
    [toast],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-ink" />
          <h1 className="text-xl sm:text-2xl font-bold text-ink">PuraMass Orders</h1>
        </div>
        <button
          onClick={() => load(page)}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-ink-muted mb-6">
        Hosted-checkout hand-offs sent to PuraMass. Each row ties our reference to
        the PuraMass transaction and payment link. Live payment/fulfilment status
        lives in the PuraMass portal — this is the local reconciliation record.
      </p>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface/50 text-left text-ink-muted">
                <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Subtotal</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Transaction</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Referral</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-ink-muted">
                    No PuraMass orders yet. Hand-offs appear here once customers
                    proceed through the hosted checkout.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface/40 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-ink">
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-ink">{o.customer_email || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {Array.isArray(o.items) && o.items.length ? (
                        <ul className="space-y-0.5">
                          {o.items.map((it, i) => (
                            <li key={i} className="whitespace-nowrap">
                              <span className="font-mono text-xs">{it.sku}</span>
                              <span className="text-ink-muted"> × {it.quantity}</span>
                              {typeof it.unit_price_cents === 'number' && (
                                <span className="text-ink-muted">
                                  {' '}
                                  @ {money(it.unit_price_cents)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink">
                      {money(o.subtotal_cents)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs border ${statusClasses(o.status)}`}
                      >
                        {o.status}
                      </span>
                      {o.paid_at && (
                        <div className="text-[11px] text-ink-muted mt-1 whitespace-nowrap">
                          paid {new Date(o.paid_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {o.payment_link ? (
                        <a
                          href={o.payment_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-bronze hover:underline font-mono text-xs"
                          title={o.transaction_id || undefined}
                        >
                          {o.transaction_id
                            ? `${o.transaction_id.slice(0, 10)}…`
                            : 'link'}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-ink-muted">
                          {o.transaction_id || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted" title={o.partner_reference}>
                      {o.partner_reference.slice(0, 12)}…
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{o.referral_code || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {o.transaction_id ? (
                        <button
                          onClick={() => refreshRow(o.transaction_id as string)}
                          disabled={refreshing.has(o.transaction_id)}
                          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50 transition-colors"
                          title="Poll PuraMass for the latest status"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${refreshing.has(o.transaction_id) ? 'animate-spin' : ''}`}
                          />
                          Refresh
                        </button>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-line text-sm text-ink-muted">
          <span>
            {total} order{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={loading || page <= 0}
              className="p-1.5 rounded-lg border border-line disabled:opacity-40 hover:bg-surface transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {page + 1} of {pageCount}
            </span>
            <button
              onClick={() => load(page + 1)}
              disabled={loading || page + 1 >= pageCount}
              className="p-1.5 rounded-lg border border-line disabled:opacity-40 hover:bg-surface transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
