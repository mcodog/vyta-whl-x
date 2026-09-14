'use client';

import React, { useState } from 'react';
import { X, Eye, EyeOff, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { updateUser } from '@/lib/admin/api';
import { generatePassword, validatePassword, copyToClipboard } from '@/lib/password';
import type { UserRole } from '@/lib/permissions';
import type { Customer } from '@/lib/supabase';

interface Props {
  user: Customer;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditUserModal({ user, onClose, onUpdated }: Props) {
  const [email, setEmail] = useState(user.email);
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [phone, setPhone] = useState(user.phone || '');
  const [role, setRole] = useState<UserRole>(user.role || 'customer');
  const [active, setActive] = useState(user.active !== false);
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
    const result = await updateUser(user.id, {
      email,
      first_name: firstName,
      last_name: lastName,
      phone: phone || undefined,
      role,
      active,
      password: password || undefined,
    });

    if (!result.success) {
      setError(result.error || 'Failed to update user.');
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
          <h2 className="text-base font-bold text-ink">Edit User</h2>
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
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
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
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              placeholder="+1 234 567 8900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            >
              <option value="customer">Customer</option>
              <option value="warehouse">Warehouse</option>
              <option value="analytics">Analytics</option>
              <option value="assistant">Assistant</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">New Password <span className="text-ink-muted font-normal">(leave blank to keep current)</span></label>
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-vital/40"
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
              className="inline-flex items-center gap-1.5 text-xs text-vital hover:text-vital/80 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Generate new password
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active-edit"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-line accent-vital"
            />
            <label htmlFor="active-edit" className="text-sm text-ink">Active (can log in)</label>
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
