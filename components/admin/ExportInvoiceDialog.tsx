'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Loader2, AlertTriangle, CheckCircle2, Send, ExternalLink,
  ArrowLeft, Eye, Ban, RefreshCw, Info,
} from 'lucide-react';
import Link from 'next/link';
import {
  listDestinations, previewExport, sendExport,
  type ExportDestinationView, type PreviewResultItem, type SendResultItem,
} from '@/lib/admin/invoice-export-client';

type Step = 'setup' | 'preview' | 'result';

interface Props {
  /** One id for the detail-page button; many for the list-page bulk action. */
  invoiceIds: string[];
  onClose: () => void;
  /** Called after a send completes, with a one-line summary for a banner. */
  onDone?: (summary: string) => void;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Export one or more invoices to another website (a configured destination that
 * runs the import-invoice Edge Function). The admin picks a destination, can
 * preview exactly what will be sent plus the far side's compatibility/existence
 * report, then fires. In bulk the preview is optional (overridable) — you can
 * send everything without reviewing each one.
 */
export default function ExportInvoiceDialog({ invoiceIds, onClose, onDone }: Props) {
  const bulk = invoiceIds.length > 1;

  const [step, setStep] = useState<Step>('setup');
  const [destinations, setDestinations] = useState<ExportDestinationView[]>([]);
  const [loadingDests, setLoadingDests] = useState(true);
  const [destId, setDestId] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [previews, setPreviews] = useState<PreviewResultItem[]>([]);
  const [sendResults, setSendResults] = useState<SendResultItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listDestinations();
        const enabled = list.filter((d) => d.enabled);
        setDestinations(enabled);
        if (enabled.length === 1) setDestId(enabled[0].id);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load destinations');
      } finally {
        setLoadingDests(false);
      }
    })();
  }, []);

  const selectedDest = useMemo(
    () => destinations.find((d) => d.id === destId) ?? null,
    [destinations, destId],
  );

  const runPreview = async () => {
    if (!destId) { setError('Pick a destination first'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await previewExport(invoiceIds, destId);
      setPreviews(res.results);
      setStep('preview');
    } catch (e: any) {
      setError(e?.message ?? 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const runSend = async () => {
    if (!destId) { setError('Pick a destination first'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await sendExport(invoiceIds, destId, overwrite);
      setSendResults(res.results);
      setStep('result');
      const { succeeded, skipped, failed } = res.summary;
      const parts = [`${succeeded} sent`];
      if (skipped) parts.push(`${skipped} skipped`);
      if (failed) parts.push(`${failed} failed`);
      onDone?.(`${res.destination.label}: ${parts.join(', ')}`);
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  const title = bulk ? `Export ${invoiceIds.length} invoices` : 'Send invoice to another site';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <ExternalLink className="w-5 h-5 text-bronze" />
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Setup ──────────────────────────────────────────────── */}
          {step === 'setup' && (
            <div className="space-y-4">
              {loadingDests ? (
                <div className="flex items-center gap-2 text-ink-muted text-sm py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading destinations…
                </div>
              ) : destinations.length === 0 ? (
                <div className="text-sm text-ink-muted space-y-3 py-4">
                  <p className="flex items-center gap-2">
                    <Info className="w-4 h-4" /> No export destinations are configured yet.
                  </p>
                  <Link
                    href="/admin/settings/invoice-export"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-ink text-white rounded-lg text-sm font-medium"
                  >
                    Configure destinations <ExternalLink className="w-4 h-4" />
                  </Link>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Destination site</label>
                    <select
                      value={destId}
                      onChange={(e) => setDestId(e.target.value)}
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                    >
                      <option value="">Select a site…</option>
                      {destinations.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                    {selectedDest && (
                      <p className="mt-1 text-xs text-ink-muted truncate">{selectedDest.edge_function_url}</p>
                    )}
                  </div>

                  <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Overwrite if it already exists</span>
                      <span className="block text-xs text-ink-muted">
                        When off, an invoice whose number already exists on the destination is skipped.
                      </span>
                    </span>
                  </label>

                  <div className="rounded-lg bg-surface border border-line px-3 py-2.5 text-xs text-ink-muted">
                    {bulk
                      ? `${invoiceIds.length} invoices selected. Preview is optional — you can send them all directly.`
                      : 'Preview shows exactly what will be sent and whether the destination already has this invoice, customer, or products.'}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Preview ────────────────────────────────────────────── */}
          {step === 'preview' && (
            <div className="space-y-3">
              {previews.map((p) => (
                <PreviewCard key={p.invoiceId} p={p} />
              ))}
            </div>
          )}

          {/* ── Result ─────────────────────────────────────────────── */}
          {step === 'result' && (
            <div className="space-y-2">
              {sendResults.map((r) => (
                <div
                  key={r.invoiceId}
                  className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm"
                >
                  <span className="font-medium text-ink">{r.invoice_number ?? r.invoiceId}</span>
                  <ResultBadge r={r} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-line">
          {step === 'preview' ? (
            <button
              onClick={() => setStep('setup')}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 text-ink-muted hover:text-ink text-sm disabled:opacity-50"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {step === 'result' ? (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="px-3 py-2 text-ink-muted hover:text-ink text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                {step === 'setup' && destinations.length > 0 && (
                  <button
                    onClick={runPreview}
                    disabled={busy || !destId}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    Preview
                  </button>
                )}
                {(step === 'setup' ? destinations.length > 0 : true) && (
                  <button
                    onClick={runSend}
                    disabled={busy || !destId}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-bronze hover:bg-bronze/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {step === 'preview' ? 'Confirm & send' : 'Send now'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function PreviewCard({ p }: { p: PreviewResultItem }) {
  const [open, setOpen] = useState(false);
  const inv = p.payload?.invoice;
  const report = p.report;
  const currency = inv?.currency ?? 'CAD';

  return (
    <div className="rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <div className="font-medium text-ink text-sm truncate">
            {p.invoice_number ?? p.invoiceId}
          </div>
          {inv && (
            <div className="text-xs text-ink-muted truncate">
              {inv.customer_name ?? inv.customer_email ?? 'No customer'} · {money(inv.total, currency)}
            </div>
          )}
        </div>
        {p.error ? (
          <span className="inline-flex items-center gap-1 text-xs text-red-600 flex-shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" /> Unreachable
          </span>
        ) : (
          <PreviewFlags report={report} />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-line pt-2 space-y-2 text-xs">
          {p.error && <div className="text-red-600">{p.error}</div>}

          {report && (
            <div className="space-y-1.5">
              {report.columns_ok === false ? (
                <Flag
                  ok={false}
                  warn
                  label={
                    (report.missing_tables ?? []).length
                      ? `Missing required tables: ${report.missing_tables!.join(', ')}`
                      : `Missing required columns: ${Object.entries(report.missing_required ?? {})
                          .map(([t, c]) => `${t} (${c.join(', ')})`)
                          .join('; ')}`
                  }
                />
              ) : (
                <Flag ok label="Required table columns compatible" />
              )}
              {Object.keys(report.missing_columns ?? {}).length > 0 && (
                <Flag
                  ok
                  warn
                  label={`These fields won't transfer (not on destination): ${Object.entries(
                    report.missing_columns ?? {},
                  )
                    .map(([t, c]) => `${t}.${c.join('/')}`)
                    .join('; ')}`}
                />
              )}
              <Flag
                ok={!report.invoice_exists}
                warn={report.invoice_exists}
                label={report.invoice_exists ? 'Invoice already exists (will skip unless overwrite)' : 'New invoice on destination'}
              />
              <Flag
                ok
                label={report.customer_exists ? 'Customer matched (exists)' : 'Customer will be created'}
              />
              {(report.products ?? []).length > 0 && (
                <div className="text-ink-muted">
                  Products:{' '}
                  {report.products!.map((pr, i) => (
                    <span key={i} className={pr.exists ? 'text-emerald-700' : 'text-amber-700'}>
                      {pr.sku ?? '—'} {pr.exists ? '(exists)' : '(new)'}
                      {i < report.products!.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {p.payload && (
            <div className="pt-1">
              <div className="text-ink-muted mb-1">Line items ({p.payload.line_items.length}):</div>
              <ul className="space-y-0.5">
                {p.payload.line_items.map((li, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-ink">
                      {li.qty}× {li.description}
                      {li.sku ? <span className="text-ink-muted"> · {li.sku}</span> : null}
                    </span>
                    <span className="text-ink-muted flex-shrink-0">{money(li.line_total, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewFlags({ report }: { report: PreviewResultItem['report'] }) {
  if (!report) return <span className="text-xs text-ink-muted flex-shrink-0">No report</span>;
  if (report.columns_ok === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
        <AlertTriangle className="w-3.5 h-3.5" /> Schema mismatch
      </span>
    );
  }
  if (report.invoice_exists) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
        <RefreshCw className="w-3.5 h-3.5" /> Exists
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 flex-shrink-0">
      <CheckCircle2 className="w-3.5 h-3.5" /> Ready
    </span>
  );
}

function Flag({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const color = warn ? 'text-amber-700' : ok ? 'text-emerald-700' : 'text-ink-muted';
  const Icon = warn ? AlertTriangle : CheckCircle2;
  return (
    <div className={`flex items-start gap-1.5 ${color}`}>
      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function ResultBadge({ r }: { r: SendResultItem }) {
  if (r.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle2 className="w-3.5 h-3.5" /> Sent
        {r.remote_invoice_number ? <span className="text-ink-muted">· {r.remote_invoice_number}</span> : null}
      </span>
    );
  }
  if (r.status === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium" title={r.error ?? undefined}>
        <Ban className="w-3.5 h-3.5" /> Skipped (exists)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium" title={r.error ?? undefined}>
      <AlertTriangle className="w-3.5 h-3.5" /> Failed
    </span>
  );
}
