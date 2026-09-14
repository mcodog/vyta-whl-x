'use client';

import React, { useMemo, useState } from 'react';
import { PackageCheck, History, Plus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { PurchaseOrder } from '@/lib/supabase';
import { receivePurchaseOrderItems } from '@/lib/admin/purchase-orders';
import { canReceivePo } from '@/lib/admin/po-status';

interface Props {
  po: PurchaseOrder;
  onChanged: () => void;
}

export default function PurchaseOrderReceiving({ po, onChanged }: Props) {
  const items = po.items ?? [];
  const receipts = useMemo(
    () =>
      [...(po.receipts ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [po.receipts],
  );

  const itemById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const i of items) map[i.id] = i.description;
    return map;
  }, [items]);

  // Vials in one box for a line (defaults to 10 when the product isn't joined).
  const vialsPerBox = (i: (typeof items)[number]) =>
    Math.max(1, Number(i.product?.vials_per_box ?? 10));
  // Convert a received quantity (in the line's unit) to the vials it adds to
  // stock: box lines multiply by vials-per-box, vial lines are already vials.
  const toVials = (i: (typeof items)[number], qty: number) =>
    i.price_type === 'box' ? qty * vialsPerBox(i) : qty;

  const totals = useMemo(() => {
    const ordered = items.reduce((s, i) => s + Number(i.qty), 0);
    const received = items.reduce((s, i) => s + Number(i.qty_received ?? 0), 0);
    const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
    return { ordered, received, remaining: ordered - received, pct };
  }, [items]);

  const fullyReceived = totals.remaining <= 0 && totals.ordered > 0;
  const canReceive = canReceivePo(po.status) && !fullyReceived;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startReceiving = (fillRemaining: boolean) => {
    const next: Record<string, string> = {};
    for (const i of items) {
      const remaining = Number(i.qty) - Number(i.qty_received ?? 0);
      next[i.id] = fillRemaining && remaining > 0 ? String(remaining) : '';
    }
    setDraft(next);
    setNote('');
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    const payloadItems = items
      .map((i) => {
        const remaining = Number(i.qty) - Number(i.qty_received ?? 0);
        const qty = Math.floor(Number(draft[i.id]));
        return { po_item_id: i.id, qty, remaining };
      })
      .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

    if (payloadItems.length === 0) {
      setError('Enter at least one quantity to receive.');
      return;
    }
    const over = payloadItems.find((x) => x.qty > x.remaining);
    if (over) {
      setError(`"${itemById[over.po_item_id]}" only has ${over.remaining} remaining.`);
      return;
    }

    setSubmitting(true);
    try {
      await receivePurchaseOrderItems(po.id, {
        note: note.trim() || null,
        items: payloadItems.map(({ po_item_id, qty }) => ({ po_item_id, qty })),
      });
      setOpen(false);
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not record receipt');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Completion summary */}
      <div className="bg-white rounded-xl border border-line p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-vital" /> Receiving
          </h3>
          <span className="text-sm font-semibold text-ink tabular-nums">
            {totals.pct}% complete
          </span>
        </div>

        <div className="h-2 w-full rounded-full bg-surface overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${fullyReceived ? 'bg-emerald-500' : 'bg-vital'}`}
            style={{ width: `${totals.pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {totals.received} of {totals.ordered} units received
          {totals.remaining > 0 && ` · ${totals.remaining} remaining`}
        </p>

        {/* Per-line breakdown (desktop table ≥lg / mobile cards) — ADR 0007. */}
        <div className="mt-4 hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted uppercase tracking-wider">
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2">Ordered</th>
                <th className="text-right py-2">Received</th>
                <th className="text-right py-2">Remaining</th>
                <th className="text-left py-2 pl-4 w-32">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {items.map((i) => {
                const received = Number(i.qty_received ?? 0);
                const remaining = Number(i.qty) - received;
                const pct = Number(i.qty) > 0 ? Math.round((received / Number(i.qty)) * 100) : 0;
                return (
                  <tr key={i.id}>
                    <td className="py-2 text-ink">
                      <div>{i.description}</div>
                      {i.sku_snapshot && (
                        <div className="font-mono text-xs text-ink-muted">{i.sku_snapshot}</div>
                      )}
                      {i.product_id && (
                        <div className="text-xs text-ink-muted">
                          {i.price_type === 'box'
                            ? `Box line · ${vialsPerBox(i)} vials/box`
                            : 'Vial line'}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">{i.qty}</td>
                    <td className="py-2 text-right tabular-nums text-ink">{received}</td>
                    <td className={`py-2 text-right tabular-nums ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {remaining}
                    </td>
                    <td className="py-2 pl-4">
                      <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                        <div
                          className={`h-full rounded-full ${remaining <= 0 ? 'bg-emerald-500' : 'bg-vital'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) */}
        <ul className="mt-4 lg:hidden divide-y divide-line/50">
          {items.map((i) => {
            const received = Number(i.qty_received ?? 0);
            const remaining = Number(i.qty) - received;
            const pct = Number(i.qty) > 0 ? Math.round((received / Number(i.qty)) * 100) : 0;
            return (
              <li key={i.id} className="py-2.5">
                <div className="text-sm text-ink">{i.description}</div>
                {i.sku_snapshot && <div className="font-mono text-xs text-ink-muted">{i.sku_snapshot}</div>}
                {i.product_id && (
                  <div className="text-xs text-ink-muted">{i.price_type === 'box' ? `Box line · ${vialsPerBox(i)} vials/box` : 'Vial line'}</div>
                )}
                <div className="mt-1.5 flex items-center gap-x-4 gap-y-1 text-xs text-ink-muted flex-wrap">
                  <span>Ordered <span className="text-ink tabular-nums">{i.qty}</span></span>
                  <span>Received <span className="text-ink tabular-nums">{received}</span></span>
                  <span>Remaining <span className={`tabular-nums ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{remaining}</span></span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface overflow-hidden">
                  <div className={`h-full rounded-full ${remaining <= 0 ? 'bg-emerald-500' : 'bg-vital'}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>

        {fullyReceived && (
          <div className="mt-4 flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="w-4 h-4" /> All items received.
          </div>
        )}

        {canReceive && !open && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => startReceiving(false)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Receive items
            </button>
            <button
              onClick={() => { startReceiving(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm"
            >
              Receive all remaining
            </button>
          </div>
        )}
      </div>

      {/* Receive form */}
      {open && (
        <div className="bg-white rounded-xl border border-vital/40 p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Record a receipt</h3>
          {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-muted uppercase tracking-wider">
                  <th className="text-left py-2">Item</th>
                  <th className="text-right py-2">Remaining</th>
                  <th className="text-right py-2 w-32">Receive now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {items.map((i) => {
                  const remaining = Number(i.qty) - Number(i.qty_received ?? 0);
                  const drafted = Math.floor(Number(draft[i.id]));
                  const showVials =
                    i.product_id && i.price_type === 'box' && Number.isFinite(drafted) && drafted > 0;
                  return (
                    <tr key={i.id}>
                      <td className="py-2 text-ink">
                        <div>{i.description}</div>
                        {i.sku_snapshot && (
                          <div className="font-mono text-xs text-ink-muted">{i.sku_snapshot}</div>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink-muted">{remaining}</td>
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={remaining}
                          disabled={remaining <= 0}
                          value={draft[i.id] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))}
                          placeholder="0"
                          className="w-24 text-right bg-surface border border-line rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-40"
                        />
                        {showVials && (
                          <div className="mt-1 text-xs text-ink-muted tabular-nums">
                            adds {toVials(i, drafted)} vials
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (below lg) */}
          <ul className="lg:hidden divide-y divide-line/50">
            {items.map((i) => {
              const remaining = Number(i.qty) - Number(i.qty_received ?? 0);
              const drafted = Math.floor(Number(draft[i.id]));
              const showVials = i.product_id && i.price_type === 'box' && Number.isFinite(drafted) && drafted > 0;
              return (
                <li key={i.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{i.description}</div>
                      {i.sku_snapshot && <div className="font-mono text-xs text-ink-muted">{i.sku_snapshot}</div>}
                      <div className="text-xs text-ink-muted mt-0.5">Remaining <span className="tabular-nums text-ink">{remaining}</span></div>
                    </div>
                    <div className="shrink-0 text-right">
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        disabled={remaining <= 0}
                        value={draft[i.id] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))}
                        placeholder="0"
                        className="w-24 text-right bg-surface border border-line rounded-lg px-3 py-2 text-base text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-40"
                      />
                      {showVials && <div className="mt-1 text-xs text-ink-muted tabular-nums">adds {toVials(i, drafted)} vials</div>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3">
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Partial delivery, 2 boxes damaged"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><PackageCheck className="w-4 h-4" /> Save receipt</>}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="px-4 py-2 bg-white border border-line text-ink-muted hover:text-ink rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Receipt history */}
      {receipts.length > 0 && (
        <div className="bg-white rounded-xl border border-line p-5">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-vital" /> Process History
          </h3>
          <ol className="space-y-3">
            {receipts.map((r) => (
              <li key={r.id} className="relative pl-5 border-l border-line">
                <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-vital" />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-ink">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {(r.items ?? []).reduce((s, it) => s + Number(it.qty), 0)} units
                  </span>
                </div>
                <ul className="mt-1 text-xs text-ink-muted space-y-0.5">
                  {(r.items ?? []).map((it) => (
                    <li key={it.id}>
                      <span className="tabular-nums text-ink">+{it.qty}</span>{' '}
                      {itemById[it.po_item_id] ?? 'Item'}
                    </li>
                  ))}
                </ul>
                {r.note && <p className="mt-1 text-xs text-ink italic">“{r.note}”</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
