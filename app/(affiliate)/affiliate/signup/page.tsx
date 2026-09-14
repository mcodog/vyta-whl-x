'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Becoming an affiliate is now a request/approval flow at /affiliate/apply.
export default function AffiliateSignupRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/affiliate/apply');
  }, [router]);
  return null;
}
