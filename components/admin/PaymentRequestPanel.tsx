'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bitcoin,
  Check,
  ChevronDown,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  Wallet,
} from 'lucide-react';
import { supabase, type Invoice } from '@/lib/supabase';
import PaymentMethodBadge from '@/components/admin/PaymentMethodBadge';

/**
 * "Request Payment" — the invoice screen's control panel for the payment-request
 * email and everything that follows it.
 *
 * Distinct from the "Email Invoice" action above it: that one sends the invoice
 * PDF and is unchanged. This one sends a link to the hosted payment page, then
 * reports back what the customer did with it — which method they chose, the
 * Stealth Health payment link (with the date it was created, so it can be
 * resent), and any crypto transaction reference they submitted.
 *
 * A Stealth Health checkout still waiting to be paid can also be replaced from
 * here: the order behind it can't be edited, so a stale one is retired and a
 * fresh link minted in its place.
 */

const PAY_PATH = (token: string) => `/pay/${token}`;

/** Same shape the server checks — this is only to disable the button early. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What `GET /api/admin/invoices/:id/payment-link` reports before we send. */
interface Readiness {
  /** Hard stops — no email on the invoice, or the vial-SKU lock. Not overridable. */
  blockers: { code: string; message: string }[];
  /** Overridable — line items with no Stealth Health SKU. */
  warnings: { code: string; message: string }[];
  unmapped: { label: string; reason: string; field: string }[];
  /**
   * The SKU lock. When `locked`, no link can be created and any link already in
   * the customer's hands refuses to serve — a line item's own SKU column
   * (`puramass_sku` for a box line, `puramass_sku_vial` for a vial line) is
   * empty, which only a developer can fill in.
   */
  skuLock?: {
    locked: boolean;
    products: {
      productId: string | null;
      label: string;
      reason: string;
      field: 'puramass_sku' | 'puramass_sku_vial' | null;
    }[];
  };
  invoiceHasEmail: boolean;
  suggested_email: string | null;
  cardAvailable: boolean;
  cryptoAvailable: boolean;
  token?: string | null;
}

const SKU_LOCK_FIELD_TEXT: Record<string, string> = {
  puramass_sku: 'no box SKU (puramass_sku)',
  puramass_sku_vial: 'no single-vial SKU (puramass_sku_vial)',
};

const SKU_LOCK_REASON_TEXT: Record<string, string> = {
  missing_sku: 'no Stealth Health SKU on the column this line needs',
  product_missing: 'the linked product no longer exists',
  lookup_failed: 'the products could not be read',
};

const UNMAPPED_REASON_TEXT: Record<string, string> = {
  no_product: 'not linked to a product',
  missing_sku: 'no Stealth Health SKU on the product',
  invalid_sku: 'the product\u2019s Stealth Health SKU is not a catalog SKU',
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const HANDOFF_STATUS_TONE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  payment_pending: 'bg-amber-100 text-amber-700',
  expired: 'bg-surface-2 text-ink-muted',
  cancelled: 'bg-red-100 text-red-600',
  // Replaced by a newer link — ours, not one of PuraMass's own statuses.
  superseded: 'bg-surface-2 text-ink-muted',
};

const HANDOFF_STATUS_LABELS: Record<string, string> = {
  superseded: 'replaced',
};

