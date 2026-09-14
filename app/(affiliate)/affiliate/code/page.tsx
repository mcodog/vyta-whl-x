"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAffiliate } from "@/contexts/AffiliateContext";
import { getReferralCodes } from "@/lib/affiliate/api";
import type { ReferralCode } from "@/lib/supabase";
import { Copy, Check, Share2, Beaker } from "lucide-react";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function ReferralCodePage() {
  const router = useRouter();
  const { affiliate } = useAffiliate();
  const [referralCodes, setReferralCodes] = useState<ReferralCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!affiliate) {
      router.push("/affiliate/login");
      return;
    }

    loadReferralCodes();
  }, [affiliate, router]);

  const loadReferralCodes = async () => {
    if (!affiliate) return;

    setIsLoading(true);
    const codes = await getReferralCodes(affiliate.id);
    setReferralCodes(codes);
    setIsLoading(false);
  };

  const copyToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const copyReferralUrl = async (code: string) => {
    const url = `${window.location.origin}?ref=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(`url-${code}`);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  };

  if (!affiliate) return null;

  const primaryCode = referralCodes.find((c) => c.active);

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 lg:px-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-6 sm:mb-8 md:mb-10"
          >
            <div className="w-12 sm:w-14 h-12 sm:h-14 bg-ink rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Beaker className="w-6 sm:w-7 h-6 sm:h-7 text-white" />
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-bronze uppercase tracking-[0.2em] mb-2 sm:mb-3 block">
              Your Referral Code
            </span>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink mb-2 sm:mb-3">
              Share & Earn
            </h1>
            <p className="text-ink-muted text-xs sm:text-sm">
              Share your unique referral code and earn commission on every sale
            </p>
          </motion.div>

          {isLoading ? (
            <div className="text-center py-8 sm:py-12">
              <div className="animate-pulse text-ink-muted text-xs sm:text-sm">
                Loading your referral code...
              </div>
            </div>
          ) : !primaryCode ? (
            <div className="bg-white rounded-xl p-6 sm:p-8 border border-line text-center">
              <div className="w-12 sm:w-14 h-12 sm:h-14 bg-surface rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <Share2 className="w-6 sm:w-7 h-6 sm:h-7 text-line" />
              </div>
              <p className="text-ink-muted text-xs sm:text-sm">
                No referral code found.
              </p>
              <p className="text-ink-muted text-[10px] sm:text-xs mt-1 sm:mt-2">
                Please contact support.
              </p>
            </div>
          ) : (
            <>
              {/* Main Referral Code Card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-xl p-5 sm:p-6 md:p-10 border border-line mb-4 sm:mb-5"
              >
                <div className="text-center mb-6 sm:mb-8">
                  <p className="text-ink-muted text-xs sm:text-sm mb-3 sm:mb-4">
                    Your Unique Referral Code
                  </p>
                  <div className="inline-block max-w-full bg-surface rounded-xl p-4 sm:p-6 md:p-8 border border-line mb-4 sm:mb-6">
                    <div className="text-2xl sm:text-4xl md:text-5xl font-bold text-ink tracking-wider font-mono break-all">
                      {primaryCode.code}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
                    <button
                      onClick={() => copyToClipboard(primaryCode.code)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 bg-ink hover:bg-ink/90 text-white font-semibold rounded-lg transition-all text-xs sm:text-sm"
                    >
                      {copiedCode === primaryCode.code ? (
                        <>
                          <Check className="w-4 h-4" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copy Code
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => copyReferralUrl(primaryCode.code)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 bg-white hover:bg-surface border border-line text-ink font-semibold rounded-lg transition-colors text-xs sm:text-sm"
                    >
                      {copiedCode === `url-${primaryCode.code}` ? (
                        <>
                          <Check className="w-4 h-4" /> URL Copied!
                        </>
                      ) : (
                        <>
                          <Share2 className="w-4 h-4" /> Copy Referral URL
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4 pt-4 sm:pt-6 border-t border-line">
                  <div className="text-center">
                    <div className="text-lg sm:text-2xl font-bold text-ink mb-0.5 sm:mb-1 tabular-nums">
                      {primaryCode.uses_count}
                    </div>
                    <p className="text-[10px] sm:text-xs text-ink-muted">
                      Times Used
                    </p>
                  </div>
                  <div className="text-center">
                    {/* <div className="text-lg sm:text-2xl font-bold text-bronze mb-0.5 sm:mb-1">
                      10%
                    </div>
                    <p className="text-[10px] sm:text-xs text-ink-muted">
                      Commission Rate
                    </p> */}
                  </div>
                  <div className="text-center">
                    <div className="text-lg sm:text-2xl font-bold mb-0.5 sm:mb-1">
                      {primaryCode.active ? (
                        <span className="text-emerald-600">Active</span>
                      ) : (
                        <span className="text-red-600">Inactive</span>
                      )}
                    </div>
                    <p className="text-[10px] sm:text-xs text-ink-muted">
                      Status
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* How to Share Section */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line"
              >
                <h2 className="text-base sm:text-lg font-bold text-ink mb-4 sm:mb-6 flex items-center gap-2">
                  <Share2 className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                  How to Share Your Code
                </h2>

                <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
                  <div className="text-center">
                    <div className="w-10 sm:w-12 h-10 sm:h-12 bg-bronze/10 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                      <span className="text-base sm:text-lg font-bold text-bronze">
                        1
                      </span>
                    </div>
                    <h3 className="font-semibold text-ink text-xs sm:text-sm mb-1 sm:mb-2">
                      Share Your Code
                    </h3>
                    <p className="text-[10px] sm:text-xs text-ink-muted leading-relaxed">
                      Give your unique code to friends, family, or customers
                    </p>
                  </div>

                  <div className="text-center">
                    <div className="w-10 sm:w-12 h-10 sm:h-12 bg-bronze/10 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                      <span className="text-base sm:text-lg font-bold text-bronze">
                        2
                      </span>
                    </div>
                    <h3 className="font-semibold text-ink text-xs sm:text-sm mb-1 sm:mb-2">
                      They Make a Purchase
                    </h3>
                    <p className="text-[10px] sm:text-xs text-ink-muted leading-relaxed">
                      Customers use your code at checkout on Aminocan
                    </p>
                  </div>

                  <div className="text-center">
                    <div className="w-10 sm:w-12 h-10 sm:h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                      <span className="text-base sm:text-lg font-bold text-emerald-600">
                        3
                      </span>
                    </div>
                    <h3 className="font-semibold text-ink text-xs sm:text-sm mb-1 sm:mb-2">
                      Earn Commission
                    </h3>
                    <p className="text-[10px] sm:text-xs text-ink-muted leading-relaxed">
                      You earn of their order total automatically
                    </p>
                  </div>
                </div>

                <div className="mt-4 sm:mt-6 bg-surface rounded-lg p-3 sm:p-4 border border-line">
                  <p className="text-center text-ink-muted text-[10px] sm:text-xs">
                    <span className="text-bronze font-medium">Pro Tip:</span>{" "}
                    Share your referral URL on social media, blogs, or email to
                    make it even easier for people to use your code!
                  </p>
                </div>
              </motion.div>
            </>
          )}

          {/* Back to Dashboard */}
          <div className="mt-6 sm:mt-8 text-center">
            <Link
              href="/affiliate/dashboard"
              className="text-bronze hover:text-bronze-dark transition-colors text-xs sm:text-sm font-medium"
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
