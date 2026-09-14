'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, X, Check, Loader2 } from 'lucide-react';
import { useCustomer } from '@/contexts/CustomerContext';

interface NotifyMeButtonProps {
  productId: string;
  productName: string;
  /** `compact` = small badge for grid cards, `full` = full-width button for detail page. */
  variant?: 'compact' | 'full';
  className?: string;
}

type Busy = null | 'checking' | 'subscribing' | 'removing';

export default function NotifyMeButton({
  productId,
  productName,
  variant = 'compact',
  className = '',
}: NotifyMeButtonProps) {
  const { customer } = useCustomer();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [justSubscribed, setJustSubscribed] = useState(false);
  const [justRemoved, setJustRemoved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const checkSubscription = useCallback(
    async (value: string) => {
      if (!value) return;
      setBusy('checking');
      try {
        const url = new URL('/api/stock-notifications', window.location.origin);
        url.searchParams.set('product_id', productId);
        url.searchParams.set('email', value);
        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));
        setSubscribed(!!data.subscribed);
      } catch {
        // Non-fatal: fall back to the subscribe form.
        setSubscribed(false);
      } finally {
        setBusy(null);
      }
    },
    [productId]
  );

  // Prefill with the logged-in customer's email and check status when opening.
  useEffect(() => {
    if (!open) return;
    const prefill = customer?.email ?? '';
    setEmail(prefill);
    setSubscribed(false);
    setJustSubscribed(false);
    setJustRemoved(false);
    setErrorMsg('');
    if (prefill) checkSubscription(prefill);
  }, [open, customer?.email, checkSubscription]);

  // Lock body scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('subscribing');
    setErrorMsg('');
    try {
      const res = await fetch('/api/stock-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, email, customer_id: customer?.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again later.');
      }
      setSubscribed(true);
      setJustSubscribed(true);
      setJustRemoved(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Please try again later.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy('removing');
    setErrorMsg('');
    try {
      const res = await fetch('/api/stock-notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not remove your alert. Please try again later.');
      }
      setSubscribed(false);
      setJustRemoved(true);
      setJustSubscribed(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Please try again later.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {variant === 'full' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`w-full font-semibold py-3 sm:py-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm bg-surface text-ink border border-line hover:border-ink/30 ${className}`}
        >
          <Bell className="w-5 h-5 text-bronze" />
          <span>Notify me when back in stock</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-white text-ink text-xs font-medium rounded-lg border border-line hover:border-bronze/40 transition-all ${className}`}
        >
          <Bell className="w-3.5 h-3.5 text-bronze" />
          <span className="hidden sm:inline">Notify me</span>
          <span className="sm:hidden">Notify</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-line shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 sm:p-6 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-bronze/10 rounded-lg flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5 text-bronze" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink leading-tight">Restock alerts</h3>
                  <p className="text-xs text-ink-muted mt-0.5 line-clamp-1">{productName}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink transition-colors p-1 -mr-1"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            {busy === 'checking' ? (
              <div className="p-10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-ink-muted animate-spin" />
              </div>
            ) : subscribed ? (
              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-3 mb-5">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-ink">
                      {justSubscribed ? "You're on the list" : 'Alert is active'}
                    </h4>
                    <p className="text-sm text-ink-muted mt-0.5">
                      We'll email <span className="font-medium text-ink">{email}</span> as soon as{' '}
                      {productName} is back in stock.
                    </p>
                  </div>
                </div>

                {errorMsg && <p className="text-xs text-red-600 mb-3">{errorMsg}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={handleRemove}
                    disabled={busy === 'removing'}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-ink text-sm font-medium rounded-lg border border-line hover:border-red-300 hover:text-red-600 transition-all disabled:opacity-60"
                  >
                    {busy === 'removing' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <BellOff className="w-4 h-4" />
                    )}
                    Remove alert
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-all"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="p-5 sm:p-6">
                {justRemoved ? (
                  <p className="text-sm text-ink-muted mb-4">
                    Your alert was removed. Want back on the list? Confirm your email below.
                  </p>
                ) : (
                  <p className="text-sm text-ink-muted mb-4">
                    We'll send a one-time email to this address when it's available again.
                  </p>
                )}
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
                />

                {errorMsg && <p className="text-xs text-red-600 mt-2">{errorMsg}</p>}

                <button
                  type="submit"
                  disabled={busy === 'subscribing'}
                  className="w-full mt-5 inline-flex items-center justify-center gap-2 px-5 py-3 bg-ink text-white text-sm font-semibold rounded-xl hover:bg-ink/90 transition-all disabled:opacity-60"
                >
                  {busy === 'subscribing' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      Notify me
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
