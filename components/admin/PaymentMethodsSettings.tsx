'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bitcoin,
  Check,
  CreditCard,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  emptyReceivingWallet,
  type ReceivingWallet,
} from '@/lib/payments/receiving-wallets';
import { PAYMENT_MERGE_VARS } from '@/lib/payment-email-templates';

/**
 * Settings for the invoice *payment request* — the second customer email, the
 * hosted payment page it links to, and the two ways a customer can pay from it.
 *
 * Renders two sibling section cards so they slot into the Settings page's
 * `space-y-6` column and pick up its right-rail scroll-spy:
 *   #payment-emails  — the email template + which methods the page offers
 *   #crypto-payments — the receiving wallets and their instructions
 *
 * Edits are held locally and committed with an explicit Save, so a half-typed
 * wallet address is never written to the row the customer page reads.
 */

export interface PaymentSettingsValue {
  crypto_wallets: ReceivingWallet[];
  crypto_payment_instructions: string;
  payment_email_subject: string;
  payment_email_body: string;
  payment_crypto_enabled: boolean;
  payment_card_enabled: boolean;
  /** Read-only: card also needs the PuraMass credentials + config switch. */
  payment_card_available: boolean;
}

interface Props {
  settings: PaymentSettingsValue;
  saving: boolean;
  isReadOnly: boolean;
  onSave: (updates: Partial<PaymentSettingsValue>) => void | Promise<void>;
}

