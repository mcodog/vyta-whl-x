'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Mail, Lock, LogIn, AlertCircle, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { canAccessWarehouse, type UserRole } from '@/lib/permissions';
import VytaLoader from '@/components/VytaLoader';

export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<
    'checking' | 'not_logged_in' | 'not_allowed' | 'error' | 'allowed'
  >('checking');
  const [userRole, setUserRole] = useState<UserRole>('customer');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAuthState('not_logged_in');
        return;
      }

      const res = await fetch('/api/auth/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });

      if (res.ok) {
        const { customer } = await res.json();
        const role: UserRole = customer?.role || 'customer';
        if (canAccessWarehouse(role)) {
          setUserRole(role);
          setAuthState('allowed');
        } else {
          setAuthState('not_allowed');
        }
      } else {
        setAuthState('error');
      }
    } catch (e) {
      console.error('Warehouse access check failed:', e);
      setAuthState('error');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!email || !password) {
      setLoginError('Enter your email and password');
      return;
    }
    setLoginLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setLoginError(error.message);
        setLoginLoading(false);
        return;
      }
      setAuthState('checking');
      await checkAccess();
    } catch {
      setLoginError('Something went wrong');
      setLoginLoading(false);
    }
  };

  if (authState === 'checking') {
    return <VytaLoader label="Warehouse" message="Verifying access" />;
  }

  if (authState === 'not_logged_in') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-xl p-6 sm:p-8 border border-line shadow-sm">
            <div className="text-center mb-6">
              <h1 className="font-display text-xl font-semibold tracking-[0.28em] text-ink">VYTA</h1>
              <p className="text-xs text-indigo-500 font-semibold uppercase tracking-[0.15em] mt-1">
                Warehouse
              </p>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-sm">{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-indigo-400/40 text-sm text-ink"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-indigo-400/40 text-sm text-ink"
                    placeholder="Enter your password"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {loginLoading ? 'Signing in…' : <><LogIn className="w-4 h-4" /> Sign In</>}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (authState !== 'allowed') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-bold text-ink mb-2">Access Denied</h1>
          <p className="text-ink-muted text-sm mb-6">
            {authState === 'not_allowed'
              ? 'Your account does not have warehouse access.'
              : 'Something went wrong. Try refreshing.'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-ink text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-white border-b border-line">
        <div className="max-w-[1720px] mx-auto px-3 sm:px-5 lg:px-6 py-4 flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/" className="font-display text-base sm:text-lg font-semibold tracking-[0.28em] text-ink shrink-0">VYTA</Link>
            <span className="text-line hidden sm:inline">|</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-indigo-500 uppercase tracking-[0.15em] truncate">
              <PackageCheck className="w-3.5 h-3.5" /> Warehouse
            </span>
            {userRole === 'admin' && (
              <span className="hidden sm:inline ml-1 text-[10px] bg-vital/10 text-vital px-2 py-0.5 rounded-full font-medium shrink-0">
                Admin view
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {userRole === 'admin' && (
              <Link href="/admin" className="hidden sm:inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors text-sm">
                Admin
              </Link>
            )}
            <Link href="/" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Store</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1720px] mx-auto px-3 sm:px-5 lg:px-6 py-8">
        {children}
      </div>
    </div>
  );
}
