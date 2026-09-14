'use client';

import React, { useState } from 'react';
import { X, Check, AlertCircle, Mail, Loader2, Users } from 'lucide-react';
import { createAffiliate, sendCustomerMagicLink, type AffiliateEmailConflict } from '@/lib/admin/api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateAffiliateModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [priceCurrency, setPriceCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // After success: whether the set-up link went out, any non-fatal error, and
  // whether an existing-login customer was promoted (no link needed).
  const [sent, setSent] = useState<{ email: string; linkError: string | null; promoted?: boolean } | null>(null);
  // The entered email already belongs to a customer — prompt to promote/merge.
  const [conflict, setConflict] = useState<AffiliateEmailConflict | null>(null);
  const [merging, setMerging] = useState(false);

  // Shared post-success step: email the set-up link and land on the success view.
  // Promoted customers who already have a login don't need a set-up link.
  const finishCreated = async (affiliateId: string | undefined, promotedWithLogin: boolean) => {
    if (promotedWithLogin) {
      setSent({ email, linkError: null, promoted: true });
      return;
    }
    if (affiliateId) {
      const linkRes = await sendCustomerMagicLink(affiliateId, '/account/set-password');
      setSent({ email, linkError: linkRes.success ? null : (linkRes.error || 'Could not send the set-up link.') });
    } else {
      setSent({ email, linkError: 'Could not send the set-up link.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !firstName || !lastName) {
      setError('Email, first name, and last name are required.');
      return;
    }

    setLoading(true);
    // Passwordless: the affiliate sets their own password from the set-up link.
    const result = await createAffiliate({
      email,
      first_name: firstName,
      last_name: lastName,
      wallet_address: walletAddress || undefined,
      active,
      price_currency: priceCurrency,
    });

    if (result.conflict) {
      // This email is already a customer — offer to promote/merge them.
      setConflict(result.conflict);
      setLoading(false);
      return;
    }
    if (!result.success) {
      setError(result.error || 'Failed to create affiliate.');
      setLoading(false);
      return;
    }

    await finishCreated(result.affiliate_id, !!result.promoted && !!result.has_login);
    setLoading(false);
  };

  // Confirmed: promote the existing customer into an affiliate (or fold a guest
  // record into a new affiliate), preserving their invoices, orders and prices.
  const confirmMerge = async () => {
    if (!conflict) return;
    setMerging(true);
    setError('');
    const result = await createAffiliate({
      email,
      first_name: firstName,
      last_name: lastName,
      wallet_address: walletAddress || undefined,
      active,
      price_currency: priceCurrency,
      merge_customer_id: conflict.id,
    });
    if (!result.success) {
      setError(result.error || 'Failed to merge the customer.');
      setMerging(false);
      return;
    }
    await finishCreated(result.affiliate_id, !!result.promoted && !!result.has_login);
    setMerging(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">Add Affiliate</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {conflict ? (
          /* This email already belongs to a customer — prompt to promote/merge */
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800 text-sm">
                <span className="font-medium">
                  {[conflict.first_name, conflict.last_name].filter(Boolean).join(' ') || conflict.email}
                </span>{' '}
                (<span className="break-all">{conflict.email}</span>) is already a{' '}
                <span className="font-medium">customer</span>. Creating a new affiliate would split
                this person across two records.
              </span>
            </div>
            <p className="text-sm text-ink">
              {conflict.has_login
                ? 'Promote this customer to an affiliate? They keep their login, and all their invoices, orders and prices carry over.'
                : 'Merge this customer into the new affiliate? Their invoices, orders and prices carry over, and a set-up link is emailed so they can choose a password.'}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConflict(null); setError(''); }}
                disabled={merging}
                className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={merging}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
              >
                {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {merging ? 'Merging…' : conflict.has_login ? 'Promote to affiliate' : 'Merge & create'}
              </button>
            </div>
          </div>
        ) : sent ? (
          /* Success: link emailed (or couldn't be) */
          <div className="px-6 py-5 space-y-4">
            {sent.promoted ? (
              <>
                <div className="flex items-center gap-2 text-emerald-700">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-semibold">Promoted to affiliate</span>
                </div>
                <div className="flex items-start gap-2 p-3 bg-surface border border-line rounded-lg text-sm text-ink">
                  <Users className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                  <span>
                    <span className="font-medium break-all">{sent.email}</span> is now an affiliate.
                    They keep their existing login and history, and now have access to the affiliate
                    portal.
                  </span>
                </div>
              </>
            ) : sent.linkError ? (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-amber-800 text-sm">
                  Affiliate created, but the set-up link couldn&apos;t be emailed:{' '}
                  <span className="font-medium">{sent.linkError}</span>. You can resend it
                  from the Customers list (the <em>Login Link</em> button).
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-emerald-700">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-semibold">Affiliate created</span>
                </div>
                <div className="flex items-start gap-2 p-3 bg-surface border border-line rounded-lg text-sm text-ink">
                  <Mail className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                  <span>
                    A set-up link was emailed to{' '}
                    <span className="font-medium break-all">{sent.email}</span>. They&apos;ll
                    click it to sign in and choose their own password.
                  </span>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={onCreated}
              className="w-full px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-red-700 text-sm">{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">First Name *</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                  placeholder="Jane"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Last Name *</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                  placeholder="Doe"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                placeholder="affiliate@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1">Wallet Address</label>
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-vital/40"
                placeholder="0x..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1">Billing Currency</label>
              <div className="grid grid-cols-2 gap-2">
                {(['CAD', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setPriceCurrency(cur)}
                    aria-pressed={priceCurrency === cur}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      priceCurrency === cur
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface text-ink border-line hover:bg-line/20'
                    }`}
                  >
                    {cur}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                The currency this affiliate is quoted and invoiced in. Can be changed later.
              </p>
            </div>

            <p className="text-xs text-ink-muted">
              The affiliate gets an email with a sign-in link. Clicking it signs them in
              and prompts them to choose their own password, then drops them in the
              admin portal.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="active-create"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-line accent-vital"
              />
              <label htmlFor="active-create" className="text-sm text-ink">Active (can log in)</label>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
              >
                {loading ? 'Creating & sending…' : 'Create Affiliate'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