export default function PaymentRequestPanel({
  invoice,
  canSend,
  onSent,
}: {
  invoice: Invoice;
  /** Admins only — assistants and affiliates see the panel read-only. */
  canSend: boolean;
  onSent: () => void | Promise<void>;
}) {
  // How the admin wants to get the link to the customer. Emailing is the
  // default; "Copy link" is for pasting it into a chat or their own message.
  const [mode, setMode] = useState<'email' | 'link'>('email');
  const [recipient, setRecipient] = useState(
    invoice.payment_email_to || invoice.customer_email || invoice.customer?.email || '',
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  // The link, once it exists. Seeded from the invoice and updated in place when
  // "Copy link" mints one, so the field fills in without a page refresh.
  const [token, setToken] = useState<string | null>(invoice.payment_token);
  const [mintingLink, setMintingLink] = useState(false);
  // Pre-flight, fetched before anything is sent. `null` while it loads.
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  // The admin ticking "send it anyway" over the unmapped-SKU warning.
  const [acknowledged, setAcknowledged] = useState(false);
  // "Copy link" has no recipient box, but the card hand-off still needs an
  // address on the invoice — this is where one gets supplied when it's missing.
  const [customerEmail, setCustomerEmail] = useState(
    invoice.customer_email || invoice.customer?.email || '',
  );
  // Replacing an in-flight Stealth Health checkout. Two-step: the button arms
  // the confirmation, the confirmation does it — this bills a fresh order on a
  // partner API and retires the link the customer may already be holding.
  const [confirmingNewCheckout, setConfirmingNewCheckout] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);

  const handoffs = invoice.payment_handoffs ?? [];
  const latestHandoff = handoffs[0] ?? null;
  const events = invoice.payment_events ?? [];
  const amountDue = invoice.amount_due ?? Math.max(0, Number(invoice.total) - (invoice.amount_paid ?? 0));
  const settled =
    invoice.status === 'paid' || invoice.status === 'cancelled' || amountDue <= 0.005;

  const payUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}${PAY_PATH(token)}`
    : null;

  /* ---- Pre-flight ---------------------------------------------------- */

  // Known from the invoice itself, so the "Copy link" tab doesn't flash an
  // email box while the pre-flight is still in the air.
  const invoiceHasEmail = Boolean(
    (invoice.customer_email || invoice.customer?.email || '').trim(),
  );
  // The address the payment page's card hand-off will end up using: the
  // recipient box in email mode, the customer-email box when copying a link.
  const effectiveEmail = (mode === 'email' ? recipient : customerEmail).trim();
  const emailOk = EMAIL_RE.test(effectiveEmail);
  const warnings = readiness?.warnings ?? [];
  // The SKU lock. Nothing on this panel can clear it — the product needs its
  // `puramass_sku` / `puramass_sku_vial` filling in — so it disables every send
  // path outright.
  const skuLock = readiness?.skuLock;
  const skuLocked = Boolean(skuLock?.locked);
  // The unmapped-SKU warning is overridable; the lock and a missing email are not.
  const blocked = skuLocked || !emailOk || (warnings.length > 0 && !acknowledged);

  const loadReadiness = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/invoices/${invoice.id}/payment-link`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      if (!res.ok) return;
      const data: Readiness = await res.json();
      setReadiness(data);
      if (data.token) setToken((t) => t ?? data.token!);
      // Only ever fill an empty box — never stomp what the admin is typing.
      if (data.suggested_email) setCustomerEmail((v) => v || data.suggested_email!);
    } catch {
      // A failed pre-flight must not lock the panel: the server re-checks on
      // send, so the worst case is the warning shows up a click later.
    }
  }, [invoice.id]);

  useEffect(() => {
    if (canSend && !settled) void loadReadiness();
  }, [canSend, settled, loadReadiness]);

  /* ---- Actions -------------------------------------------------------- */

  // Mint the link without sending anything. Idempotent server-side: an invoice
  // that already has a token gets the same one back.
  const ensureLink = useCallback(async () => {
    if (token || mintingLink) return;
    setError(null);
    setMintingLink(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/invoices/${invoice.id}/payment-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          customer_email: customerEmail.trim(),
          acknowledge_warnings: acknowledged,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server re-runs the pre-flight, so a 409 means our copy was stale.
        if (res.status === 409 && data.requires_acknowledgement) {
          setReadiness((r) => (r ? { ...r, warnings: data.warnings ?? [], unmapped: data.unmapped ?? [] } : r));
          setAcknowledged(false);
        }
        // A lock raised since this panel loaded — take the server's word for it
        // so the reason shows up here rather than only in the error line.
        if (res.status === 422 && data.sku_lock) {
          setReadiness((r) =>
            r ? { ...r, blockers: data.blockers ?? r.blockers, skuLock: data.sku_lock } : r,
          );
        }
        throw new Error(data.error || 'Could not create a payment link');
      }
      setToken(data.token);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create a payment link');
    } finally {
      setMintingLink(false);
    }
  }, [invoice.id, token, mintingLink, customerEmail, acknowledged]);

  // Mint as soon as the "Copy link" tab is clear to go — including right after
  // the admin ticks the override, so the link appears without a second click.
  useEffect(() => {
    if (mode === 'link' && canSend && !settled && !blocked && !token) void ensureLink();
  }, [mode, canSend, settled, blocked, token, ensureLink]);

  const chooseMode = (next: 'email' | 'link') => {
    setMode(next);
    setError(null);
    setSuccess(null);
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      /* clipboard blocked — the value is on screen */
    }
  };

  /**
   * Replace the in-flight Stealth Health checkout with a new one.
   *
   * The old PuraMass order is not cancelled — the partner API has no cancel —
   * so it stays payable there until it expires. That is safe: whichever link is
   * paid, the webhook matches on its transaction and settles this invoice.
   */
  const createNewCheckoutLink = async () => {
    setCheckoutError(null);
    setCheckoutNotice(null);
    setCreatingCheckout(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/invoices/${invoice.id}/checkout-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create a new checkout link');
      setConfirmingNewCheckout(false);
      setCheckoutNotice(
        data.ledger_error
          ? 'New checkout link created, but it could not be recorded against this invoice — ' +
            'a payment on it will not settle the balance automatically. Check the Stealth Health orders page.'
          : 'New checkout link created. The previous link has been replaced.',
      );
      await onSent();
    } catch (e: any) {
      setCheckoutError(e?.message ?? 'Could not create a new checkout link');
    } finally {
      setCreatingCheckout(false);
    }
  };

  const send = async () => {
    setError(null);
    setSuccess(null);
    if (!recipient.trim()) {
      setError('Recipient email is required');
      return;
    }
    if (!EMAIL_RE.test(recipient.trim())) {
      setError('That does not look like a valid email address');
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/invoices/${invoice.id}/payment-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ to: recipient.trim(), acknowledge_warnings: acknowledged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.requires_acknowledgement) {
          setReadiness((r) => (r ? { ...r, warnings: data.warnings ?? [], unmapped: data.unmapped ?? [] } : r));
          setAcknowledged(false);
        }
        if (res.status === 422 && data.sku_lock) {
          setReadiness((r) =>
            r ? { ...r, blockers: data.blockers ?? r.blockers, skuLock: data.sku_lock } : r,
          );
        }
        throw new Error(data.error || 'Send failed');
      }
      setSuccess(`Payment request sent to ${data.to}`);
      // The send mints the token on a first request — pick it up so the
      // "Copy link" tab has something to show without a refresh.
      if (!token && typeof data.payment_url === 'string') {
        const minted = data.payment_url.split('/pay/')[1];
        if (minted) setToken(minted);
      }
      await onSent();
      await loadReadiness();
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-line p-4">
      {/* Header matches the sibling SideCards on this column. */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5" />
          Request Payment
        </h4>
        <PaymentMethodBadge method={invoice.payment_method_selected} />
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Emails the customer a link to pay online — crypto or Visa/Mastercard.
        Separate from the invoice PDF email.
      </p>

      {/* ---- Send / resend --------------------------------------------- */}
      {settled ? (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-800 mb-4">
          <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {invoice.status === 'cancelled'
              ? 'This invoice is cancelled — no payment request can be sent.'
              : 'Nothing outstanding on this invoice.'}
          </span>
        </div>
      ) : canSend ? (
        <div className="mb-4">
          {/* Two ways to get the link to the customer: let us email it, or copy
              it and send it however you like. Both hand out the same URL. */}
          <div className="flex p-0.5 bg-surface rounded-lg border border-line mb-3">
            <ModeTab
              active={mode === 'email'}
              icon={<Send className="w-3.5 h-3.5" />}
              label="Email it"
              onClick={() => chooseMode('email')}
            />
            <ModeTab
              active={mode === 'link'}
              icon={<LinkIcon className="w-3.5 h-3.5" />}
              label="Copy link"
              onClick={() => chooseMode('link')}
            />
          </div>

          {/* The SKU lock. Not a warning and not overridable: no link can be
              created, and one the customer already has stops working. The fix
              is a developer filling in the column that line needs. */}
          {skuLocked && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-800">
                <Lock className="w-3.5 h-3.5" />
                Payment links are locked for this invoice
              </span>
              <p className="mt-1.5 text-[11px] leading-relaxed text-red-800">
                {readiness?.blockers.find((b) => b.code === 'missing_puramass_sku')?.message ??
                  'A line item on this invoice has no Stealth Health SKU on the column it needs. ' +
                    'Please contact developer.'}
              </p>
              {(skuLock?.products.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1">
                  {skuLock!.products.map((prod, i) => (
                    <li
                      key={`${prod.productId ?? prod.label}-${prod.field ?? prod.reason}-${i}`}
                      className="text-[11px] text-red-900"
                    >
                      <span className="font-medium">{prod.label}</span>
                      <span className="text-red-700">
                        {' '}
                        —{' '}
                        {(prod.field && SKU_LOCK_FIELD_TEXT[prod.field]) ??
                          SKU_LOCK_REASON_TEXT[prod.reason] ??
                          prod.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-red-700">
                The customer sees a locked page asking them to contact admin — neither card nor
                crypto is offered — until this is filled in.
              </p>
            </div>
          )}

          {/* Unmapped Stealth Health SKUs. Only hides the card option — the
              invoice is still payable by crypto — so it's a warning the admin
              can wave through rather than a hard stop. */}
          {!skuLocked && warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5" />
                Card payment won&apos;t be available
              </span>
              {warnings.map((w) => (
                <p key={w.code} className="mt-1.5 text-[11px] leading-relaxed text-amber-800">
                  {w.message}
                </p>
              ))}
              {(readiness?.unmapped.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1">
                  {readiness!.unmapped.map((u, i) => (
                    <li key={`${u.label}-${i}`} className="text-[11px] text-amber-900">
                      <span className="font-medium">{u.label}</span>
                      <span className="text-amber-700">
                        {' '}
                        — {UNMAPPED_REASON_TEXT[u.reason] ?? u.reason} ({u.field})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <label className="mt-2.5 flex items-start gap-2 text-[11px] text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => {
                    setAcknowledged(e.target.checked);
                    setError(null);
                  }}
                  className="mt-0.5 accent-amber-600"
                />
                <span>
                  Send it anyway — I know the customer will only see{' '}
                  {readiness?.cryptoAvailable ? 'the crypto option' : 'a page with no payment options'}.
                </span>
              </label>
            </div>
          )}

          {/* The card hand-off to Stealth Health needs an address, and no
              customer action can supply one — so this one is not overridable. */}
          {!emailOk && !skuLocked && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-700">
              <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              <span>
                {effectiveEmail
                  ? `“${effectiveEmail}” is not a valid email address.`
                  : 'A customer email is required. Card payments hand off to Stealth Health, ' +
                    'which will not accept the order without one.'}
              </span>
            </div>
          )}

          {mode === 'email' ? (
            <>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">
                Send to
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="customer@example.com"
                  disabled={sending}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-60"
                />
                <button
                  onClick={send}
                  disabled={sending || blocked}
                  title={
                    skuLocked
                      ? 'Payment links are locked until every line item has the Stealth Health SKU it needs'
                      : blocked && emailOk
                        ? 'Acknowledge the warning above to send'
                        : undefined
                  }
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-bronze hover:bg-bronze-dark text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {invoice.payment_email_sent_at ? 'Resend' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* No recipient box on this tab, so the invoice's own email is
                  what the card hand-off would use. Collect it here when the
                  invoice hasn't got one — it is saved with the link. */}
              {!invoiceHasEmail && (
                <div className="mb-3">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">
                    Customer email
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => {
                      setCustomerEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="customer@example.com"
                    disabled={mintingLink}
                    className="w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-60"
                  />
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Saved to the invoice — Stealth Health needs it to take a card payment.
                  </p>
                </div>
              )}
              <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">
                Payment link
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={
                    payUrl ??
                    (mintingLink
                      ? 'Creating link…'
                      : blocked
                        ? 'Resolve the above to create the link'
                        : '')
                  }
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface rounded-lg border border-line text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <button
                  onClick={() => payUrl && copy('payurl', payUrl)}
                  disabled={!payUrl || mintingLink}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-bronze hover:bg-bronze-dark text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {mintingLink ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : copied === 'payurl' ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copied === 'payurl' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">
                Send this however you like — it opens the same page the email links to.
                It keeps working until the invoice is paid or cancelled.
              </p>
            </>
          )}

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              {error}
            </p>
          )}
          {success && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-green-700">
              <Check className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              {success}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-muted mb-4">
          Only admins can send payment requests.
        </p>
      )}

      {/* ---- Delivery + link -------------------------------------------- */}
      <dl className="space-y-2.5 text-xs">
        <Row label="Last sent">
          {invoice.payment_email_sent_at ? (
            <span className="text-ink">
              {fmtDateTime(invoice.payment_email_sent_at)}
              {invoice.payment_email_to ? ` · ${invoice.payment_email_to}` : ''}
              {invoice.payment_email_sent_by_email
                ? ` · by ${invoice.payment_email_sent_by_email}`
                : ''}
              {invoice.payment_email_count > 1 ? ` · ${invoice.payment_email_count} sends` : ''}
            </span>
          ) : (
            <span className="text-ink-muted">Not sent yet</span>
          )}
        </Row>

        {payUrl && (!canSend || settled) && (
          <Row label="Payment page">
            <CopyableLink
              href={payUrl}
              text={token ? PAY_PATH(token) : payUrl}
              copied={copied === 'payurl'}
              onCopy={() => copy('payurl', payUrl)}
            />
          </Row>
        )}

        <Row label="Method chosen">
          {invoice.payment_method_selected ? (
            <span className="text-ink">
              {invoice.payment_method_selected === 'crypto' ? 'Crypto' : 'Visa / Mastercard'} ·{' '}
              {fmtDateTime(invoice.payment_method_selected_at)}
            </span>
          ) : (
            <span className="text-ink-muted">Customer hasn&apos;t chosen yet</span>
          )}
        </Row>
      </dl>

      {/* ---- Stealth Health hand-offs ----------------------------------- */}
      {latestHandoff && (
        <div className="mt-4 rounded-lg border border-line bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <ExternalLink className="w-3.5 h-3.5 text-bronze" />
              Stealth Health checkout
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                HANDOFF_STATUS_TONE[latestHandoff.status] ?? 'bg-surface-2 text-ink-muted'
              }`}
            >
              {HANDOFF_STATUS_LABELS[latestHandoff.status] ??
                latestHandoff.status.replace(/_/g, ' ')}
            </span>
          </div>
          <dl className="space-y-2 text-xs">
            <Row label="Created">
              <span className="text-ink">{fmtDateTime(latestHandoff.created_at)}</span>
            </Row>
            {latestHandoff.payment_link && (
              <Row label="Payment link">
                <CopyableLink
                  href={latestHandoff.payment_link}
                  text={latestHandoff.payment_link}
                  copied={copied === 'handoff'}
                  onCopy={() => copy('handoff', latestHandoff.payment_link!)}
                  truncate
                />
              </Row>
            )}
            {latestHandoff.transaction_id && (
              <Row label="Transaction">
                <span className="font-mono text-ink break-all">{latestHandoff.transaction_id}</span>
              </Row>
            )}
            {latestHandoff.paid_at && (
              <Row label="Paid">
                <span className="text-ink">{fmtDateTime(latestHandoff.paid_at)}</span>
              </Row>
            )}
          </dl>
          {handoffs.length > 1 && (
            <p className="mt-2 text-[11px] text-ink-muted">
              {handoffs.length - 1} earlier checkout{handoffs.length - 1 === 1 ? '' : 's'} for this
              invoice.
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-muted">
            The checkout bills this invoice&apos;s item prices
            {Number(invoice.shipping_cost) > 0
              ? invoice.charge_shipping_on_checkout
                ? ` plus $${Number(invoice.shipping_cost).toFixed(2)} shipping`
                : ' only — shipping is not charged on it (switch that on by editing the invoice)'
              : ''}
            . Tax and the processing fee can&apos;t be sent to Stealth Health, so an invoice
            carrying either is charged less than its total. Whatever lands is recorded against the
            balance.
          </p>

          {/* A checkout sits at "payment pending" until the customer pays it,
              and the order behind it can't be edited. When it goes stale — the
              link was lost, their checkout timed out, the invoice was corrected
              — this mints a fresh one and retires this one. */}
          {canSend && !settled && !skuLocked && latestHandoff.status === 'payment_pending' && (
            <div className="mt-3 pt-3 border-t border-line">
              {confirmingNewCheckout ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] leading-relaxed text-amber-900">
                    This creates a new Stealth Health checkout and replaces the link above. The old
                    link can&apos;t be cancelled at Stealth Health, so it may still work until it
                    expires — if the customer pays either one, the payment still lands on this
                    invoice.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={createNewCheckoutLink}
                      disabled={creatingCheckout}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bronze hover:bg-bronze-dark text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {creatingCheckout ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {creatingCheckout ? 'Creating…' : 'Create and replace'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingNewCheckout(false);
                        setCheckoutError(null);
                      }}
                      disabled={creatingCheckout}
                      className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-line bg-white text-xs font-medium text-ink-muted hover:text-ink transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingNewCheckout(true);
                    setCheckoutError(null);
                    setCheckoutNotice(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-bronze hover:text-bronze-dark transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Create a new checkout link
                </button>
              )}

              {checkoutError && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                  {checkoutError}
                </p>
              )}
            </div>
          )}

          {checkoutNotice && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-green-700">
              <Check className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              {checkoutNotice}
            </p>
          )}
        </div>
      )}

      {/* ---- Crypto declaration ----------------------------------------- */}
      {invoice.crypto_payment_declared_at && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 mb-2">
            <Bitcoin className="w-3.5 h-3.5" />
            Customer says they sent crypto
          </span>
          <dl className="space-y-2 text-xs">
            <Row label="Reference" tone="amber">
              <span className="font-mono text-amber-900 break-all">
                {invoice.crypto_payment_reference || '—'}
              </span>
            </Row>
            <Row label="Declared" tone="amber">
              <span className="text-amber-900">
                {fmtDateTime(invoice.crypto_payment_declared_at)}
              </span>
            </Row>
            {invoice.crypto_wallet_id && (
              <Row label="Wallet" tone="amber">
                <span className="inline-flex items-center gap-1 text-amber-900">
                  <Wallet className="w-3 h-3" />
                  {invoice.crypto_wallet_id}
                </span>
              </Row>
            )}
          </dl>
          <p className="mt-2 text-[11px] text-amber-800">
            Verify the transfer on-chain, then record the payment above — this declaration does not
            mark the invoice paid.
          </p>
        </div>
      )}

      {/* ---- Timeline ---------------------------------------------------- */}
      {events.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowTimeline((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showTimeline ? 'rotate-180' : ''}`}
            />
            Payment activity ({events.length})
          </button>
          {showTimeline && (
            <ul className="mt-2 space-y-1.5 border-l border-line pl-3">
              {events.map((ev) => (
                <li key={ev.id} className="text-[11px] text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span className="text-ink font-medium">
                      {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                    </span>
                    {ev.method ? ` · ${ev.method}` : ''}
                  </span>
                  <span className="ml-1">— {fmtDateTime(ev.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  email_sent: 'Payment request emailed',
  page_viewed: 'Payment page opened',
  method_selected: 'Method chosen',
  checkout_created: 'Card checkout started',
  crypto_declared: 'Crypto reference submitted',
  paid: 'Payment received',
  failed: 'Something failed',
};

function ModeTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'amber';
}) {
  return (
    <div className="flex items-start gap-3">
      <dt
        className={`w-24 flex-shrink-0 ${tone === 'amber' ? 'text-amber-700' : 'text-ink-muted'}`}
      >
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function CopyableLink({
  href,
  text,
  copied,
  onCopy,
  truncate,
}: {
  href: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  truncate?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`text-bronze hover:text-bronze-dark underline underline-offset-2 min-w-0 ${
          truncate ? 'truncate' : 'break-all'
        }`}
      >
        {text}
      </a>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy link"
        className="flex-shrink-0 p-1 rounded text-ink-muted hover:text-ink transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}
