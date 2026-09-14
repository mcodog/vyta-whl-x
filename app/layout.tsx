import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Web3Provider } from '@/contexts/Web3Provider';
import { AffiliateProvider } from '@/contexts/AffiliateContext';
import { CartProvider } from '@/contexts/CartContext';
import { CustomerProvider } from '@/contexts/CustomerContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { SiteConfigProvider } from '@/contexts/SiteConfigContext';
import ChatBubble from '@/components/ChatBubble';
import CartDrawer from '@/components/CartDrawer';
import AgeVerification from '@/components/AgeVerification';
import RouteGuard from '@/components/RouteGuard';
import ReferralCapture from '@/components/ReferralCapture';
import SiteTracking from '@/components/SiteTracking';
import { getSupabase } from '@/lib/supabase';
import { readSiteConfigRow, DEFAULT_SITE_CONFIG } from '@/lib/site-config';

const inter = Inter({ subsets: ['latin'] });

// Branding-aware metadata: the store name and favicon come from the editable
// site config (/admin/marketing), falling back to the built-in defaults.
export async function generateMetadata(): Promise<Metadata> {
  // Resilient: fall back to defaults if the DB/client isn't available at build.
  let config = DEFAULT_SITE_CONFIG;
  try {
    config = await readSiteConfigRow(getSupabase());
  } catch {
    /* use defaults */
  }
  return {
    title: `${config.store_name} - ${config.store_tagline}`,
    description: 'Your trusted source for high-quality peptides worldwide. Fast shipping, secure payment options including cryptocurrency.',
    keywords: 'peptides, research peptides, BPC-157, TB-500, laboratory peptides',
    icons: {
      icon: config.favicon_url || '/favicon.png',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Expose the iOS safe-area insets (home indicator, notch) to CSS via
  // env(safe-area-inset-*), so bottom-anchored UI like the add-to-cart sheet
  // can pad itself clear of the home indicator / browser bottom bar.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SiteConfigProvider>
          <Web3Provider>
            <LanguageProvider>
              <AffiliateProvider>
                <CustomerProvider>
                  <CurrencyProvider>
                  <CartProvider>
                    <ToastProvider>
                      <ReferralCapture />
                      <RouteGuard>
                        {children}
                      </RouteGuard>
                      <CartDrawer />
                      <ChatBubble />
                      <AgeVerification />
                      <SiteTracking />
                    </ToastProvider>
                  </CartProvider>
                  </CurrencyProvider>
                </CustomerProvider>
              </AffiliateProvider>
            </LanguageProvider>
          </Web3Provider>
        </SiteConfigProvider>
      </body>
    </html>
  );
}
