'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListChecks, Users, Network } from 'lucide-react';
import { usePermissions } from '@/lib/hooks/usePermissions';
import PriceListsView from './_components/PriceListsView';
import CustomerOverridesView from './_components/CustomerOverridesView';
import AffiliatePricingView from './_components/AffiliatePricingView';

type PricingView = 'lists' | 'overrides' | 'affiliates';

// The Pricing page hosts three workspaces:
//   1. Price Lists       — named, reusable price lists (the default, main view).
//   2. Customer Pricing  — per-customer price overrides (the previous page).
//   3. Affiliate Pricing — affiliates and the bound-customer prices they drive.
// Affiliates only manage per-customer overrides for their bound customers, so
// they never see the Price Lists / Affiliate Pricing toggles.
function PricingPage() {
  const { userRole } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canManageLists = userRole === 'admin' || userRole === 'assistant';
  // Seed the active workspace from the URL so it survives navigating into a
  // price list / customer and hitting Back; written back on change.
  const [view, setView] = useState<PricingView>(() => {
    const v = searchParams.get('view');
    if (v === 'lists' || v === 'overrides' || v === 'affiliates') return v;
    return canManageLists ? 'lists' : 'overrides';
  });

  const activeView: PricingView = canManageLists ? view : 'overrides';

  // Merge-write only our own key so the child views' search params are kept.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (activeView === 'overrides' || activeView === 'affiliates') params.set('view', activeView);
    else params.delete('view');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, pathname, router]);

  const subtitle =
    activeView === 'lists'
      ? 'Build reusable price lists and apply them to customers'
      : activeView === 'affiliates'
        ? 'Affiliates and the customer prices their price lists drive'
        : 'Manage customer-specific price overrides';

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-1">Pricing</h1>
          <p className="text-ink-muted text-sm">{subtitle}</p>
        </div>

        {canManageLists && (
          <div className="inline-flex rounded-lg border border-line bg-surface p-1 self-start">
            {([
              { value: 'lists', label: 'Price Lists', icon: ListChecks },
              { value: 'overrides', label: 'Customer Pricing', icon: Users },
              { value: 'affiliates', label: 'Affiliate Pricing', icon: Network },
            ] as const).map(({ value, label, icon: Icon }) => {
              const active = activeView === value;
              return (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? 'bg-white text-ink shadow-sm border border-line'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeView === 'lists' ? (
        <PriceListsView />
      ) : activeView === 'affiliates' ? (
        <AffiliatePricingView />
      ) : (
        <CustomerOverridesView />
      )}
    </>
  );
}

export default function PricingPageWrapper() {
  // PricingPage (and its child views) read the URL via useSearchParams, which
  // Next requires to sit inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <PricingPage />
    </Suspense>
  );
}
