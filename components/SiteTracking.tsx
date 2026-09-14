'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useSiteConfig } from '@/contexts/SiteConfigContext';

// Where the visitor's choice is remembered.
const CONSENT_KEY = 'aminocan.trackingConsent'; // 'granted' | 'denied'
type Consent = 'granted' | 'denied' | 'unknown';

/**
 * Injects GA4 + Meta Pixel and, when consent is required, shows a cookie-consent
 * banner that gates them. Pixels are only rendered once consent is granted (or
 * when consent is not required). Reads its config from SiteConfigProvider, so it
 * renders nothing until at least one tracking ID is configured.
 */
export default function SiteTracking() {
  const { config } = useSiteConfig();
  const { ga4_measurement_id: ga4, meta_pixel_id: pixel, tracking_consent_required } = config;

  const [consent, setConsent] = useState<Consent>('unknown');
  const pathname = usePathname();

  // Load any prior choice on mount (client only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONSENT_KEY);
      if (saved === 'granted' || saved === 'denied') setConsent(saved);
      else setConsent('unknown');
    } catch {
      setConsent('unknown');
    }
  }, []);

  const decide = (choice: 'granted' | 'denied') => {
    setConsent(choice);
    try { localStorage.setItem(CONSENT_KEY, choice); } catch { /* ignore */ }
  };

  const hasTracking = Boolean(ga4 || pixel);
  // Load pixels when consent isn't required, or when the visitor granted it.
  const shouldLoad = hasTracking && (!tracking_consent_required || consent === 'granted');
  // Show the banner only when consent is required and not yet decided.
  const showBanner = hasTracking && tracking_consent_required && consent === 'unknown';

  // Fire a page_view / PageView on client-side route changes once loaded.
  useEffect(() => {
    if (!shouldLoad) return;
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
      fbq?: (...args: unknown[]) => void;
    };
    if (ga4 && typeof w.gtag === 'function') {
      w.gtag('config', ga4, { page_path: pathname });
    }
    if (pixel && typeof w.fbq === 'function') {
      w.fbq('track', 'PageView');
    }
  }, [pathname, shouldLoad, ga4, pixel]);

  if (!hasTracking) return null;

  return (
    <>
      {shouldLoad && ga4 && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ga4}');`}
          </Script>
        </>
      )}

      {shouldLoad && pixel && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixel}');
fbq('track', 'PageView');`}
        </Script>
      )}

      {showBanner && (
        <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
          <div className="mx-auto max-w-3xl rounded-xl border border-line bg-white shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <p className="text-sm text-ink-muted flex-1">
              We use cookies for analytics to understand site traffic and improve your
              experience. You can accept or decline analytics tracking.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => decide('denied')}
                className="px-4 py-2 rounded-lg text-sm font-medium text-ink border border-line bg-surface hover:bg-line/20 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={() => decide('granted')}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-ink hover:bg-ink/90 transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
