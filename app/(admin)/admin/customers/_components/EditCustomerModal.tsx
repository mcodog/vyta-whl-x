'use client';

import React, { useState } from 'react';
import { X, Eye, EyeOff, Copy, Check, RefreshCw, AlertCircle, UserCog } from 'lucide-react';
import { updateCustomer } from '@/lib/admin/api';
import { generatePassword, validatePassword, copyToClipboard } from '@/lib/password';
import type { UserRole } from '@/lib/permissions';
import { useToast } from '@/contexts/ToastContext';
import CustomerPricingPanel from './CustomerPricingPanel';

interface Props {
  customer: any;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditCustomerModal({ customer, onClose, onUpdated }: Props) {
  const toast = useToast();
  const [email, setEmail] = useState(customer.email || '');
  const [alternateEmail, setAlternateEmail] = useState(customer.alternate_email || '');
  const [firstName, setFirstName] = useState(customer.first_name || '');
  const [lastName, setLastName] = useState(customer.last_name || '');
  const [phone, setPhone] = useState(customer.phone || '');
  const [shippingAddress, setShippingAddress] = useState(customer.shipping_address || '');
  const [shippingCity, setShippingCity] = useState(customer.shipping_city || '');
  const [shippingState, setShippingState] = useState(customer.shipping_state || '');
  const [shippingPostalCode, setShippingPostalCode] = useState(customer.shipping_postal_code || '');
  const [shippingCountry, setShippingCountry] = useState(customer.shipping_country || '');
  const [role, setRole] = useState<UserRole>(
    customer.role || (customer.is_admin ? 'admin' : 'customer'),
  );
  const [priceCurrency, setPriceCurrency] = useState<'CAD' | 'USD'>(
    customer.price_currency === 'USD' ? 'USD' : 'CAD',
  );
  // Storefront only: whether this customer's configured prices are CONVERTED
  // into their price currency, or shown and charged as-is in it. Default off —
  // a price list negotiated in the customer's own currency should not be
  // converted a second time.
  const [convertPrices, setConvertPrices] = useState<boolean>(
    customer.convert_storefront_prices === true,
  );
  // Whether new invoices for this customer default to WITH product labels (the
  // sticker on each vial — not the shipping label) or without. Defaults to true.
  const [withLabels, setWithLabels] = useState<boolean>(
    customer.default_with_labels !== false,
  );
  const [active, setActive] = useState(customer.active !== false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGeneratePassword = () => {
    setPassword(generatePassword(16));
    setShowPassword(true);
  };

  const handleCopyPassword = async () => {
    if (!password) return;
    const ok = await copyToClipboard(password);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName && !lastName && !email) {
      setError('Enter a name or email for the customer.');
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
    const result = await updateCustomer(customer.id, {
      email: email || undefined,
      alternate_email: alternateEmail,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: role as 'customer' | 'warehouse' | 'assistant' | 'admin',
      active,
      price_currency: priceCurrency,
      convert_storefront_prices: convertPrices,
      default_with_labels: withLabels,
      password: password || undefined,
      shipping_address: shippingAddress,
      shipping_city: shippingCity,
      shipping_state: shippingState,
      shipping_postal_code: shippingPostalCode,
      shipping_country: shippingCountry,
    });

    if (!result.success) {
      setError(result.error || 'Failed to update customer.');
      toast.error(result.error || 'Failed to update customer.');
      setLoading(false);
      return;
    }

    toast.success('Customer updated');
    onUpdated();
  };

  const fld =
    'w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-ink">Edit Customer</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
          {/* Left column — profile & account */}
          <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={fld}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={fld}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fld}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Alternate Email{' '}
              <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={alternateEmail}
              onChange={(e) => setAlternateEmail(e.target.value)}
              className={fld}
              placeholder="backup@example.com"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Secondary contact address. Not used for sign-in.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fld}
              placeholder="+1 234 567 8900"
            />
          </div>

