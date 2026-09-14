'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, Package, ArrowRight, Beaker } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';

interface WaitlistProduct {
  product_id: string;
  name: string | null;
  slug: string | null;
  image_url: string | null;
  price: number | null;
  stock_quantity: number | null;
  count: number;
  latest_request: string;
}

async function fetchStockRequests(): Promise<{ products: WaitlistProduct[]; totalRequests: number }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  const response = await fetch('/api/admin/stock-notifications', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to load stock requests (${response.status})`);
  }
  return response.json();
}

export default function StockRequestsPage() {
  const { data, loading, slow, error, reload } = useSmartLoad(fetchStockRequests, []);

  const products = data?.products ?? [];
  const totalRequests = data?.totalRequests ?? 0;

  return (
    <>
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-bronze" />
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Stock Requests</h1>
        </div>
        <p className="text-sm text-ink-muted">
          Products customers are waiting on. Most-requested first — restock a product and everyone
          on its list is emailed automatically.
        </p>
      </div>

      {/* Summary cards */}
      {!loading && !error && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl p-5 border border-line">
            <p className="text-2xl md:text-3xl font-bold text-ink tabular-nums">{products.length}</p>
            <p className="text-xs text-ink-muted mt-1">Products with requests</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-line">
            <p className="text-2xl md:text-3xl font-bold text-ink tabular-nums">{totalRequests}</p>
            <p className="text-xs text-ink-muted mt-1">Total people waiting</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {error ? (
          <LoadingError onRetry={reload} />
        ) : loading ? (
          <div className="p-5 md:p-6">
            {slow && <SlowLoadingNotice onReload={reload} />}
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 animate-pulse">
                  <div className="w-10 h-10 bg-surface rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-48 bg-surface rounded" />
                    <div className="h-3 w-24 bg-surface rounded" />
                  </div>
                  <div className="h-6 w-12 bg-surface rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ) : products.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell className="w-6 h-6 text-ink-muted" />
            </div>
            <h3 className="text-base font-semibold text-ink mb-1">No requests yet</h3>
            <p className="text-sm text-ink-muted">
              When customers ask to be notified about out-of-stock products, they'll show up here.
            </p>
          </div>
        ) : (
          <>
          {/* Desktop table (≥lg); mobile cards below. Per ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Waiting</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Current Stock</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Latest Request</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {products.map((p) => (
                  <tr key={p.product_id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-surface border border-line flex items-center justify-center overflow-hidden shrink-0">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name || ''} className="w-full h-full object-contain" />
                          ) : (
                            <Beaker className="w-5 h-5 text-line" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">{p.name || 'Unknown product'}</div>
                          {p.price != null && (
                            <div className="text-xs text-ink-muted tabular-nums">${p.price}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold bg-bronze/10 text-bronze tabular-nums">
                        <Bell className="w-3.5 h-3.5" />
                        {p.count}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {p.stock_quantity && p.stock_quantity > 0 ? (
                        <span className="text-sm text-emerald-600 font-medium tabular-nums">{p.stock_quantity} in stock</span>
                      ) : (
                        <span className="text-sm text-red-600 font-medium">Out of stock</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted">
                      {new Date(p.latest_request).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href="/admin/products"
                        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
                      >
                        <Package className="w-4 h-4" />
                        Restock
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (below lg) */}
          <ul className="lg:hidden divide-y divide-line/50">
            {products.map((p) => (
              <li key={p.product_id} className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface border border-line flex items-center justify-center overflow-hidden shrink-0">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name || ''} className="w-full h-full object-contain" />
                    ) : (
                      <Beaker className="w-5 h-5 text-line" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{p.name || 'Unknown product'}</div>
                    {p.price != null && <div className="text-xs text-ink-muted tabular-nums">${p.price}</div>}
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold bg-bronze/10 text-bronze tabular-nums shrink-0">
                    <Bell className="w-3.5 h-3.5" />
                    {p.count}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-ink-muted">
                    {p.stock_quantity && p.stock_quantity > 0 ? (
                      <span className="text-emerald-600 font-medium tabular-nums">{p.stock_quantity} in stock</span>
                    ) : (
                      <span className="text-red-600 font-medium">Out of stock</span>
                    )}
                    {' · '}{new Date(p.latest_request).toLocaleDateString()}
                  </div>
                  <Link
                    href="/admin/products"
                    className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors shrink-0"
                  >
                    <Package className="w-4 h-4" /> Restock <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </>
  );
}
