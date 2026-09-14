'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Users, Check, AlertCircle, Loader2, Wallet } from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useCustomer } from '@/contexts/CustomerContext';
import { supabase } from '@/lib/supabase';

type View = 'loading' | 'form' | 'pending' | 'submitted' | 'denied';

export default function AffiliateApplyPage() {
  const router = useRouter();
  const { customer, isLoading } = useCustomer();
  const [view, setView] = useState<View>('loading');
  const [wallet, setWallet] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Gate: not logged in -> login; already an affiliate -> portal.
  useEffect(() => {
    if (isLoading) return;
    if (!customer) {
      router.replace('/login?redirect=/affiliate/apply');
      return;
    }
    if (customer.role === 'affiliate') {
      router.replace('/admin');
      return;
    }
    setWallet(customer.wallet_address || '');
    // Check for an existing request.
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        const res = await fetch('/api/affiliate-requests', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json();
        if (data.request?.status === 'pending') setView('pending');
        else if (data.request?.status === 'denied') setView('denied');
        else setView('form');
      } catch {
        setView('form');
      }
    })();
  }, [customer, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/affiliate-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ wallet_address: wallet, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not submit your request');
      }
      setView('submitted');
    } catch (err: any) {
      setError(err.message || 'Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-white">
      <Navigation />
      <section className="max-w-2xl mx-auto px-5 sm:px-8 pt-36 pb-20">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-vital/10 rounded-xl mb-4">
            <Users className="w-6 h-6 text-vital" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-2">Become an Affiliate</h1>
          <p className="text-ink-muted text-sm sm:text-base">
            Earn commission on every customer you bring to VYTA. Submit a request and our team will review it.
          </p>
        </div>

        {view === 'loading' && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-ink-muted animate-spin" />
          </div>
        )}

        {(view === 'pending' || view === 'submitted') && (
          <div className="bg-white border border-line rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-1">
              {view === 'submitted' ? 'Request submitted' : 'Request pending'}
            </h2>
            <p className="text-sm text-ink-muted">
              Your application is being reviewed. We'll email you once a decision is made.
            </p>
          </div>
        )}

        {(view === 'form' || view === 'denied') && (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit}
            className="bg-white border border-line rounded-2xl p-6 sm:p-8 space-y-5"
          >
            {view === 'denied' && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-ink">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                A previous request wasn't approved. You're welcome to apply again.
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                Payout wallet address (optional)
              </label>
              <div className="relative">
                <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full pl-10 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-ink placeholder-ink-muted text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                Tell us about yourself (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="How do you plan to promote VYTA? Audience, channels, etc."
                className="w-full px-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-ink placeholder-ink-muted text-sm resize-none"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-ink text-white text-sm font-semibold rounded-xl hover:bg-ink/90 transition-all disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Submit request
            </button>
          </motion.form>
        )}
      </section>
      <Footer />
    </main>
  );
}
