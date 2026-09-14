'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, AlertCircle, Check, Beaker, KeyRound, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useCustomer } from '@/contexts/CustomerContext';
import { validatePassword } from '@/lib/password';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

export default function SetPasswordPage() {
  const { customer, isLoading, refreshCustomer } = useCustomer();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Where to send them once their password is set.
  const destination = customer?.role === 'affiliate' ? '/admin' : '/account/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const { valid, errors } = validatePassword(password);
    if (!valid) {
      setError('Password requirements: ' + errors.join(', ') + '.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message || 'Could not set your password.');
        setSaving(false);
        return;
      }
      await refreshCustomer();
      setDone(true);
      setTimeout(() => {
        window.location.href = destination;
      }, 1500);
    } catch {
      setError('An unexpected error occurred.');
      setSaving(false);
    }
  };

  const fld =
    'w-full pl-10 pr-11 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted';

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28 px-4 sm:px-8 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line shadow-sm">
            {isLoading ? (
              <div className="py-10 text-center text-ink-muted text-sm">Verifying your link…</div>
            ) : !customer ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-surface rounded-xl flex items-center justify-center mx-auto mb-4 border border-line">
                  <AlertCircle className="w-6 h-6 text-ink-muted" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-ink mb-2">Link invalid or expired</h2>
                <p className="text-ink-muted text-sm mb-5">
                  This set-up link is no longer valid. Ask an administrator to send you a
                  new sign-in link, or sign in if you already have a password.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90"
                >
                  Go to sign in <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : done ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-emerald-200">
                  <Check className="w-6 h-6 text-emerald-600" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-ink mb-1">Password set</h2>
                <p className="text-ink-muted text-sm">Taking you to your account…</p>
              </div>
            ) : (
              <>
                <div className="text-center mb-5 sm:mb-6">
                  <div className="w-12 sm:w-14 h-12 sm:h-14 bg-ink rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                    <KeyRound className="w-6 sm:w-7 h-6 sm:h-7 text-white" />
                  </div>
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-1.5 sm:mb-2">
                    Set your password
                  </h2>
                  <p className="text-ink-muted text-xs sm:text-sm">
                    Welcome{customer.first_name ? `, ${customer.first_name}` : ''}! Choose a
                    password to finish setting up your account.
                  </p>
                </div>

                {error && (
                  <div className="mb-4 sm:mb-5 p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 sm:gap-3">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-red-700 text-xs sm:text-sm">{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">
                      New password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={fld}
                        placeholder="Choose a password"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      8+ characters with an uppercase letter, a lowercase letter, a number,
                      and a symbol.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">
                      Confirm password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className={fld}
                        placeholder="Re-enter password"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        aria-label={showConfirm ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                      >
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
                  >
                    {saving ? <span>Saving…</span> : (
                      <>
                        <span>Set password & continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-line text-center">
                  <p className="text-[10px] sm:text-xs text-ink-muted inline-flex items-center justify-center gap-1.5">
                    <Beaker className="w-3 h-3 text-vital" /> Research Only · Shipping to Canada
                  </p>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>

      <Footer />
    </main>
  );
}
