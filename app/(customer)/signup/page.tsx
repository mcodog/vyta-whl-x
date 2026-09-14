'use client';

import { notFound } from 'next/navigation';
import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, Mail, Lock, User, Phone, ArrowRight, AlertCircle, Check, Beaker } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUpCustomer } from '@/lib/customer/api';
import { getStoredReferral, clearStoredReferral } from '@/lib/affiliate/referral';
import { useCustomer } from '@/contexts/CustomerContext';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { VytaMark } from '@/components/VytaLogo';

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { customer } = useCustomer();

  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const redirect = searchParams.get('redirect') || '/account/dashboard';

  useEffect(() => {
    if (customer) router.push(redirect);
  }, [customer, router, redirect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (!formData.email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    if (!formData.phone.trim()) {
      setError('Please enter your phone number');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    const result = await signUpCustomer({
      email: formData.email,
      password: formData.password,
      firstName: formData.firstName,
      lastName: formData.lastName,
      phone: formData.phone,
      referralCode: getStoredReferral() || undefined,
    });

    if (result.success) {
      // Attribution is now bound to the account; clear the stored referral.
      clearStoredReferral();
      setSuccess(true);
    } else {
      setError(result.error || 'Failed to create account');
    }

    setLoading(false);
  };

  if (success) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28 px-4 sm:px-8 flex items-center justify-center">
          <div className="w-full max-w-md bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line text-center shadow-sm">
            <div className="w-12 sm:w-14 h-12 sm:h-14 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4 sm:mb-5 border border-emerald-100">
              <Check className="w-6 sm:w-7 h-6 sm:h-7 text-emerald-600" />
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-2 sm:mb-3">Check Your Email</h2>
            <p className="text-ink-muted mb-5 sm:mb-6 text-xs sm:text-sm leading-relaxed">
              We sent a confirmation link to <span className="font-medium text-ink">{formData.email}</span>.
              Click the link to verify your account.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-vital hover:text-vital-dark font-semibold text-sm"
            >
              Go to Login
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28 px-4 sm:px-8 flex items-center justify-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line shadow-sm">
            <div className="text-center mb-5 sm:mb-6">
              <VytaMark size={56} className="block mx-auto mb-3 sm:mb-4" title="VYTA Biosciences" />
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-1.5 sm:mb-2">Create Account</h2>
              <p className="text-ink-muted text-xs sm:text-sm">Join us for exclusive access and order tracking</p>
            </div>

            {error && (
              <div className="mb-4 sm:mb-5 p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 sm:gap-3">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-xs sm:text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      className="w-full pl-10 pr-2 sm:pr-3 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                      placeholder="John"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Last Name</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="Min. 6 characters"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-10 py-2.5 sm:py-3 bg-surface rounded-lg border focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted ${
                      formData.confirmPassword
                        ? formData.password === formData.confirmPassword
                          ? 'border-emerald-300'
                          : 'border-red-300'
                        : 'border-line'
                    }`}
                    placeholder="Confirm your password"
                  />
                  {formData.confirmPassword && formData.password === formData.confirmPassword && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {loading ? (
                  <span>Creating account...</span>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 sm:mt-6 text-center">
              <p className="text-ink-muted text-xs sm:text-sm">
                Already have an account?{' '}
                <Link href="/login" className="text-vital hover:text-vital-dark font-medium">
                  Sign in
                </Link>
              </p>
            </div>

            <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-line text-center">
              <p className="text-[10px] sm:text-xs text-ink-muted">
                Want to become an affiliate?{' '}
                <Link href="/affiliate/signup" className="text-vital">
                  Apply here
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      <Footer />
    </main>
  );
}

export default function SignupPage() {
  notFound();
}
