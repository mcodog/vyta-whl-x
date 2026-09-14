'use client';

import React from 'react';
import { useSiteConfig } from '@/contexts/SiteConfigContext';
import { ShieldCheck } from 'lucide-react';

/**
 * Chrome shared by every step of the invoice payment flow: a slim branded
 * header, a centred column, and a trust footer. Deliberately NOT the storefront
 * navigation — a customer arriving from a payment email is here to do one
 * thing, so the page keeps a single focus rather than offering the shop.
 */
export default function PaymentShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { config } = useSiteConfig();
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="border-b border-line bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {config.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.logo_url} alt={config.store_name} className="h-7 w-auto" />
            ) : (
              <span className="text-lg font-semibold tracking-tight text-ink truncate">
                {config.store_name}
              </span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck className="w-4 h-4 text-vital" />
            Secure payment
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className={`mx-auto px-4 sm:px-6 py-8 sm:py-12 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {children}
        </div>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 text-xs text-ink-light">
          Questions about this invoice? Reply to the email we sent you and our team will help.
        </div>
      </footer>
    </div>
  );
}
