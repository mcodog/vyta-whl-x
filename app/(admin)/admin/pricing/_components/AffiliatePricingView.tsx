'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Network, Edit2, Users, ChevronRight, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getMergedSalesPeople, type MergedSalesPerson } from '@/lib/admin/sales-persons';
import { useToast } from '@/contexts/ToastContext';

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface CustomerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  affiliate_id: string | null;
  price_currency: 'CAD' | 'USD';
  pricing_mode: 'template' | 'dedicated';
  applied_pricelist: { id: string; name: string } | null;
}

const nameOf = (c: { first_name: string | null; last_name: string | null; email: string }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

function CurrencyChip({ currency }: { currency: 'CAD' | 'USD' }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        currency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-surface text-ink-muted border border-line'
      }`}
    >
      <span className="font-semibold">$</span>{currency}
    </span>
  );
}

function ModeBadge({ mode }: { mode: 'template' | 'dedicated' }) {
  return (
    <span
      title={mode === 'template' ? 'Prices are a copy of an applied price list' : 'Prices are hand-managed for this customer'}
      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        mode === 'dedicated' ? 'bg-bronze/10 text-bronze' : 'bg-emerald-500/10 text-emerald-600'
      }`}
    >
      {mode === 'dedicated' ? 'Dedicated' : 'Template'}
    </span>
  );
}

// "Edit pricelist" link → the per-customer pricing editor (apply a list,
// multiply/convert, or hand-edit). Same target the Customer Pricing cards use.
function EditPricelistLink({ id, size = 'sm' }: { id: string; size?: 'sm' | 'xs' }) {
  return (
    <Link
      href={`/admin/pricing/customer/${id}`}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-ink text-white font-medium hover:bg-ink/90 transition-colors ${
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'
      }`}
    >
      <Edit2 className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-3 h-3'} /> Edit pricelist
    </Link>
  );
}

export default function AffiliatePricingView() {
  const toast = useToast();
  const [affiliates, setAffiliates] = useState<MergedSalesPerson[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [overrideCounts, setOverrideCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [merged, custRes, ovRes] = await Promise.all([
          getMergedSalesPeople(),
          fetch('/api/admin/customers', { headers: await authHeaders() }),
          fetch('/api/admin/price-overrides', { headers: await authHeaders() }),
        ]);
        setAffiliates((merged || []).filter((p) => p.is_affiliate && p.user_id));

        const { customers: cs } = custRes.ok ? await custRes.json() : { customers: [] };
        setCustomers(
          (cs || []).map((c: any) => ({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            email: c.email,
            affiliate_id: c.affiliate_id ?? null,
            price_currency: c.price_currency === 'USD' ? 'USD' : 'CAD',
            pricing_mode: c.pricing_mode === 'dedicated' ? 'dedicated' : 'template',
            applied_pricelist: c.applied_pricelist ? { id: c.applied_pricelist.id, name: c.applied_pricelist.name } : null,
          })),
        );

        const { overrides } = ovRes.ok ? await ovRes.json() : { overrides: [] };
        const counts = new Map<string, number>();
        for (const o of overrides || []) {
          if (o.override_price == null) continue;
          counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1);
        }
        setOverrideCounts(counts);
      } catch {
        toast.error('Failed to load affiliate pricing');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerById = useMemo(() => {
    const m = new Map<string, CustomerRow>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const boundByAffiliate = useMemo(() => {
    const m = new Map<string, CustomerRow[]>();
    for (const c of customers) {
      if (!c.affiliate_id) continue;
      const arr = m.get(c.affiliate_id) ?? [];
      arr.push(c);
      m.set(c.affiliate_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return m;
  }, [customers]);

  const groups = useMemo(() => {
    return affiliates
      .map((a) => {
        const uid = a.user_id as string;
        return {
          affiliate: a,
          uid,
          own: customerById.get(uid) ?? null,
          bound: boundByAffiliate.get(uid) ?? [],
        };
      })
      .sort((a, b) => nameOf(a.affiliate as any).localeCompare(nameOf(b.affiliate as any)));
  }, [affiliates, customerById, boundByAffiliate]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return groups;
    return groups.filter((g) => {
      const aff = g.affiliate as any;
      const code = g.affiliate.affiliate?.referral_code ?? '';
      return (
        nameOf(aff).toLowerCase().includes(q) ||
        (aff.email ?? '').toLowerCase().includes(q) ||
        code.toLowerCase().includes(q) ||
        g.bound.some((c) => nameOf(c).toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      );
    });
  }, [groups, search]);

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search affiliates, referral codes, or their customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center text-ink-muted text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-ink-muted/30 border-t-ink-muted rounded-full animate-spin" />
            Loading affiliate pricing…
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center">
          <Network className="w-8 h-8 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-ink-muted text-sm">
            {search ? 'No affiliates match your search' : 'No affiliates yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((g) => {
            const aff = g.affiliate as any;
            const ownCurrency = g.own?.price_currency ?? 'CAD';
            const ownCount = overrideCounts.get(g.uid) ?? 0;
            return (
              <div key={g.uid} className="bg-white rounded-xl border border-line p-5 flex flex-col">
                {/* Affiliate header — their own pricing record */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <Network className="w-3.5 h-3.5 text-emerald-600" /> {nameOf(aff)}
                      </span>
                      {g.affiliate.affiliate?.referral_code && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-line text-ink-muted">
                          {g.affiliate.affiliate.referral_code}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted truncate">{aff.email || '—'}</div>
                  </div>
                  <EditPricelistLink id={g.uid} />
                </div>

                {/* Affiliate's own price summary */}
                <div className="flex items-center flex-wrap gap-2 text-[11px] text-ink-muted mb-3 pb-3 border-b border-line/70">
                  <span className="inline-flex items-center gap-1"><ListChecks className="w-3 h-3" /> Own prices</span>
                  <CurrencyChip currency={ownCurrency} />
                  {g.own && <ModeBadge mode={g.own.pricing_mode} />}
                  <span className="tabular-nums">{ownCount} custom price{ownCount !== 1 ? 's' : ''}</span>
                  {g.own?.applied_pricelist && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bronze/10 text-bronze font-medium">
                      {g.own.applied_pricelist.name}
                    </span>
                  )}
                </div>

                {/* Bound customers — the prices this affiliate's list drives */}
                <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-ink">
                  <Users className="w-3.5 h-3.5 text-ink-muted" />
                  Bound customers
                  <span className="text-ink-muted font-normal tabular-nums">({g.bound.length})</span>
                </div>
                {g.bound.length === 0 ? (
                  <div className="text-xs text-ink-muted py-2">No bound customers yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {g.bound.map((c) => {
                      const count = overrideCounts.get(c.id) ?? 0;
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-surface/40 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-ink truncate">{nameOf(c)}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <CurrencyChip currency={c.price_currency} />
                              <ModeBadge mode={c.pricing_mode} />
                              <span className="text-[10px] text-ink-muted tabular-nums">{count} price{count !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          <Link
                            href={`/admin/pricing/customer/${c.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-bronze hover:text-bronze/80 whitespace-nowrap"
                          >
                            Edit <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
