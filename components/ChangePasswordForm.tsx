'use client';

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Check, AlertCircle, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { validatePassword } from '@/lib/password';

type Variant = 'customer' | 'admin';

interface ChangePasswordFormProps {
  /**
   * The signed-in user's email. When provided, the current password is
   * re-verified against Supabase before the change is applied — a small guard
   * against someone changing the password from an unattended session.
   */
  email?: string;
  variant?: Variant;
}

// Two palettes so the form blends into whichever surface it sits on: the
// customer dashboard (slate/cyan) or the admin panel (ink/vital).
const themes = {
  customer: {
    field:
      'w-full pl-10 pr-11 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
    icon: 'text-slate-400',
    button:
      'w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25',
    link: 'text-cyan-600 hover:text-cyan-700',
  },
  admin: {
    field:
      'w-full pl-10 pr-11 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent',
    icon: 'text-ink-muted',
    button:
      'w-full bg-ink hover:bg-ink/90 text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors',
    link: 'text-vital hover:text-vital/80',
  },
} as const;

export default function ChangePasswordForm({ email, variant = 'customer' }: ChangePasswordFormProps) {
  const t = themes[variant];

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent('');
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (email && !current) {
      setError('Enter your current password.');
      return;
    }

    const { valid, errors } = validatePassword(password);
    if (!valid) {
      setError('New password needs: ' + errors.join(', ') + '.');
      return;
    }
    if (password !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (email && current === password) {
      setError('Choose a password different from your current one.');
      return;
    }

    setSaving(true);
    try {
      // Re-verify the current password so an open session alone can't rotate
      // the password. A failed sign-in leaves the existing session intact.
      if (email) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password: current,
        });
        if (signInErr) {
          setError('Current password is incorrect.');
          setSaving(false);
          return;
        }
      }

      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message || 'Could not update your password.');
        setSaving(false);
        return;
      }

      reset();
      setDone(true);
      setSaving(false);
      setTimeout(() => setDone(false), 4000);
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setSaving(false);
    }
  };

  const eyeBtn = 'absolute right-3 top-1/2 -translate-y-1/2 ' + t.icon + ' hover:opacity-70';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-red-700 text-xs">{error}</span>
        </div>
      )}
      {done && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <span className="text-emerald-700 text-xs">Password updated successfully.</span>
        </div>
      )}

      {email && (
        <div className="relative">
          <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${t.icon}`} />
          <input
            type={showCurrent ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={t.field}
            placeholder="Current password"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            aria-label={showCurrent ? 'Hide password' : 'Show password'}
            className={eyeBtn}
          >
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      )}

      <div className="relative">
        <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${t.icon}`} />
        <input
          type={showNew ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={t.field}
          placeholder="New password"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          aria-label={showNew ? 'Hide password' : 'Show password'}
          className={eyeBtn}
        >
          {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <div className="relative">
        <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${t.icon}`} />
        <input
          type={showConfirm ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={t.field}
          placeholder="Confirm new password"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShowConfirm((v) => !v)}
          aria-label={showConfirm ? 'Hide password' : 'Show password'}
          className={eyeBtn}
        >
          {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        8+ characters with an uppercase letter, a lowercase letter, a number, and a symbol.
      </p>

      <button type="submit" disabled={saving} className={t.button}>
        {saving ? (
          'Updating…'
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            <KeyRound className="w-4 h-4" />
            Update Password
          </span>
        )}
      </button>
    </form>
  );
}
