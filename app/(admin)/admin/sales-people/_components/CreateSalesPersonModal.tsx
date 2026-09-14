'use client';

import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { createSalesPerson } from '@/lib/admin/sales-persons';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateSalesPersonModal({ onClose, onCreated }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [commissionRate, setCommissionRate] = useState('5');
  const [boxDiscount, setBoxDiscount] = useState('0');
  const [vialDiscount, setVialDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }

    const rate = Number(commissionRate);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      setError('Commission rate must be between 0 and 100.');
      return;
    }

    const boxPct = Number(boxDiscount);
    const vialPct = Number(vialDiscount);
    if ([boxPct, vialPct].some((n) => Number.isNaN(n) || n < 0 || n > 100)) {
      setError('Default discounts must be between 0 and 100.');
      return;
    }

    setLoading(true);
    try {
      await createSalesPerson({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        commission_rate: rate,
        default_box_discount_pct: boxPct,
        default_vial_discount_pct: vialPct,
        notes: notes.trim() || null,
        active,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sales person.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">Add Sales Person</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

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
                placeholder="Jane"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                placeholder="Doe"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              placeholder="sales@example.com"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                placeholder="555-123-4567"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Commission Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Line-item discount presets (%)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={boxDiscount}
                  onChange={(e) => setBoxDiscount(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <p className="text-[11px] text-ink-muted mt-1">Box (pack-of-10) lines</p>
              </div>
              <div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={vialDiscount}
                  onChange={(e) => setVialDiscount(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <p className="text-[11px] text-ink-muted mt-1">Single-vial lines</p>
              </div>
            </div>
            <p className="text-[11px] text-ink-muted mt-1">
              Pre-fills the Disc % on new invoice lines for this sales person. 0 = no preset; still editable per line.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              placeholder="Optional notes"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active-create"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-line accent-bronze"
            />
            <label htmlFor="active-create" className="text-sm text-ink">Active</label>
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
              {loading ? 'Creating...' : 'Create Sales Person'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
