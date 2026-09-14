'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageX, ExternalLink, Wrench, Loader2, ClipboardList, Trash2, CheckCircle2, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canDelete } from '@/lib/permissions';
import ConfirmDeleteDialog from '@/components/admin/ConfirmDeleteDialog';

type Tab = 'open' | 'handled' | 'fulfilled';

const TAB_LABEL: Record<Tab, string> = { open: 'Open', handled: 'Handled', fulfilled: 'History' };

interface BackorderRow {
  id: string;
  status: string;
  created_at: string;
  fulfilled_at: string | null;
  handled_at: string | null;
  invoice_id: string;
  invoice: { id: string; invoice_number: string; total: number; status: string } | null;
  purchase_order: { id: string; po_number: string; status: string } | null;
  items: Array<{ id: string; description: string; qty_ordered: number; qty_available: number; qty_backordered: number }>;
  customer_name_display: string | null;
  customer_email_display: string | null;
  item_count: number;
  total_backordered: number;
}

export default function BackordersPage() {
  const router = useRouter();
  const role = useUserRole();
  const canRemove = canDelete(role);
  const [tab, setTab] = useState<Tab>('open');
  const [rows, setRows] = useState<BackorderRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Delete-confirm state (admin only).
  const [deleteTarget, setDeleteTarget] = useState<BackorderRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Row currently being moved between open <-> handled.
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async (status: Tab) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/backorders?status=${status}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) { setRows([]); return; }
      const { backorders } = await res.json();
      setRows(backorders ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const itemsSummary = (r: BackorderRow) =>
    r.items.map((i) => `${i.description} ×${i.qty_backordered}`).join(', ');

  // Move a backorder between "open" and "handled". Only this backorder's own
  // status changes — the invoice, purchase order and stock are untouched.
  const moveTo = async (r: BackorderRow, status: 'handled' | 'open') => {
    setMovingId(r.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/backorders/${r.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      // Row leaves the current tab; drop it from the list.
      setRows((rs) => rs.filter((row) => row.id !== r.id));
    } catch {
      /* non-fatal */
    } finally {
      setMovingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/backorders/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not delete backorder');
      }
      setRows((rs) => rs.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setDeleteError(e?.message ?? 'Could not delete backorder');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <PackageX className="w-6 h-6 text-bronze" /> Backorders
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Invoice line items ordered beyond available stock.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-line">
        {(['open', 'handled', 'fulfilled'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-bronze text-bronze' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Table (desktop ≥lg) / cards (mobile) — per ADR 0007. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-line">
                {['Invoice', 'Customer', 'Backordered items', 'Invoice total', 'Invoice status',
                  tab === 'open' ? 'Created' : tab === 'handled' ? 'Handled' : 'Fulfilled', ''].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                  {tab === 'open'
                    ? 'No open backorders 🎉'
                    : tab === 'handled'
                    ? 'No handled backorders yet'
                    : 'No fulfilled backorders yet'}
                </td></tr>
              ) : rows.map((r) => {
                const meta = r.invoice ? INVOICE_STATUS_META[r.invoice.status as keyof typeof INVOICE_STATUS_META] : null;
                return (
                  <tr key={r.id} className="hover:bg-surface transition-colors align-top">
                    <td className="px-5 py-4 whitespace-nowrap">
                      {r.invoice ? (
                        <Link href={`/admin/invoices/${r.invoice.id}`} className="font-mono text-sm text-ink hover:text-bronze">
                          {r.invoice.invoice_number}
                        </Link>
                      ) : <span className="text-ink-muted text-sm">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-sm text-ink">{r.customer_name_display ?? '—'}</div>
                      {r.customer_email_display && (
                        <div className="text-xs text-ink-muted break-all">{r.customer_email_display}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 max-w-xs">
                      <div className="text-sm text-ink">{r.item_count} item{r.item_count !== 1 ? 's' : ''} · {r.total_backordered} unit{r.total_backordered !== 1 ? 's' : ''}</div>
                      <div className="text-xs text-ink-muted break-words">{itemsSummary(r)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink tabular-nums whitespace-nowrap">
                      {r.invoice ? `$${Number(r.invoice.total).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-4">
                      {meta ? (
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">
                      {tab === 'open'
                        ? new Date(r.created_at).toLocaleDateString()
                        : tab === 'handled'
                        ? r.handled_at ? new Date(r.handled_at).toLocaleDateString() : '—'
                        : r.fulfilled_at ? new Date(r.fulfilled_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {tab === 'open' ? (
                          <>
                            <button
                              onClick={() => router.push(`/admin/purchase-orders/new?backorder=${r.id}`)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-xs font-medium"
                            >
                              <Wrench className="w-3.5 h-3.5" /> Fulfill
                            </button>
                            <button
                              onClick={() => moveTo(r, 'handled')}
                              disabled={movingId === r.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium disabled:opacity-50"
                              title="Mark this backorder as handled"
                            >
                              {movingId === r.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <CheckCircle2 className="w-3.5 h-3.5" />} Mark handled
                            </button>
                          </>
                        ) : tab === 'handled' ? (
                          <button
                            onClick={() => moveTo(r, 'open')}
                            disabled={movingId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium disabled:opacity-50"
                            title="Move this backorder back to Open"
                          >
                            {movingId === r.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Undo2 className="w-3.5 h-3.5" />} Reopen
                          </button>
                        ) : r.purchase_order ? (
                          <Link
                            href={`/admin/purchase-orders/${r.purchase_order.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium"
                            title="View fulfilling purchase order"
                          >
                            <ClipboardList className="w-3.5 h-3.5" /> {r.purchase_order.po_number}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-muted inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> PO removed</span>
                        )}
                        {canRemove && (
                          <button
                            onClick={() => { setDeleteError(''); setDeleteTarget(r); }}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line text-ink-muted hover:text-red-600 hover:border-red-200 transition-colors"
                            title="Delete backorder"
                            aria-label="Delete backorder"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) — same rows, actions and handlers. ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              {tab === 'open'
                ? 'No open backorders 🎉'
                : tab === 'handled'
                ? 'No handled backorders yet'
                : 'No fulfilled backorders yet'}
            </div>
          ) : (
            <ul className="divide-y divide-line/50">
              {rows.map((r) => {
                const meta = r.invoice ? INVOICE_STATUS_META[r.invoice.status as keyof typeof INVOICE_STATUS_META] : null;
                const dateLabel = tab === 'open' ? 'Created' : tab === 'handled' ? 'Handled' : 'Fulfilled';
                const dateVal = tab === 'open'
                  ? new Date(r.created_at).toLocaleDateString()
                  : tab === 'handled'
                  ? (r.handled_at ? new Date(r.handled_at).toLocaleDateString() : '—')
                  : (r.fulfilled_at ? new Date(r.fulfilled_at).toLocaleDateString() : '—');
                return (
                  <li key={r.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {r.invoice ? (
                          <Link href={`/admin/invoices/${r.invoice.id}`} className="font-mono text-sm text-ink hover:text-bronze">
                            {r.invoice.invoice_number}
                          </Link>
                        ) : <span className="text-ink-muted text-sm">—</span>}
                        <div className="text-sm text-ink mt-0.5">{r.customer_name_display ?? '—'}</div>
                        {r.customer_email_display && (
                          <div className="text-xs text-ink-muted break-all">{r.customer_email_display}</div>
                        )}
                      </div>
                      {meta && (
                        <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-ink">
                      {r.item_count} item{r.item_count !== 1 ? 's' : ''} · {r.total_backordered} unit{r.total_backordered !== 1 ? 's' : ''}
                    </div>
                    <div className="text-xs text-ink-muted break-words">{itemsSummary(r)}</div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                      {r.invoice && <span>Total <span className="text-ink font-semibold tabular-nums">${Number(r.invoice.total).toFixed(2)}</span></span>}
                      <span>{dateLabel} <span className="text-ink">{dateVal}</span></span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {tab === 'open' ? (
                        <>
                          <button
                            onClick={() => router.push(`/admin/purchase-orders/new?backorder=${r.id}`)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-ink hover:bg-ink/90 text-white rounded-lg text-xs font-medium"
                          >
                            <Wrench className="w-3.5 h-3.5" /> Fulfill
                          </button>
                          <button
                            onClick={() => moveTo(r, 'handled')}
                            disabled={movingId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium disabled:opacity-50"
                            title="Mark this backorder as handled"
                          >
                            {movingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Mark handled
                          </button>
                        </>
                      ) : tab === 'handled' ? (
                        <button
                          onClick={() => moveTo(r, 'open')}
                          disabled={movingId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium disabled:opacity-50"
                          title="Move this backorder back to Open"
                        >
                          {movingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Reopen
                        </button>
                      ) : r.purchase_order ? (
                        <Link
                          href={`/admin/purchase-orders/${r.purchase_order.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-xs font-medium"
                          title="View fulfilling purchase order"
                        >
                          <ClipboardList className="w-3.5 h-3.5" /> {r.purchase_order.po_number}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-muted inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> PO removed</span>
                      )}
                      {canRemove && (
                        <button
                          onClick={() => { setDeleteError(''); setDeleteTarget(r); }}
                          className="ml-auto inline-flex items-center justify-center w-10 h-10 rounded-lg border border-line text-ink-muted hover:text-red-600 hover:border-red-200 transition-colors"
                          title="Delete backorder"
                          aria-label="Delete backorder"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDeleteDialog
          title="Delete backorder?"
          confirmLabel="Delete backorder"
          loading={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          message={
            <>
              This permanently removes the backorder for{' '}
              <span className="font-medium text-ink">
                {deleteTarget.invoice?.invoice_number ?? 'this invoice'}
              </span>{' '}
              ({deleteTarget.item_count} item{deleteTarget.item_count !== 1 ? 's' : ''}). The invoice and any
              linked purchase order are not affected.
            </>
          }
        />
      )}
    </>
  );
}