          <div className="pt-1 border-t border-line">
            <label className="block text-xs font-medium text-ink mb-1 mt-3">
              Shipping Address{' '}
              <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              className={fld}
              placeholder="Street address"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">City</label>
                <input
                  type="text"
                  value={shippingCity}
                  onChange={(e) => setShippingCity(e.target.value)}
                  className={fld}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">State / Province</label>
                <input
                  type="text"
                  value={shippingState}
                  onChange={(e) => setShippingState(e.target.value)}
                  className={fld}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Postal Code</label>
                <input
                  type="text"
                  value={shippingPostalCode}
                  onChange={(e) => setShippingPostalCode(e.target.value)}
                  className={fld}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Country</label>
                <input
                  type="text"
                  value={shippingCountry}
                  onChange={(e) => setShippingCountry(e.target.value)}
                  className={fld}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={fld}
            >
              <option value="customer">Customer</option>
              <option value="warehouse">Warehouse</option>
              <option value="assistant">Assistant</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Price Currency</label>
            <div className="grid grid-cols-2 gap-2">
              {(['CAD', 'USD'] as const).map((cur) => {
                const isActive = priceCurrency === cur;
                return (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setPriceCurrency(cur)}
                    aria-pressed={isActive}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      isActive
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                    }`}
                  >
                    <span className="font-semibold">$</span> {cur}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              New invoices for this customer default to this currency.
            </p>
          </div>

          {/* Only meaningful when the customer is billed in something other than
              the store's base currency — in CAD there is nothing to convert. */}
          {priceCurrency === 'USD' && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Storefront Prices
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: false, label: 'Charge as-is' },
                  { value: true, label: `Convert to ${priceCurrency}` },
                ] as const).map((opt) => {
                  const isActive = convertPrices === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setConvertPrices(opt.value)}
                      aria-pressed={isActive}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        isActive
                          ? 'bg-ink text-white border-ink'
                          : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {convertPrices ? (
                  <>
                    Their configured prices are converted at the store exchange
                    rate, so a list set at 156 is shown and charged as{' '}
                    {priceCurrency} 113-ish.
                  </>
                ) : (
                  <>
                    Their configured prices are shown and charged{' '}
                    <strong>exactly as configured</strong>, just denominated in{' '}
                    {priceCurrency} — a list set at 156 is billed as 156{' '}
                    {priceCurrency}. Storefront only; admin-created invoices are
                    unaffected.
                  </>
                )}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Product Labels</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: true, label: 'With labels' },
                { value: false, label: 'Without labels' },
              ] as const).map((opt) => {
                const isActive = withLabels === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setWithLabels(opt.value)}
                    aria-pressed={isActive}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      isActive
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              New invoices for this customer default to this. The product label is the
              sticker on each vial — not the shipping label.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              New Password{' '}
              <span className="text-ink-muted font-normal">(leave blank to keep current)</span>
            </label>
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  placeholder="Leave blank to keep current"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleCopyPassword}
                disabled={!password}
                className="px-3 py-2 bg-surface border border-line rounded-lg text-ink-muted hover:text-ink transition-colors disabled:opacity-40"
                title="Copy password"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="inline-flex items-center gap-1.5 text-xs text-bronze hover:text-bronze/80 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Generate new password
            </button>
            <p className="mt-1 text-xs text-ink-muted">
              Only applies to customers with a login account.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active-edit-customer"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-line accent-bronze"
            />
            <label htmlFor="active-edit-customer" className="text-sm text-ink">
              Active (can log in)
            </label>
          </div>
          </div>
          {/* End left column */}

          {/* Right column — pricing */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-ink-muted" />
              <h3 className="text-sm font-semibold text-ink">Pricing</h3>
            </div>
            <p className="text-xs text-ink-muted -mt-1">
              Apply a price list or adjust this customer’s custom prices. Pricing changes save on their own — separately from the profile fields.
            </p>
            <CustomerPricingPanel customer={customer} variant="section" />
          </div>
          </div>
          {/* End grid */}

          <div className="flex gap-3 pt-5 mt-5 border-t border-line">
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
