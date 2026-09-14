'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
} from 'lucide-react';
import PaymentShell from '../_components/PaymentShell';
import { money, type PayView } from '../_components/types';

/**
 * Step 2 (crypto): wallet, amount, and the "I've sent it" hand-back.
 *
 * Submitting a transaction reference does NOT mark the invoice paid — an admin
 * verifies the transfer on-chain and records the payment. The copy here says so
 * plainly so nobody thinks the order is confirmed the moment they hit send.
 */
export default function CryptoPayClient({ token }: { token: string }) {
  const [view, setView] = useState<PayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [walletId, setWalletId] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [declared, setDeclared] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'This payment link is not valid.');
        return;
      }
      const v = data as PayView;
      setView(v);
      setLoadError(null);
      // Preselect the wallet they were shown before, else the first one.
      setWalletId(
        v.wallets.find((w) => w.id === v.invoice.crypto_wallet_id)?.id ?? v.wallets[0]?.id ?? '',
      );
      if (v.invoice.crypto_payment_declared_at) {
        setDeclared(true);
        setReference(v.invoice.crypto_payment_reference ?? '');
      }
    } catch {
      setLoadError('We could not load this invoice. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800);
    } catch {
      /* clipboard blocked — the value is on screen to copy by hand */
    }
  };

  const submitReference = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!reference.trim()) {
      setSubmitError('Enter your transaction hash or reference.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/crypto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: reference.trim(), wallet_id: walletId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error || 'We could not save your reference.');
        return;
      }
      setDeclared(true);
    } catch {
      setSubmitError('We could not save your reference. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PaymentShell>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading payment details…
        </div>
      </PaymentShell>
    );
  }

  if (loadError || !view) {
    return (
      <PaymentShell>
        <div className="bg-white rounded-2xl border border-line p-8 text-center">
          <AlertCircle className="w-8 h-8 text-ink-light mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink mb-1">This link isn&apos;t valid</h1>
          <p className="text-sm text-ink-muted">{loadError ?? 'This payment link is not valid.'}</p>
        </div>
      </PaymentShell>
    );
  }

  const { invoice, wallets, crypto_instructions } = view;
  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0] ?? null;
  const amount = money(invoice.amount_due, invoice.currency);

  if (!invoice.payable) {
    return (
      <PaymentShell>
        <BackLink token={token} />
        <div className="bg-white rounded-2xl border border-line p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink mb-1">Nothing left to pay</h1>
          <p className="text-sm text-ink-muted">
            Invoice {invoice.invoice_number} has already been settled. Thank you!
          </p>
        </div>
      </PaymentShell>
    );
  }

  // The link is locked (a product on the invoice has no Stealth Health
  // single-vial SKU). Same stop as the method page — no wallet, no reference
  // box, just who to talk to.
  if (view.locked) {
    return (
      <PaymentShell>
        <BackLink token={token} />
        <div className="bg-white rounded-2xl border border-line p-8 text-center">
          <Lock className="w-8 h-8 text-ink-light mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink mb-1">This payment link is on hold</h1>
          <p className="text-sm text-ink-muted">
            {view.locked_message ??
              'This payment link is locked and cannot be used right now. Please contact admin.'}
          </p>
        </div>
      </PaymentShell>
    );
  }

  if (!wallet) {
    return (
      <PaymentShell>
        <BackLink token={token} />
        <div className="bg-white rounded-2xl border border-line p-8 text-center">
          <AlertCircle className="w-8 h-8 text-ink-light mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-ink mb-1">Crypto isn&apos;t available</h1>
          <p className="text-sm text-ink-muted">
            No receiving wallet is set up right now. Reply to your invoice email and we&apos;ll
            arrange payment with you.
          </p>
        </div>
      </PaymentShell>
    );
  }

  return (
    <PaymentShell>
      <BackLink token={token} />

      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
          Pay with crypto
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Send exactly <span className="font-medium text-ink">{amount}</span> worth of{' '}
          {wallet.label} to the address below, then tell us the transaction hash so we can match
          your payment to invoice {invoice.invoice_number}.
        </p>
      </header>

      {declared && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Got it — we&apos;re confirming your transfer on-chain. Your invoice stays open until it
            clears, and we&apos;ll email you the moment it does.
          </span>
        </div>
      )}

      {/* Wallet picker — only when there's more than one to choose from. */}
      {wallets.length > 1 && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-ink mb-2">Choose a coin / network</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {wallets.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWalletId(w.id)}
                className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${
                  w.id === wallet.id
                    ? 'border-vital bg-vital-50'
                    : 'border-line bg-white hover:border-ink/20'
                }`}
              >
                <span className="block text-sm font-medium text-ink">{w.label}</span>
                {w.network && <span className="block text-xs text-ink-muted mt-0.5">{w.network}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="px-5 sm:px-6 py-5 grid sm:grid-cols-[auto,1fr] gap-5 sm:gap-6 items-start">
          <div className="mx-auto sm:mx-0 rounded-xl border border-line p-3 bg-white">
            <QRCodeSVG value={wallet.address} size={148} level="M" />
          </div>

          <div className="min-w-0 space-y-4">
            <Field
              label="Amount to send"
              value={amount}
              copyValue={invoice.amount_due.toFixed(2)}
              copied={copied === 'amount'}
              onCopy={() => copy('amount', invoice.amount_due.toFixed(2))}
            />
            <Field
              label={`${wallet.label} address${wallet.network ? ` · ${wallet.network}` : ''}`}
              value={wallet.address}
              mono
              copied={copied === 'address'}
              onCopy={() => copy('address', wallet.address)}
            />
            {wallet.memo && (
              <Field
                label="Memo / tag (required)"
                value={wallet.memo}
                mono
                copied={copied === 'memo'}
                onCopy={() => copy('memo', wallet.memo)}
              />
            )}
          </div>
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-line bg-surface/60">
          <p className="text-xs text-ink-muted leading-relaxed">
            {crypto_instructions ? (
              <span className="whitespace-pre-wrap">{crypto_instructions}</span>
            ) : (
              <>
                Send only {wallet.label}
                {wallet.network ? ` on the ${wallet.network} network` : ''} to this address — funds
                sent on another network may be lost. Network fees are paid by the sender, so make
                sure the amount that arrives covers the full balance.
              </>
            )}
          </p>
        </div>
      </section>

      {/* Hand back the transaction reference so an admin can match the transfer. */}
      <section className="mt-6 bg-white rounded-2xl border border-line p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">
          {declared ? 'Your transaction reference' : 'Already sent it?'}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Paste your transaction hash (or the reference your wallet gave you) so we can find the
          payment. We&apos;ll verify it on-chain and mark your invoice paid.
        </p>
        <form onSubmit={submitReference} className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. 0x9f4c…"
            maxLength={200}
            disabled={submitting}
            className="flex-1 min-w-0 rounded-xl border border-line px-4 py-2.5 text-sm text-ink font-mono placeholder:font-sans placeholder:text-ink-light focus:outline-none focus:border-vital disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-vital px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-vital-dark disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Sending…
              </>
            ) : declared ? (
              'Update reference'
            ) : (
              "I've sent the payment"
            )}
          </button>
        </form>
        {submitError && (
          <p className="mt-2 flex items-start gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {submitError}
          </p>
        )}
      </section>
    </PaymentShell>
  );
}

function BackLink({ token }: { token: string }) {
  return (
    <Link
      href={`/pay/${encodeURIComponent(token)}`}
      className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-5"
    >
      <ArrowLeft className="w-4 h-4" /> Back to your order
    </Link>
  );
}

function Field({
  label,
  value,
  copyValue,
  mono,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyValue?: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 min-w-0 break-all rounded-xl bg-surface border border-line px-3 py-2 text-sm text-ink ${
            mono ? 'font-mono' : 'font-sans font-medium'
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-line text-ink-muted hover:text-ink hover:border-ink/25 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      {copyValue !== undefined && copied && (
        <p className="mt-1 text-xs text-green-700">Copied {copyValue}</p>
      )}
    </div>
  );
}
