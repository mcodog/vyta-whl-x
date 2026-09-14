'use client';

import React, { useEffect, useState } from 'react';
import {
  X, AlertTriangle, Loader2, Undo2, ArrowLeft, Check, PackageOpen, Inbox,
} from 'lucide-react';
import { getInvoice, reversePayment, type ReversePaymentResult } from '@/lib/admin/invoices';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';
import type { Invoice, InvoiceStatus, Payment, PaymentMethod } from '@/lib/supabase';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Card',
  'e-transfer': 'E-Transfer',
  cash: 'Cash',
  crypto: 'Crypto',
  other: 'Other',
};

function methodLabel(m: string): string {
  return (METHOD_LABEL as Record<string, string>)[m] ?? m;
}

/**
 * Predict the status an invoice lands on after a given payment is reversed, so
 * the confirm step can preview it. Mirrors the server's recompute in
 * DELETE …/payments/[paymentId].
 */
function predictStatus(
  current: InvoiceStatus,
  total: number,
  paidNow: number,
  removeAmount: number,
): InvoiceStatus {
  if (current !== 'paid' && current !== 'partial' && current !== 'sent') return current;
  const remaining = paidNow - removeAmount;
  if (remaining + 0.001 >= total) return 'paid';
  if (remaining > 0.001) return 'partial';
  return 'sent';
}

/**
 * Reverse a recorded payment against an invoice. Loads the invoice's payment
 * history, lets the admin pick one to reverse, and confirms before removing it —
 * the server recomputes the invoice status (paid → partial → sent) and restores
 * any stock the paid transition took. Shared by the invoices list (per-row quick
 * action) and the invoice detail page's Payment History.
 */
export default function ReversePaymentDialog({
  invoiceId,
  invoiceNumber,
  onClose,
  onReversed,
}: {
  invoiceId: string;
  invoiceNumber?: string | null;
  onClose: () => void;
  /** Called after each successful reversal so the caller can refresh its view. */
  onReversed: (result: ReversePaymentResult) => void;
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The payment queued for confirmation (step 2), null while browsing the list.
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const inv = await getInvoice(invoiceId);
        if (!alive) return;
        if (!inv) {
          setLoadError('Could not load this invoice.');
        } else {
          setInvoice(inv);
          setPayments([...(inv.payments ?? [])].sort((a, b) => +new Date(b.paid_at) - +new Date(a.paid_at)));
        }
      } catch (e: any) {
        if (alive) setLoadError(e?.message ?? 'Could not load this invoice.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [invoiceId]);

  const total = Number(invoice?.total ?? 0);
  const paidNow = payments.reduce((s, p) => s + Number(p.amount), 0);

  const doReverse = async (payment: Payment) => {
    setBusyId(payment.id);
    setError(null);
    try {
      const res = await reversePayment(invoiceId, payment.id);
      // Drop the reversed payment from the local list and update our totals.
      setPayments((prev) => prev.filter((p) => p.id !== payment.id));
      setInvoice((prev) => (prev ? { ...prev, status: res.invoice.status } : prev));
      setConfirming(null);
      setNotice(
        `Reversed $${res.reversed_payment.amount.toFixed(2)} · invoice is now ${INVOICE_STATUS_META[res.invoice.status].label}` +
          (res.stock_restored ? ' · stock restored.' : '.'),
      );
      onReversed(res);
    } catch (e: any) {
      setError(e?.message ?? 'Could not reverse the payment');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => { if (!busyId) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-amber-700">
              {confirming ? 'Confirm Reversal' : 'Reverse Payment'}
            </h3>
            {invoiceNumber && (
              <p className="text-xs text-ink-muted font-mono mt-0.5">{invoiceNumber}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={!!busyId}
            className="text-ink-muted hover:text-ink disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading / load error */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {loadError}
          </div>
        ) : confirming ? (
          /* ---------------------------------------------------------------- */
          /* STEP 2 — confirm a single reversal                               */
          /* ---------------------------------------------------------------- */
          (() => {
            const nextStatus = predictStatus(
              (invoice?.status ?? 'sent') as InvoiceStatus,
              total,
              paidNow,
              Number(confirming.amount),
            );
            const willRestoreStock =
              nextStatus !== 'paid' && invoice?.stock_adjusted === true;
            return (
              <>
                <div className="space-y-4">
                  <div className="rounded-xl border border-line bg-surface/50 divide-y divide-line/60 text-sm">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-ink-muted">Amount</span>
                      <span className="font-semibold text-ink tabular-nums">${Number(confirming.amount).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-ink-muted">Method</span>
                      <span className="font-medium text-ink">{methodLabel(confirming.method)}</span>
                    </div>
                    {confirming.reference_note && (
                      <div className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="text-ink-muted flex-shrink-0">Reference</span>
                        <span className="font-medium text-ink truncate">{confirming.reference_note}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-ink-muted">Recorded</span>
                      <span className="font-medium text-ink">{new Date(confirming.paid_at).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-ink-muted">Status after</span>
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${INVOICE_STATUS_META[nextStatus].badge}`}>
                        {INVOICE_STATUS_META[nextStatus].label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      This permanently removes the payment record.
                      {willRestoreStock && (
                        <> The stock decremented when this invoice was marked paid will be returned to inventory.</>
                      )}
                      {' '}The customer is not notified.
                    </span>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex justify-between gap-2">
                  <button
                    onClick={() => { setError(null); setConfirming(null); }}
                    disabled={!!busyId}
                    className="px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <button
                    onClick={() => doReverse(confirming)}
                    disabled={!!busyId}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    {busyId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    Reverse Payment
                  </button>
                </div>
              </>
            );
          })()
        ) : (
          /* ---------------------------------------------------------------- */
          /* STEP 1 — payment list                                            */
          /* ---------------------------------------------------------------- */
          <>
            {notice && (
              <div className="flex items-start gap-2 px-3 py-2 mb-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> {notice}
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 mb-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            {payments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-ink-muted">
                <Inbox className="w-8 h-8" />
                <p className="text-sm">No payments recorded on this invoice.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-ink-muted mb-3">
                  Select a payment to reverse. This removes the record and updates the invoice status.
                </p>
                <ul className="space-y-2">
                  {payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/40 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-ink capitalize">
                          {methodLabel(p.method)}
                          {p.reference_note ? <span className="text-ink-muted normal-case"> · {p.reference_note}</span> : ''}
                        </div>
                        <div className="text-xs text-ink-muted">{new Date(p.paid_at).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="font-semibold text-emerald-600 tabular-nums whitespace-nowrap">
                          ${Number(p.amount).toFixed(2)}
                        </span>
                        <button
                          onClick={() => { setError(null); setNotice(null); setConfirming(p); }}
                          disabled={!!busyId}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
                        >
                          <Undo2 className="w-3.5 h-3.5" /> Reverse
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                {invoice?.stock_adjusted === true && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-muted">
                    <PackageOpen className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Reversing the payment that made this invoice fully paid returns its stock to inventory.
                  </p>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-ink hover:bg-ink/90 text-white text-sm font-medium rounded-lg"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
