'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Affiliates now log in through the unified customer login and land in /admin.
export default function AffiliateLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login?redirect=/admin');
  }, [router]);
  return null;
}
