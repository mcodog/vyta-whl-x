'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Mail, Send, Loader2, Package, Paperclip, AlertCircle, Check,
  FileText, ExternalLink, Users, History,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import Checkbox from '@/components/admin/Checkbox';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a comma / semicolon / newline separated string into de-duped emails. */
function parseEmails(input: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of input.split(/[,;\n]/)) {
    const e = part.trim();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      invalid.push(e);
      continue;
    }
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(e);
  }
  return { valid, invalid };
}

function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}

/** One prior send, as returned by GET /api/admin/price-sheet/email. */
interface HistoryEntry {
  id: string;
  sent_by_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  include_inventory: boolean;
  currency: string | null;
  product_count: number | null;
  subject: string | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Preview-and-send modal for an entity's price list. Shows a live preview of the
 * exact PDF that will be attached (regenerated whenever the Inventory toggle
 * flips), alongside an editable To / CC / Subject / Body — all pre-generated but
 * fully editable before sending.
 */
export default function PriceSheetEmailModal({
  type,
  id,
  initialInventory,
  defaultEmail,
  entityName,
  onClose,
}: {
  type: 'customer' | 'salesperson';
  id: string;
  initialInventory: boolean;
  defaultEmail: string;
  entityName: string;
  onClose: () => void;
}) {
  const toast = useToast();

  const [withInventory, setWithInventory] = useState(initialInventory);
  const [to, setTo] = useState(defaultEmail ?? '');
  const [cc, setCc] = useState('');

  const label = entityName || (type === 'customer' ? 'customer' : 'sales rep');
  const greeting = firstNameOf(entityName);
  const [subject, setSubject] = useState('Your PuraMass price list');
  const [bodyText, setBodyText] = useState(
    `Hi${greeting ? ` ${greeting}` : ''},\n\n` +
      `Please find your current PuraMass price list attached as a PDF. ` +
      `It lists each product with its SKU, case price and single-vial price${initialInventory ? ', along with current inventory' : ''}.\n\n` +
      `If anything looks off, just reply to this email and we'll sort it out.\n\n— PuraMass`,
  );

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const toParsed = useMemo(() => parseEmails(to), [to]);
  const ccParsed = useMemo(() => parseEmails(cc), [cc]);
  const fileName = `price-list-${(entityName || 'entity')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'entity'}.pdf`;

  // Fetch (and re-fetch on inventory change) the real PDF for preview.
  const loadPreview = useCallback(async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams({ type, id, inventory: withInventory ? '1' : '0' });
      const res = await fetch(`/api/admin/price-sheet/pdf?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('Could not generate the price list preview');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setPdfUrl(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Preview failed');
      setPdfUrl(null);
    } finally {
      setPdfLoading(false);
    }
  }, [type, id, withInventory]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Load this entity's send history (newest first).
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams({ type, id });
      const res = await fetch(`/api/admin/price-sheet/email?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = await res.json().catch(() => ({}));
      setHistory(Array.isArray(json.history) ? json.history : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [type, id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Revoke the last object URL on unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // Escape closes (unless mid-send).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const send = async () => {
    setError(null);
    if (toParsed.valid.length === 0) {
      setError('Add at least one valid recipient in the To field.');
      return;
    }
    if (toParsed.invalid.length > 0 || ccParsed.invalid.length > 0) {
      setError(`Fix invalid address: ${[...toParsed.invalid, ...ccParsed.invalid][0]}`);
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/price-sheet/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type,
          id,
          inventory: withInventory,
          to: toParsed.valid,
          cc: ccParsed.valid,
          subject,
          body: bodyText,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to send the price list');
      setSent(true);
      toast.success(
        `Price list sent to ${toParsed.valid.length} recipient${toParsed.valid.length === 1 ? '' : 's'}`,
      );
      loadHistory();
      setTimeout(onClose, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send the price list');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-3 sm:p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-2xl border border-line shadow-xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Mail className="w-4 h-4 text-bronze shrink-0" /> Preview &amp; send price list
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 truncate">
              {type === 'customer' ? 'Customer' : 'Sales rep'}: <span className="text-ink">{label}</span>
            </p>
          </div>
          <button
            onClick={() => !sending && onClose()}
            className="text-ink-muted hover:text-ink shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: preview + form */}
        <div className="flex flex-col lg:flex-row min-h-0 flex-1 overflow-hidden">
          {/* PDF preview */}
          <div className="lg:w-1/2 border-b lg:border-b-0 lg:border-r border-line bg-surface flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line bg-white">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                <FileText className="w-3.5 h-3.5" /> PDF preview
              </span>
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-bronze hover:underline"
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="relative flex-1 min-h-[280px] lg:min-h-[440px]">
              {pdfLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-ink-muted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generating preview…
                </div>
              )}
              {pdfError && !pdfLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                  <p className="text-sm text-red-600">{pdfError}</p>
                  <button onClick={loadPreview} className="text-xs text-bronze hover:underline">
                    Try again
                  </button>
                </div>
              )}
              {pdfUrl && !pdfError && (
                <iframe
                  key={pdfUrl}
                  src={`${pdfUrl}#toolbar=0&navpanes=0`}
                  title="Price list preview"
                  className={`w-full h-full ${pdfLoading ? 'opacity-40' : 'opacity-100'} transition-opacity`}
                />
              )}
            </div>
            {/* Inventory toggle drives the preview + the attached PDF. The
                Checkbox and its label are siblings (no nested buttons) so a click
                on the box or the text toggles exactly once. */}
            <div className="px-4 py-3 border-t border-line bg-white">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  checked={withInventory}
                  onChange={() => setWithInventory((v) => !v)}
                  ariaLabel="Include inventory"
                />
                <button
                  type="button"
                  onClick={() => setWithInventory((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-sm text-ink select-none"
                >
                  <Package className="w-3.5 h-3.5 text-ink-muted" /> Include inventory
                </button>
              </div>
              <p className="text-[11px] text-ink-muted mt-1.5 pl-[30px]">
                {withInventory
                  ? 'On-hand stock is shown and included in the attached PDF.'
                  : 'Prices only — no stock figures shared.'}
              </p>
            </div>
          </div>

          {/* Email form */}
          <div className="lg:w-1/2 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
              {/* To */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">To</label>
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="name@example.com, another@example.com"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <RecipientChips valid={toParsed.valid} invalid={toParsed.invalid} />
                <p className="text-[11px] text-ink-muted mt-1">Separate multiple recipients with a comma.</p>
              </div>

              {/* CC */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  CC <span className="normal-case text-ink-light font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <RecipientChips valid={ccParsed.valid} invalid={ccParsed.invalid} />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Message</label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={8}
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>

              {/* Attachment chip */}
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-line bg-surface">
                <div className="w-8 h-8 rounded-lg bg-bronze/10 flex items-center justify-center shrink-0">
                  <Paperclip className="w-4 h-4 text-bronze" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{fileName}</div>
                  <div className="text-[11px] text-ink-muted">PDF attachment · {withInventory ? 'with inventory' : 'prices only'}</div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
                </div>
              )}
              {sent && (
                <div className="flex items-start gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <Check className="w-4 h-4 mt-0.5 shrink-0" /> Price list sent.
                </div>
              )}

              {/* Send history — one row per prior send, newest first. */}
              <div className="pt-1.5 border-t border-line">
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted uppercase tracking-wider">
                    <History className="w-3.5 h-3.5" /> Send history
                  </span>
                  {history.length > 0 && (
                    <span className="text-[11px] text-ink-muted">
                      {history.length}{history.length === 50 ? '+' : ''} send{history.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-xs text-ink-muted py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history…
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-xs text-ink-muted">Not sent yet — the first send will appear here.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {history.map((h) => (
                      <HistoryRow key={h.id} entry={h} />
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-line">
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                <Users className="w-3.5 h-3.5" />
                {toParsed.valid.length + ccParsed.valid.length === 0
                  ? 'No recipients yet'
                  : `${toParsed.valid.length} to${ccParsed.valid.length ? ` · ${ccParsed.valid.length} cc` : ''}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => !sending && onClose()}
                  className="px-4 py-2 text-sm text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={sending || sent || toParsed.valid.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-bronze hover:bg-bronze/90 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One past send in the history list: when, who, and the config used. */
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const to = entry.to_emails ?? [];
  const cc = entry.cc_emails ?? [];
  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{whenLabel(entry.created_at)}</span>
        {entry.success ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 text-[10px] font-semibold uppercase tracking-wider">
            <Check className="w-2.5 h-2.5" /> Sent
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 text-[10px] font-semibold uppercase tracking-wider">
            <AlertCircle className="w-2.5 h-2.5" /> Failed
          </span>
        )}
      </div>
      <div className="text-[11px] text-ink-muted mt-0.5">
        by <span className="text-ink">{entry.sent_by_email || 'unknown'}</span>
      </div>
      <div className="text-[11px] text-ink-muted mt-0.5 break-words">
        To {to.length > 0 ? to.join(', ') : '—'}
        {cc.length > 0 && <> · CC {cc.join(', ')}</>}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${entry.include_inventory ? 'bg-bronze/10 text-bronze' : 'bg-ink/5 text-ink-muted'}`}>
          <Package className="w-2.5 h-2.5" /> {entry.include_inventory ? 'With inventory' : 'Prices only'}
        </span>
        {entry.currency && (
          <span className="inline-flex px-1.5 py-0.5 rounded bg-ink/5 text-ink-muted text-[10px] font-medium">{entry.currency}</span>
        )}
        {entry.product_count != null && (
          <span className="inline-flex px-1.5 py-0.5 rounded bg-ink/5 text-ink-muted text-[10px] font-medium">
            {entry.product_count} product{entry.product_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {!entry.success && entry.error && (
        <div className="text-[11px] text-red-600 mt-1 break-words">{entry.error}</div>
      )}
    </li>
  );
}

/** Live chip preview of parsed recipients, flagging any invalid entries. */
function RecipientChips({ valid, invalid }: { valid: string[]; invalid: string[] }) {
  if (valid.length === 0 && invalid.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {valid.map((e) => (
        <span
          key={`v-${e}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bronze/10 text-bronze text-xs"
        >
          <Check className="w-3 h-3" /> {e}
        </span>
      ))}
      {invalid.map((e, i) => (
        <span
          key={`i-${e}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 text-xs"
        >
          <AlertCircle className="w-3 h-3" /> {e}
        </span>
      ))}
    </div>
  );
}
