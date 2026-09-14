'use client';

import React, { useEffect, useState } from 'react';
import { X, Mail, Loader2, Send, RotateCcw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  previewNotification,
  sendNotification,
  type NotificationKind,
} from '@/lib/warehouse/api';

interface Props {
  invoiceId: string;
  kind: NotificationKind;
  /** For the heading only. */
  fulfillmentType?: 'shipment' | 'pickup';
  label?: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function FulfillmentEmailModal({
  invoiceId,
  kind,
  fulfillmentType,
  label,
  onClose,
  onSent,
}: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [defaults, setDefaults] = useState<{ subject: string; body: string }>({ subject: '', body: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await previewNotification(invoiceId, kind);
        if (cancelled) return;
        setTo(p.to);
        setSubject(p.subject);
        setBody(p.body);
        setDefaults({ subject: p.default_subject, body: p.default_body });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load the email preview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, kind]);

  const send = async () => {
    if (!to.trim()) {
      setError('A recipient email is required.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendNotification(invoiceId, kind, { to: to.trim(), subject, body });
      toast.success(`Notification sent to ${to.trim()}`);
      onSent?.();
      onClose();
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to send email';
      setError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const heading =
    label ??
    (kind === 'packed'
      ? fulfillmentType === 'pickup'
        ? 'Ready-for-pickup email'
        : 'Order-packed email'
      : fulfillmentType === 'pickup'
        ? 'Pickup-confirmation email'
        : 'Shipping notification');

  const fld =
    'w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-lg p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <Mail className="w-4 h-4 text-indigo-500" /> {heading}
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-9 bg-surface rounded" />
            <div className="h-9 bg-surface rounded" />
            <div className="h-32 bg-surface rounded" />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">To</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} className={fld} placeholder="customer@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={fld} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-ink">Message</label>
                <button
                  type="button"
                  onClick={() => { setSubject(defaults.subject); setBody(defaults.body); }}
                  className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to default
                </button>
              </div>
              <textarea
                rows={9}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={`${fld} font-mono text-xs leading-relaxed`}
              />
            </div>
            <p className="text-[11px] text-ink-muted">This is a preview — edit anything before sending.</p>
          </div>
        )}

        {error && (
          <div className="mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={sending} className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Cancel</button>
          <button
            onClick={send}
            disabled={loading || sending}
            className="px-4 py-2 bg-ink hover:bg-ink/90 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send email
          </button>
        </div>
      </div>
    </div>
  );
}
