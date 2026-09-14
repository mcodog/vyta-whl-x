'use client';

import React, { useMemo, useState } from 'react';
import {
  X, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Package, Link2Off,
} from 'lucide-react';
import {
  previewEasyshipSync, applyEasyshipSync,
  type EasyshipSyncMatch, type EasyshipSyncRecord,
} from '@/lib/admin/invoices';

type Step = 'pick' | 'review';

interface Props {
  onClose: () => void;
  /** Called after a successful apply with a summary string for the banner. */
  onApplied: (notice: string) => void;
}

/** Local YYYY-MM-DD for "today" (uses the browser's timezone). */
function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * Easyship → invoices sync. Pick a start date (default today), fetch the
 * shipments Easyship created on/after it, review the name matches, then apply —
 * attaching each shipment (tracking + label) onto the invoice's linked order.
 */
export default function EasyshipSyncDialog({ onClose, onApplied }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [date, setDate] = useState<string>(todayStr());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [matches, setMatches] = useState<EasyshipSyncMatch[]>([]);
  const [unmatched, setUnmatched] = useState<EasyshipSyncRecord[]>([]);
  const [fetched, setFetched] = useState(0);
  // Shipment ids that are checked to apply (defaults to every match).
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [applying, setApplying] = useState(false);

  const busy = loading || applying;

  const runPreview = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await previewEasyshipSync(date);
      setMatches(res.matches);
      setUnmatched(res.unmatched);
      setFetched(res.fetched);
      setChecked(new Set(res.matches.map((m) => m.shipmentId)));
      if (res.fetched === 0 && res.easyshipError) {
        setError(res.easyshipError);
      }
      setStep('review');
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch Easyship shipments');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (shipmentId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(shipmentId) ? next.delete(shipmentId) : next.add(shipmentId);
      return next;
    });

  const allChecked = matches.length > 0 && matches.every((m) => checked.has(m.shipmentId));
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(matches.map((m) => m.shipmentId)));

  const selectedMatches = useMemo(
    () => matches.filter((m) => checked.has(m.shipmentId)),
    [matches, checked],
  );

  const runApply = async () => {
    if (selectedMatches.length === 0) return;
    setApplying(true);
    setError('');
    try {
      const res = await applyEasyshipSync(
        selectedMatches.map((m) => ({
          invoiceId: m.invoiceId,
          shipmentId: m.shipmentId,
          trackingNumber: m.trackingNumber,
          trackingUrl: m.trackingUrl,
          trackingStatus: m.trackingStatus,
          labelState: m.labelState,
          labelUrl: m.labelUrl,
          courier: m.courier,
        })),
      );
      const skipped = res.skipped.length;
      onApplied(
        `Attached ${res.applied} shipment${res.applied !== 1 ? 's' : ''}` +
          (skipped ? ` · ${skipped} skipped` : '') +
          (res.failed ? ` · ${res.failed} failed` : '') +
          '.',
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to apply matches');
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <h2 className="text-base font-bold text-ink inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-vital" /> Sync Easyship shipments
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          {step === 'pick' ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                Pull the shipments Easyship created on or after a date, then match them to
                invoices by customer name. Nothing is changed until you review and apply.
              </p>
              <div>
                <label htmlFor="sync-date" className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                  Created on or after
                </label>
                <input
                  id="sync-date"
                  type="date"
                  value={date}
                  max={todayStr()}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
                <p className="mt-1.5 text-xs text-ink-muted">Defaults to today.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-ink-muted">
                Fetched <span className="font-semibold text-ink tabular-nums">{fetched}</span>{' '}
                shipment{fetched !== 1 ? 's' : ''} from {date}.{' '}
                <span className="font-semibold text-ink tabular-nums">{matches.length}</span>{' '}
                matched an unshipped invoice by name.
              </p>

              {matches.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-vital" /> Matched ({matches.length})
                    </h3>
                    <button
                      onClick={toggleAll}
                      className="text-xs text-vital hover:underline"
                    >
                      {allChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <ul className="border border-line rounded-lg divide-y divide-line/50 max-h-64 overflow-y-auto">
                    {matches.map((m) => (
                      <li key={m.shipmentId} className="flex items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={checked.has(m.shipmentId)}
                          onChange={() => toggle(m.shipmentId)}
                          className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                          aria-label={`Attach shipment to ${m.invoiceNumber ?? m.invoiceName}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-ink">{m.invoiceNumber ?? '—'}</span>
                            <span className="text-sm text-ink">{m.invoiceName}</span>
                            {m.ambiguous && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                                {m.candidateCount} invoices — newest chosen
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
                            {m.courier && <span>{m.courier}</span>}
                            {m.trackingNumber && (
                              <span className="font-mono">{m.trackingNumber}</span>
                            )}
                            {m.labelState && <span>label: {m.labelState}</span>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {unmatched.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5 mb-2">
                    <Link2Off className="w-4 h-4 text-ink-muted" /> Unmatched ({unmatched.length})
                  </h3>
                  <p className="text-xs text-ink-muted mb-2">
                    No unshipped invoice matched these by name — left untouched.
                  </p>
                  <ul className="border border-line rounded-lg divide-y divide-line/50 max-h-40 overflow-y-auto">
                    {unmatched.map((r) => (
                      <li key={r.shipmentId} className="px-3 py-2 text-xs">
                        <span className="text-ink">{r.destinationName ?? 'Unknown recipient'}</span>
                        {r.trackingNumber && (
                          <span className="ml-2 font-mono text-ink-muted">{r.trackingNumber}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {matches.length === 0 && unmatched.length === 0 && !error && (
                <div className="flex items-center gap-2 text-sm text-ink-muted py-4">
                  <CheckCircle2 className="w-4 h-4" /> No shipments found for that date.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 py-4 border-t border-line flex-shrink-0">
          {step === 'pick' ? (
            <button
              onClick={runPreview}
              disabled={busy || !date}
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Fetch matches
            </button>
          ) : (
            <button
              onClick={runApply}
              disabled={busy || selectedMatches.length === 0}
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {`Apply ${selectedMatches.length} match${selectedMatches.length !== 1 ? 'es' : ''}`}
            </button>
          )}
          <div className="flex gap-2">
            {step === 'review' && (
              <button
                onClick={() => { setStep('pick'); setError(''); }}
                disabled={busy}
                className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
              >
                Back
              </button>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
