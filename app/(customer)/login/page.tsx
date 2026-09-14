"use client";

import React, { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogIn,
  Mail,
  Lock,
  ArrowRight,
  AlertCircle,
  Beaker,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useCustomer } from "@/contexts/CustomerContext";
import PeptideLoader from "@/components/PeptideLoader";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { VytaMark } from '@/components/VytaLogo';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { customer } = useCustomer();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [verifyingActive, setVerifyingActive] = useState(false);

  const explicitRedirect = searchParams.get("redirect");
  const redirect = explicitRedirect || "/products";

  // Warehouse staff land straight on their fulfillment dashboard (unless they
  // were explicitly redirected somewhere by the route guard).
  const destinationFor = (role?: string | null) =>
    role === "warehouse" && !explicitRedirect ? "/warehouse" : redirect;

  useEffect(() => {
    if (customer && !verifyingActive) router.push(destinationFor(customer.role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, router, redirect, verifyingActive]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }

    setLoading(true);
    setVerifyingActive(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setVerifyingActive(false);
      } else if (data.session) {
        // Check active before allowing the useEffect redirect to fire
        const { data: profile } = await supabase
          .from("customers")
          .select("active, role")
          .eq("id", data.user.id)
          .single();

        if (profile && profile.active === false) {
          await supabase.auth.signOut();
          setError("This account has been deactivated. Please contact support.");
          setVerifyingActive(false);
        } else {
          // Active — redirect immediately (no artificial delay).
          setVerifyingActive(false);
          window.location.href = destinationFor(profile?.role);
          return;
        }
      } else {
        setVerifyingActive(false);
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("An unexpected error occurred");
      setVerifyingActive(false);
    }

    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <AnimatePresence>
        {showAnimation && (
          <PeptideLoader message="Signing you in..." type="login" />
        )}
      </AnimatePresence>

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28 px-4 sm:px-8 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line shadow-sm">
            <div className="text-center mb-5 sm:mb-6">
              <VytaMark size={56} className="block mx-auto mb-3 sm:mb-4" title="VYTA Biosciences" />
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-1.5 sm:mb-2">
                Welcome Back
              </h2>
              <p className="text-ink-muted text-xs sm:text-sm">
                Sign in to your account
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
                    className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1 sm:mb-1.5">
                  <label className="block text-xs sm:text-sm font-medium text-ink">
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-[11px] sm:text-xs text-vital hover:text-vital-dark font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {loading ? (
                  <span>Signing in...</span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* <div className="mt-5 sm:mt-6 text-center">
              <p className="text-ink-muted text-xs sm:text-sm">
                Don&apos;t have an account?{" "}
                <Link
                  href="/signup"
                  className="text-vital hover:text-vital-dark font-medium"
                >
                  Create one
                </Link>
              </p>
            </div> */}

            <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-line text-center">
              <p className="text-[10px] sm:text-xs text-ink-muted">
                Looking for affiliate login?{" "}
                <Link href="/affiliate/login" className="text-vital">
                  Click here
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

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <span className="text-ink">Loading...</span>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
