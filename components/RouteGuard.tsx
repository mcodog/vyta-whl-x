'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCustomer } from '@/contexts/CustomerContext';
import authConfig from '../auth.config.js';

// Paths accessible without login when requireAuth is true. /pay is the invoice
// payment page: its link is emailed to the customer (who may be a guest with no
// account), so the token in the URL is the credential — gating it behind a login
// would break every payment link already sent out.
const PUBLIC_PATHS = ['/login', '/affiliate/login', '/affiliate/signup', '/pay'];

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const { customer, isLoading } = useCustomer();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => {
    if (!authConfig.requireAuth) return;
    if (isLoading) return;
    if (customer) return;
    if (!isPublic) {
      router.replace('/login');
    }
  }, [customer, isLoading, isPublic, router]);

  // Pass-through when auth is not required
  if (!authConfig.requireAuth) return <>{children}</>;

  // Show loading while determining auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-ink">Loading...</span>
      </div>
    );
  }

  // Not logged in and not on a public path — render nothing while redirect fires
  if (!customer && !isPublic) return null;

  return <>{children}</>;
}
