'use client';

import React, { useState } from 'react';
import {
  X, Check, Loader2, AlertCircle, ArrowLeft, Mail, MailX,
  CreditCard, ArrowLeftRight, Banknote, Bitcoin, Wallet,
} from 'lucide-react';
import { recordPayment, type RecordPaymentResult } from '@/lib/admin/invoices';
import type { PaymentMethod } from '@/lib/supabase';

// The selectable payment methods, shown as icon "cards" instead of a dropdown.
// Order and labels mirror the invoice payment model (lib/supabase PaymentMethod).
const METHODS: {
  value: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'e-transfer', label: 'E-Transfer', icon: ArrowLeftRight },
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'crypto', label: 'Crypto', icon: Bitcoin },
  { value: 'other', label: 'Other', icon: Wallet },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Card',
  'e-transfer': 'E-Transfer',
  cash: 'Cash',
  crypto: 'Crypto',
  other: 'Other',
};

/**
 * Record a payment against an invoice. Shared by the invoice detail page and the
 * invoices list's per-row quick action so the flow stays identical everywhere.
 *
 * Three steps: (1) enter amount + method + reference, (2) confirm — including a
 * toggle to email the customer a payment-received notice, (3) result — whether
 * the confirmation email actually went out. The method is chosen from icon cards
 * rather than a dropdown to make the common one-tap case fast.
 */
export default function RecordPaymentDialog({
  invoiceId,
  invoiceNumber,
  amountDue,
  customerEmail,
  onClose,
  onRecorded,
}: {
  invoiceId: string;
  invoiceNumber?: string | null;
  /** Amount still owed — pre-fills the input and shown as the outstanding hint. */
  amountDue: number;
  /** Customer email on file; when absent the email toggle is disabled. */
  customerEmail?: string | null;
  onClose: () => void;
  /**
   * Called after the payment is recorded so the caller can refresh its view.
   * The dialog stays open on the result step and closes itself via `onClose`.
   */
  onRecorded: (result: RecordPaymentResult) => void;
}) {
  const recipient = (customerEmail ?? '').trim();
  const hasRecipient = recipient.length > 0;

  const [step, setStep] = useState<'details' | 'confirm' | 'done'>('details');
  const [amount, setAmount] = useState(amountDue > 0 ? amountDue.toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [reference, setReference] = useState('');
  // Default to notifying the customer when we have an address for them.
  const [sendEmail, setSendEmail] = useState(hasRecipient);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordPaymentResult | null>(null);

  const numericAmount = Number(amount);
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0;

  const goToConfirm = () => {
    setError(null);
    if (!amountValid) {
      setError('Enter a payment amount');
      return;
    }
    setStep('confirm');
  };

  const submit = async () => {
    setError(null);
    if (!amountValid) {
      setStep('details');
      setError('Enter a payment amount');
      return;
    }
    setSaving(true);
    try {
      const res = await recordPayment(invoiceId, {
        amount: numericAmount,
        method,
        reference_note: reference.trim() || null,
        send_email: sendEmail && hasRecipient,
      });
      setResult(res);
      setStep('done');
      onRecorded(res);
    } catch (e: any) {
      setError(e?.message ?? 'Could not record payment');
    } finally {
      setSaving(false);
    }
  };

  const willEmail = sendEmail && hasRecipient;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-emerald-700">
              {step === 'done' ? 'Payment Recorded' : step === 'confirm' ? 'Confirm Payment' : 'Record Payment'}
            </h3>
            {invoiceNumber && (
              <p className="text-xs text-ink-muted font-mono mt-0.5">{invoiceNumber}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-ink-muted hover:text-ink disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* STEP 1 — details                                               */}
        {/* -------------------------------------------------------------- */}
        {step === 'details' && (
          <>
            <div className="space-y-4">
              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  Amount
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') goToConfirm(); }}
                  placeholder={amountDue.toFixed(2)}
                  autoFocus
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
                {amountDue > 0 && (
                  <p className="text-xs text-ink-muted mt-1">Outstanding: ${amountDue.toFixed(2)}</p>
                )}
              </div>

              {/* Method — icon cards instead of a dropdown */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5">
                  Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {METHODS.map(({ value, label, icon: Icon }) => {
                    const active = method === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMethod(value)}
                        aria-pressed={active}
                        className={`flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl border text-xs font-medium transition-colors ${
                          active
                            ? 'border-vital bg-vital/10 text-vital'
                            : 'border-line bg-surface text-ink-muted hover:text-ink hover:border-ink/20'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Reference */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  Reference (optional)
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Txn ID / cheque #"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={goToConfirm}
                disabled={!amountValid}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* -------------------------------------------------------------- */}
        {/* STEP 2 — confirm + email toggle                                */}
        {/* -------------------------------------------------------------- */}
        {step === 'confirm' && (
          <>
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-xl border border-line bg-surface/50 divide-y divide-line/60 text-sm">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink-muted">Amount</span>
                  <span className="font-semibold text-ink tabular-nums">${numericAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink-muted">Method</span>
                  <span className="font-medium text-ink">{METHOD_LABEL[method]}</span>
                </div>
                {reference.trim() && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-ink-muted flex-shrink-0">Reference</span>
                    <span className="font-medium text-ink truncate">{reference.trim()}</span>
                  </div>
                )}
              </div>

              {/* Email opt-in — recording a payment does NOT email the customer
                  unless this is switched on. */}
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={willEmail}
                  disabled={!hasRecipient}
                  onClick={() => setSendEmail((v) => !v)}
                  className={`w-full flex items-center justify-between gap-3 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed ${
                    willEmail ? 'text-ink' : 'text-ink-muted'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-left">
                    {willEmail
                      ? <Mail className="w-4 h-4 text-vital" />
                      : <MailX className="w-4 h-4 text-ink-muted" />}
                    Email payment confirmation
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                      willEmail ? 'bg-vital' : 'bg-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        willEmail ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
                <p className="mt-1.5 text-xs text-ink-muted break-words">
                  {hasRecipient
                    ? willEmail
                      ? <>A payment-received email will be sent to <span className="text-ink">{recipient}</span>.</>
                      : "Off — the payment is recorded without notifying the customer."
                    : 'No email on file — add a customer email to notify them.'}
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-between gap-2">
              <button
                onClick={() => { setError(null); setStep('details'); }}
                disabled={saving}
                className="px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50 flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {willEmail ? 'Record & Email' : 'Record Payment'}
              </button>
            </div>
          </>
        )}

        {/* -------------------------------------------------------------- */}
        {/* STEP 3 — result                                                */}
        {/* -------------------------------------------------------------- */}
        {step === 'done' && result && (
          <>
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-ink">
                <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4" />
                </span>
                <span>
                  <span className="font-semibold tabular-nums">${Number(result.payment.amount).toFixed(2)}</span>
                  {' '}via {METHOD_LABEL[result.payment.method]} recorded.
                </span>
              </div>

              {/* Email outcome */}
              {result.email.requested ? (
                result.email.sent ? (
                  <div className="flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                    <Mail className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      Confirmation email sent
                      {result.email.to ? <> to <span className="font-medium break-all">{result.email.to}</span></> : ''}
                      {result.email.by ? <> by <span className="font-medium break-all">{result.email.by}</span></> : ''}.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      Payment recorded, but the confirmation email didn&rsquo;t send
                      {result.email.error ? <> ({result.email.error})</> : ''}. You can send it from the invoice.
                    </span>
                  </div>
                )
              ) : (
                <div className="flex items-start gap-2 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted">
                  <MailX className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>No confirmation email was sent to the customer.</span>
                </div>
              )}
            </div>

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
