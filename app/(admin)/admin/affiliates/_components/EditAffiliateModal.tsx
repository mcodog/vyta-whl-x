'use client';

import React, { useState } from 'react';
import { X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { updateAffiliate } from '@/lib/admin/api';
import { validatePassword } from '@/lib/password';
import type { Affiliate } from '@/lib/supabase';

interface Props {
  affiliate: Affiliate;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditAffiliateModal({ affiliate, onClose, onUpdated }: Props) {
  const [email, setEmail] = useState(affiliate.email);
  const [firstName, setFirstName] = useState(affiliate.first_name);
  const [lastName, setLastName] = useState(affiliate.last_name);
  const [walletAddress, setWalletAddress] = useState(affiliate.wallet_address || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [active, setActive] = useState(affiliate.active);
  const [manualCodeOnly, setManualCodeOnly] = useState(affiliate.manual_code_only ?? false);
  const [priceCurrency, setPriceCurrency] = useState<'CAD' | 'USD'>(
    affiliate.price_currency === 'USD' ? 'USD' : 'CAD',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !firstName || !lastName) {
      setError('Email, first name, and last name are required.');
      return;
    }

    if (password) {
      const { valid, errors } = validatePassword(password);
      if (!valid) {
        setError('Password requirements: ' + errors.join(', ') + '.');
        return;
      }
    }

    setLoading(true);
    const result = await updateAffiliate(affiliate.id, {
      email,
      first_name: firstName,
      last_name: lastName,
      wallet_address: walletAddress || undefined,
      active,
      manual_code_only: manualCodeOnly,
      price_currency: priceCurrency,
      ...(password ? { password } : {}),
    });

    if (!result.success) {
      setError(result.error || 'Failed to update affiliate.');
      setLoading(false);
      return;
    }

    onUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">Edit Affiliate</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
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
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Wallet Address</label>
            <input
              type="text"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40"
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
              The currency this affiliate is quoted and invoiced in. Their client dashboard
              and new invoices lock to this; existing invoices keep their own currency.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">New Password (leave blank to keep current)</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3 pr-10 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40"
                placeholder="New password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active-edit"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-line accent-bronze"
            />
            <label htmlFor="active-edit" className="text-sm text-ink">Active (can log in)</label>
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="manual-code-only-edit"
              checked={manualCodeOnly}
              onChange={(e) => setManualCodeOnly(e.target.checked)}
              className="mt-0.5 rounded border-line accent-bronze"
            />
            <label htmlFor="manual-code-only-edit" className="text-sm text-ink">
              Manual code only
              <span className="block text-xs text-ink-muted">
                Bound customers don&apos;t get the discount auto-applied — they must enter the
                referral code (or arrive via a referral link).
              </span>
            </label>
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
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
