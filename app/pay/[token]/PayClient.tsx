'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Bitcoin,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
} from 'lucide-react';
import PaymentShell from './_components/PaymentShell';
import OrderSummary from './_components/OrderSummary';
import { money, type PayView } from './_components/types';

/**
 * Step 1 of the payment flow: show the order, then offer the two ways to pay.
 * Crypto routes to the instructions page on this site; card hands off to the
 * PuraMass hosted checkout and redirects to the returned payment link.
 */
export default function PayClient({ token }: { token: string }) {
  const router = useRouter();
  const [view, setView] = useState<PayView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<'crypto' | 'card' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'This payment link is not valid.');
        return;
      }
      setView(data as PayView);
      setLoadError(null);
    } catch {
      setLoadError('We could not load this invoice. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const chooseCrypto = async () => {
    setActionError(null);
    setStarting('crypto');
    try {
      // Record the choice, then move on. A failed record shouldn't strand the
      // customer — the instructions page works regardless.
      await fetch(`/api/pay/${encodeURIComponent(token)}/method`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'crypto' }),
      }).catch(() => null);
      router.push(`/pay/${encodeURIComponent(token)}/crypto`);
    } finally {
      setStarting(null);
    }
  };

  const chooseCard = async () => {
    setActionError(null);
    setStarting('card');
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment_link) {
        setActionError(data.error || 'The card checkout could not be started.');
        setStarting(null);
        return;
      }
      // Hand off to the hosted checkout. Keep the spinner up — this navigates.
      window.location.href = data.payment_link;
    } catch {
      setActionError('The card checkout could not be started. Please try again.');
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <PaymentShell>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your invoice…
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
          <p className="text-sm text-ink-muted max-w-sm mx-auto">
            {loadError ?? 'This payment link is not valid.'} If you received it by email, reply to
            that message and we&apos;ll send you a new one.
          </p>
        </div>
      </PaymentShell>
    );
  }

  const { invoice, methods } = view;
  const settled = !invoice.payable;
  // Locked wins over "no methods": the customer is not choosing between
  // payment options that happen to be off, they are being asked to get in
  // touch. The reason lives on the admin side.
  const locked = Boolean(view.locked);
  const noMethods = !methods.crypto && !methods.card;

  return (
    <PaymentShell>
      <header className="mb-7">
        <p className="text-xs uppercase tracking-[0.12em] text-vital font-semibold mb-2">
          Invoice {invoice.invoice_number}
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
          {settled
            ? 'Nothing left to pay'
            : locked
              ? 'This payment link is on hold'
              : invoice.customer_name
                ? `Hi ${invoice.customer_name.split(' ')[0]}, your order is ready for payment`
                : 'Your order is ready for payment'}
        </h1>
        {!settled && !locked && (
          <p className="mt-2 text-sm text-ink-muted">
            Choose how you&apos;d like to pay the {money(invoice.amount_due, invoice.currency)}{' '}
            balance below.
          </p>
        )}
      </header>

      {settled && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {invoice.status === 'cancelled'
              ? 'This invoice has been cancelled — no payment is needed.'
              : 'This invoice has been paid in full. Thank you!'}
          </span>
        </div>
      )}

      {invoice.crypto_payment_declared_at && !settled && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-vital/30 bg-vital-50 px-4 py-3 text-sm text-ink">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-vital" />
          <span>
            Thanks — we have your transaction reference and are confirming it on-chain. We&apos;ll
            email you as soon as the payment clears.
          </span>
        </div>
      )}

      {locked && !settled && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {view.locked_message ??
              'This payment link is locked and cannot be used right now. Please contact admin.'}
          </span>
        </div>
      )}

      <OrderSummary invoice={invoice} />

      {!settled && !locked && (
        <section className="mt-7">
          <h2 className="text-sm font-semibold text-ink mb-3">How would you like to pay?</h2>

          {noMethods ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                No online payment methods are available for this invoice right now. Reply to your
                invoice email and we&apos;ll arrange payment with you directly.
              </span>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {methods.crypto && (
                <MethodCard
                  icon={<Bitcoin className="w-5 h-5" />}
                  title="Pay with crypto"
                  description="Send to our receiving wallet and confirm with your transaction hash."
                  cta="Get wallet details"
                  busy={starting === 'crypto'}
                  disabled={starting !== null}
                  onClick={chooseCrypto}
                />
              )}
              {methods.card && (
                <MethodCard
                  icon={<CreditCard className="w-5 h-5" />}
                  title="Visa / Mastercard"
                  description="Pay by card on our secure hosted checkout. No account needed."
                  cta="Continue to checkout"
                  busy={starting === 'card'}
                  disabled={starting !== null}
                  onClick={chooseCard}
                />
              )}
            </div>
          )}

          {actionError && (
            <p className="mt-3 flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {actionError}
            </p>
          )}
        </section>
      )}
    </PaymentShell>
  );
}

function MethodCard({
  icon,
  title,
  description,
  cta,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group text-left bg-white rounded-2xl border-2 p-5 transition-all ${
        busy ? 'border-vital' : 'border-line hover:border-vital hover:shadow-sm'
      } ${disabled && !busy ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-vital-50 text-vital mb-3">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted leading-snug">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-vital-dark">
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Starting…
          </>
        ) : (
          <>
            {cta}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </span>
    </button>
  );
}
