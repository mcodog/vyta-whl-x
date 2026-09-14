'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAffiliate } from '@/contexts/AffiliateContext';
import { updateAffiliate } from '@/lib/affiliate/api';
import { isValidWalletAddress } from '@/lib/affiliate/utils';
import { User, Wallet, Save, Check, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

export default function AffiliateSettings() {
  const router = useRouter();
  const { affiliate, login } = useAffiliate();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    walletAddress: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!affiliate) {
      router.push('/affiliate/login');
      return;
    }
    setFormData({
      firstName: affiliate.first_name || '',
      lastName: affiliate.last_name || '',
      walletAddress: affiliate.wallet_address || '',
    });
  }, [affiliate, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!affiliate) return;

    const newErrors: Record<string, string> = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (formData.walletAddress && !isValidWalletAddress(formData.walletAddress)) {
      newErrors.walletAddress = 'Invalid Ethereum wallet address';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setIsSaving(true);
    const result = await updateAffiliate(affiliate.id, {
      first_name: formData.firstName,
      last_name: formData.lastName,
      wallet_address: formData.walletAddress || null,
    });

    if (result.success) {
      login({ ...affiliate, first_name: formData.firstName, last_name: formData.lastName, wallet_address: formData.walletAddress || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setErrors({ submit: result.error || 'Failed to update profile' });
    }
    setIsSaving(false);
  };

  if (!affiliate) return null;

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-xl mx-auto px-4 sm:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 sm:mb-8">
            <span className="text-[10px] sm:text-xs font-semibold text-vital uppercase tracking-[0.2em] mb-2 block">
              Settings
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink">Profile Settings</h1>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line shadow-sm"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1.5">Email</label>
                <input
                  type="email"
                  value={affiliate.email}
                  disabled
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-ink-muted text-sm cursor-not-allowed"
                />
                <p className="mt-1 text-[10px] text-ink-muted">Email cannot be changed</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-ink mb-1.5">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                    <input
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      className="w-full pl-10 pr-3 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    />
                  </div>
                  {errors.firstName && <p className="mt-1 text-[10px] text-red-600">{errors.firstName}</p>}
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-ink mb-1.5">Last Name</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                  />
                  {errors.lastName && <p className="mt-1 text-[10px] text-red-600">{errors.lastName}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1.5">
                  Wallet Address <span className="text-ink-muted font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="text"
                    value={formData.walletAddress}
                    onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm font-mono"
                    placeholder="0x..."
                  />
                </div>
                {errors.walletAddress && <p className="mt-1 text-[10px] text-red-600">{errors.walletAddress}</p>}
                <p className="mt-1 text-[10px] text-ink-muted">For crypto commission payouts</p>
              </div>

              {errors.submit && (
                <div className="p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="text-red-700 text-xs sm:text-sm">{errors.submit}</span>
                </div>
              )}

              {saved && (
                <div className="p-2.5 sm:p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700 text-xs sm:text-sm">Profile updated successfully</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {isSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </form>
          </motion.div>

          <div className="mt-6 sm:mt-8 text-center">
            <Link
              href="/affiliate/dashboard"
              className="text-vital hover:text-vital-dark transition-colors text-xs sm:text-sm font-medium"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