export default function PaymentMethodsSettings({
  settings,
  saving,
  isReadOnly,
  onSave,
}: Props) {
  // ---- local drafts -------------------------------------------------------
  const [wallets, setWallets] = useState<ReceivingWallet[]>(settings.crypto_wallets);
  const [instructions, setInstructions] = useState(settings.crypto_payment_instructions);
  const [subject, setSubject] = useState(settings.payment_email_subject);
  const [bodyText, setBodyText] = useState(settings.payment_email_body);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Re-sync when the page (re)loads settings from the server.
  useEffect(() => setWallets(settings.crypto_wallets), [settings.crypto_wallets]);
  useEffect(
    () => setInstructions(settings.crypto_payment_instructions),
    [settings.crypto_payment_instructions],
  );
  useEffect(() => setSubject(settings.payment_email_subject), [settings.payment_email_subject]);
  useEffect(() => setBodyText(settings.payment_email_body), [settings.payment_email_body]);

  const templateDirty =
    subject !== settings.payment_email_subject || bodyText !== settings.payment_email_body;
  const cryptoDirty =
    instructions !== settings.crypto_payment_instructions ||
    JSON.stringify(wallets) !== JSON.stringify(settings.crypto_wallets);

  const patchWallet = (id: string, patch: Partial<ReceivingWallet>) =>
    setWallets((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const addWallet = () =>
    setWallets((ws) => [
      ...ws,
      emptyReceivingWallet(`w${Date.now().toString(36)}${ws.length}`),
    ]);

  const removeWallet = (id: string) => setWallets((ws) => ws.filter((w) => w.id !== id));

  const saveCrypto = () => {
    setWalletError(null);
    // Mirror the server's rule so the admin sees the problem inline rather than
    // as a failed request: a wallet needs both a label and an address.
    const incomplete = wallets.filter(
      (w) => (w.label.trim() || w.address.trim()) && !(w.label.trim() && w.address.trim()),
    );
    if (incomplete.length > 0) {
      setWalletError('Every wallet needs both a label and an address.');
      return;
    }
    onSave({
      crypto_wallets: wallets.filter((w) => w.label.trim() && w.address.trim()),
      crypto_payment_instructions: instructions,
    });
  };

  const activeWalletCount = wallets.filter((w) => w.enabled && w.label && w.address).length;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Payment Emails                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div id="payment-emails" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-ink" />
          <h2 className="text-lg font-semibold text-ink">Payment Emails</h2>
        </div>
        <p className="text-sm text-ink-muted mb-5">
          A second email you can send from any invoice, separate from the invoice
          PDF email above. It links the customer to a page on this site showing
          their order, where they choose how to pay. Send it from{' '}
          <span className="font-medium text-ink">Invoices → the invoice → Request Payment</span>.
        </p>

        <p className="text-sm font-medium text-ink mb-2">Methods offered on the payment page</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          <MethodToggle
            icon={<Bitcoin className="w-4 h-4" />}
            title="Crypto"
            subtitle={
              activeWalletCount > 0
                ? `${activeWalletCount} wallet${activeWalletCount === 1 ? '' : 's'} configured`
                : 'No wallets configured yet'
            }
            checked={settings.payment_crypto_enabled}
            disabled={saving || isReadOnly}
            warning={
              settings.payment_crypto_enabled && activeWalletCount === 0
                ? 'Add a wallet below — until then this option stays hidden from customers.'
                : null
            }
            onChange={(v) => onSave({ payment_crypto_enabled: v })}
          />
          <MethodToggle
            icon={<CreditCard className="w-4 h-4" />}
            title="Visa / Mastercard"
            subtitle="PuraMass hosted checkout"
            checked={settings.payment_card_enabled}
            disabled={saving || isReadOnly}
            warning={
              settings.payment_card_enabled && !settings.payment_card_available
                ? 'PuraMass is not available on this server, so the option stays hidden. See the PuraMass Checkout section.'
                : null
            }
            onChange={(v) => onSave({ payment_card_enabled: v })}
          />
        </div>

        <label className="block text-sm font-medium text-ink mb-1.5" htmlFor="payment-email-subject">
          Subject
        </label>
        <input
          id="payment-email-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isReadOnly}
          className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 mb-4"
        />

        <label className="block text-sm font-medium text-ink mb-1.5" htmlFor="payment-email-body">
          Message
        </label>
        <textarea
          id="payment-email-body"
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={11}
          disabled={isReadOnly}
          className="w-full px-4 py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink font-mono leading-relaxed disabled:opacity-50"
        />
        <p className="text-[11px] text-ink-muted mt-2">
          The <code className="text-ink">{'{{payment_url}}'}</code> line becomes a
          &ldquo;Pay invoice&rdquo; button in the email. If you remove it, the link is appended
          anyway so the customer always has a way to pay.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {PAYMENT_MERGE_VARS.map((v) => (
            <button
              key={v.name}
              type="button"
              title={v.description}
              disabled={isReadOnly}
              onClick={() => setBodyText((b) => `${b}{{${v.name}}}`)}
              className="px-2 py-1 rounded-md bg-surface border border-line text-[11px] font-mono text-ink-muted hover:text-ink hover:border-ink/25 transition-colors disabled:opacity-50"
            >
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => onSave({ payment_email_subject: subject, payment_email_body: bodyText })}
            disabled={saving || isReadOnly || !templateDirty}
            className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save template
          </button>
          {templateDirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Crypto Payments                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div id="crypto-payments" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-5 h-5 text-ink" />
          <h2 className="text-lg font-semibold text-ink">Crypto Payments</h2>
        </div>
        <p className="text-sm text-ink-muted mb-5">
          The wallets a customer can send to when they pick &ldquo;Crypto&rdquo; on the
          payment page. Each one appears with its address, a QR code, and the exact
          amount due. Turning a wallet off hides it without losing the address.
        </p>

        {wallets.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-line rounded-xl text-sm text-ink-muted mb-4">
            No receiving wallets yet. Add one so customers can pay by crypto.
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            {wallets.map((w) => (
              <div key={w.id} className="rounded-xl border border-line bg-surface/60 p-4">
                <div className="flex items-start gap-3">
                  <GripVertical className="w-4 h-4 text-ink-light mt-2.5 flex-shrink-0 hidden sm:block" />
                  <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-3">
                    <Input
                      label="Label"
                      placeholder="USDT"
                      value={w.label}
                      disabled={isReadOnly}
                      onChange={(v) => patchWallet(w.id, { label: v })}
                    />
                    <Input
                      label="Network"
                      placeholder="Tron (TRC-20)"
                      value={w.network}
                      disabled={isReadOnly}
                      onChange={(v) => patchWallet(w.id, { network: v })}
                    />
                    <div className="sm:col-span-2">
                      <Input
                        label="Receiving address"
                        placeholder="T…"
                        mono
                        value={w.address}
                        disabled={isReadOnly}
                        onChange={(v) => patchWallet(w.id, { address: v })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label="Memo / tag (optional)"
                        placeholder="Only for chains that require one"
                        mono
                        value={w.memo}
                        disabled={isReadOnly}
                        onChange={(v) => patchWallet(w.id, { memo: v })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => removeWallet(w.id)}
                      disabled={isReadOnly}
                      aria-label={`Remove ${w.label || 'wallet'}`}
                      className="p-2 text-ink-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    disabled={isReadOnly}
                    onChange={(e) => patchWallet(w.id, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-line text-bronze focus:ring-bronze/40"
                  />
                  Show this wallet to customers
                </label>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addWallet}
          disabled={isReadOnly}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink hover:border-ink/25 transition-colors disabled:opacity-50 mb-5"
        >
          <Plus className="w-4 h-4" /> Add wallet
        </button>

        <label className="block text-sm font-medium text-ink mb-1.5" htmlFor="crypto-instructions">
          Instructions shown with the wallet
        </label>
        <textarea
          id="crypto-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="Leave blank to use the built-in wording (send only on the named network, sender pays network fees)."
          disabled={isReadOnly}
          className="w-full px-4 py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink leading-relaxed disabled:opacity-50"
        />

        {walletError && (
          <p className="mt-3 flex items-start gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {walletError}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveCrypto}
            disabled={saving || isReadOnly || !cryptoDirty}
            className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save wallets
          </button>
          {cryptoDirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
        </div>

        <p className="text-[11px] text-ink-muted mt-4">
          A customer who pays in crypto submits their transaction hash on the
          instructions page. That does <span className="font-medium text-ink">not</span> mark the
          invoice paid — verify the transfer, then record the payment on the invoice.
        </p>
      </div>
    </>
  );
}

function MethodToggle({
  icon,
  title,
  subtitle,
  checked,
  disabled,
  warning,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  disabled: boolean;
  warning: string | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className={`rounded-xl border-2 p-4 transition-colors ${
        checked ? 'border-bronze bg-bronze/5' : 'border-line bg-white'
      }`}
    >
      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <span className="flex items-start gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-bronze/10 text-bronze flex-shrink-0">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{title}</span>
            <span className="block text-xs text-ink-muted mt-0.5">{subtitle}</span>
          </span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 mt-1 rounded border-line text-bronze focus:ring-bronze/40 flex-shrink-0 disabled:opacity-50"
        />
      </label>
      {warning && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  placeholder,
  disabled,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  );
}
