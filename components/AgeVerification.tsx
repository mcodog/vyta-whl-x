'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

const STORAGE_KEY = 'aminocan_age_verified';
const EXPIRY_DAYS = 30;

export default function AgeVerification() {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Check if user has already verified
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { expiry } = JSON.parse(stored);
      if (new Date().getTime() < expiry) {
        // Still valid, don't show modal
        return;
      }
    }
    // Show modal after a brief delay for better UX
    setTimeout(() => setShowModal(true), 500);
  }, []);

  const handleAccept = () => {
    // Store verification with expiry
    const expiry = new Date().getTime() + (EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ verified: true, expiry }));
    setShowModal(false);
  };

  const handleDecline = () => {
    // Redirect to Google or another page
    window.location.href = 'https://www.google.com';
  };

  return (
    <AnimatePresence>
      {showModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="bg-brand-diagonal px-6 py-8 text-center">
              <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Age Verification
              </h2>
              <p className="text-white/60 text-sm mt-1">
                You must be 19+ to enter this site
              </p>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Warning Notice */}
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200/60 rounded-xl p-4 mb-6">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  <strong>Research Purposes Only.</strong> Our products are not intended for human or animal consumption.
                </p>
              </div>

              <p className="text-ink text-center mb-2 font-semibold">
                Are you 19 years of age or older?
              </p>

              <p className="text-ink-light text-sm text-center mb-6 leading-relaxed">
                By selecting "Yes", you confirm you are of legal age and agree to our terms and conditions.
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDecline}
                  className="flex-1 py-3.5 px-6 rounded-xl border border-stone-200 text-ink-muted font-medium hover:bg-stone-50 hover:border-stone-300 transition-colors"
                >
                  No, Exit
                </button>
                <button
                  onClick={handleAccept}
                  className="flex-1 py-3.5 px-6 rounded-xl bg-ink hover:bg-ink text-white font-medium transition-colors"
                >
                  Yes, I Agree
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <p className="text-xs text-ink-light text-center leading-relaxed">
                This site is intended for adults 19 years of age or older in accordance with local laws.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
