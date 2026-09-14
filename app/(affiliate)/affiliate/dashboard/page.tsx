'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The affiliate dashboard now lives inside the (minimized) /admin area.
export default function AffiliateDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin');
  }, [router]);
  return null;
}
