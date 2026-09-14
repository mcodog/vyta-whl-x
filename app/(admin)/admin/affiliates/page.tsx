'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Affiliates are now managed inside "Sales People" as a tier (ADR 0003). This
 * route is kept only to redirect any existing links/bookmarks to the merged
 * surface; the affiliate-specific management (create, edit, requests, report)
 * lives there and on the per-person detail page.
 */
export default function AffiliatesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/sales-people?tier=affiliates');
  }, [router]);

  return (
    <div className="flex items-center justify-center py-16 text-sm text-ink-muted">
      Affiliates have moved to Sales People — redirecting…
    </div>
  );
}
