"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Check,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      // Send the BARE origin, with no path. Supabase's "Reset Password" email
      // template already appends `/account/set-password` to
      // `{{ .ConfirmationURL }}` (see docs/supabase-auth-email-templates.md),
      // and that suffix lands on the end of the `redirect_to` the URL carries.
      // Adding the path here too is what produced the doubled
      // `/account/set-password/account/set-password` landing URL.
      const redirectTo =
        typeof window !== "undefined" ? window.location.origin : undefined;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo }
      );

      // Don't surface the raw Supabase error — it can reveal rate-limit details
      // or whether an account exists. Log it and fall through to the neutral
      // success message either way.
      if (resetError) {
        console.error("Password reset error:", resetError);
      }
      setSent(true);
    } catch (err) {
      console.error("Password reset error:", err);
      setError("An unexpected error occurred. Please try again.");
    }

    setLoading(false);
  };

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
            {sent ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-emerald-200">
                  <Check className="w-6 h-6 text-emerald-600" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-ink mb-2">
                  Check your email
                </h2>
                <p className="text-ink-muted text-sm mb-5">
                  If an account exists for <span className="font-medium text-ink">{email}</span>,
                  we&apos;ve sent a link to reset your password. The link will
                  expire shortly, so use it soon.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center mb-5 sm:mb-6">
                  <div className="w-12 sm:w-14 h-12 sm:h-14 bg-ink rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                    <KeyRound className="w-6 sm:w-7 h-6 sm:h-7 text-white" />
                  </div>
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-1.5 sm:mb-2">
                    Forgot your password?
                  </h2>
                  <p className="text-ink-muted text-xs sm:text-sm">
                    Enter your email and we&apos;ll send you a link to reset it.
                  </p>
                </div>

                {error && (
                  <div className="mb-4 sm:mb-5 p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 sm:gap-3">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-red-700 text-xs sm:text-sm">{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
                  >
                    {loading ? (
                      <span>Sending…</span>
                    ) : (
                      <>
                        <span>Send reset link</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-5 sm:mt-6 text-center">
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-bronze hover:text-bronze-dark font-medium"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to sign in
                  </Link>
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
