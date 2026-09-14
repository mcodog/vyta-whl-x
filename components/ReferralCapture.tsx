'use client';

import { useEffect } from 'react';
import { captureReferralFromUrl } from '@/lib/affiliate/referral';

/**
 * Invisible component that records a `?ref=` referral code on first page load
 * so it can be attributed to the visitor's account at signup / first order.
 */
export default function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  return null;
}
