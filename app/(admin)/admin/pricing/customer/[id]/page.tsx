'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Save, Search, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, RotateCcw, Eye, EyeOff, ListChecks, ChevronDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/contexts/ToastContext';
import CustomerPricingPanel from '@/app/(admin)/admin/customers/_components/CustomerPricingPanel';

// Attach the current session's bearer token (the price-overrides API is
// role-scoped; affiliates only see/manage their bound customers).
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface PriceOverride {
  id: string;
  customer_id: string;
  product_id: string;
  override_price: number | null;
  vial_override_price: number | null;
  is_visible: boolean;
  customers: { id: string; first_name: string | null; last_name: string | null; email: string };
  products: { id: string; name: string; slug: string; price: number };
}

interface Product { id: string; name: string; slug: string; price: number; vial_price: number | null; }

// A product's default single-vial price: explicit vial_price, else price / 10.
const vialDefaultOf = (p: Product) =>
  p.vial_price != null && Number(p.vial_price) > 0 ? Number(p.vial_price) : p.price / 10;

const getCustomerName = (c: { first_name: string | null; last_name: string | null; email: string }) => {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.email;
};

const PAGE_SIZE = 25;

export default function CustomerPricingDetailPage() {
  const params = useParams();
  const customerId = String(params.id);
  const { userRole, canEdit, canCreate } = usePermissions();
  const toast = useToast();
  const isAffiliate = userRole === 'affiliate';
  const mayEdit = canEdit || isAffiliate;
  // The "apply a price list / multiply / convert" form. Admin-only (the
  // apply-transformed API is admin-scoped); collapsed by default so the page
  // stays focused on the per-product grid.
  const [showApply, setShowApply] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [customer, setCustomer] = useState<PriceOverride['customers'] | null>(null);
  // product_id -> override price (as a 2dp string). Absence = no override.
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  // product_id -> per-vial override price (2dp string). Absence = no vial
  // override (vial lines then fall back to the catalog vial price).
  const [originalVial, setOriginalVial] = useState<Record<string, string>>({});
  const [vialEdits, setVialEdits] = useState<Record<string, string>>({});
  // product_id -> visibility. Absence = visible (the default). Only products
  // explicitly hidden for this customer are stored as `false`.
  const [originalVis, setOriginalVis] = useState<Record<string, boolean>>({});
  const [visEdits, setVisEdits] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/price-overrides?customer_id=${customerId}`, {
        headers: await authHeaders(),
      });
      const { overrides: data } = res.ok ? await res.json() : { overrides: [] };
      const list = (data || []) as PriceOverride[];
      if (list[0]?.customers) setCustomer(list[0].customers);

      const orig: Record<string, string> = {};
      const origVial: Record<string, string> = {};
      const origVis: Record<string, boolean> = {};
      for (const o of list) {
        if (o.override_price != null) orig[o.product_id] = Number(o.override_price).toFixed(2);
        if (o.vial_override_price != null) origVial[o.product_id] = Number(o.vial_override_price).toFixed(2);
        if (o.is_visible === false) origVis[o.product_id] = false;
      }
      setOriginal(orig);
      setEdits(orig);
      setOriginalVial(origVial);
      setVialEdits(origVial);
      setOriginalVis(origVis);
      setVisEdits(origVis);

      // Resolve the customer name even when they have no overrides yet.
      const custRes = await fetch('/api/admin/customers', { headers: await authHeaders() });
      if (custRes.ok) {
        const { customers } = await custRes.json();
        const found = (customers || []).find((c: any) => c.id === customerId);
        if (found) {
          setCustomer({ id: found.id, first_name: found.first_name, last_name: found.last_name, email: found.email });
        }
      }

      const { data: productsData } = await supabase
        .from('products')
        .select('id, name, slug, price, vial_price')
        .eq('active', true)
        .order('name');
      setProducts(productsData || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load customer pricing');
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.slug ?? '').toLowerCase().includes(q),
    );
  }, [products, search]);

  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Split the pending changes into upserts (a product with a custom price
  // and/or a hidden status) and deletes (a row cleared back to the default:
  // no custom price AND visible again).
  const { upserts, deletes } = useMemo(() => {
    const up: Array<{ product_id: string; price: number | null; vial: number | null; is_visible: boolean }> = [];
    const del: string[] = [];
    for (const p of products) {
      const val = edits[p.id];
      const num = val !== undefined && val !== '' ? parseFloat(val) : NaN;
      const hasPrice = !isNaN(num) && num >= 0;
      const price = hasPrice ? num : null;

      const vval = vialEdits[p.id];
      const vnum = vval !== undefined && vval !== '' ? parseFloat(vval) : NaN;
      const hasVial = !isNaN(vnum) && vnum >= 0;
      const vial = hasVial ? vnum : null;

      const visible = visEdits[p.id] !== false;

      const origPrice = original[p.id]; // string | undefined
      const origVial = originalVial[p.id]; // string | undefined
      const origVisible = originalVis[p.id] !== false;
      const hadRow = origPrice !== undefined || origVial !== undefined || originalVis[p.id] === false;

      // A row is needed when there's a custom box price, a custom vial price, or
      // the product is hidden.
      const needRow = hasPrice || hasVial || !visible;
      const priceChanged = (hasPrice ? num.toFixed(2) : null) !== (origPrice ?? null);
      const vialChanged = (hasVial ? vnum.toFixed(2) : null) !== (origVial ?? null);
      const visChanged = visible !== origVisible;

      if (needRow) {
        if (priceChanged || vialChanged || visChanged || !hadRow) {
          up.push({ product_id: p.id, price, vial, is_visible: visible });
        }
      } else if (hadRow) {
        del.push(p.id);
      }
    }
    return { upserts: up, deletes: del };
  }, [edits, original, vialEdits, originalVial, visEdits, originalVis, products]);

  const dirtyCount = upserts.length + deletes.length;

  const setCell = (productId: string, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setEdits((prev) => ({ ...prev, [productId]: value }));
  };

  const blurFormat = (productId: string) => {
    setEdits((prev) => {
      const v = prev[productId];
      if (v === undefined || v === '') return prev;
      const num = parseFloat(v);
      if (isNaN(num)) return prev;
      return { ...prev, [productId]: Math.max(0, num).toFixed(2) };
    });
  };

  const setVialCell = (productId: string, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setVialEdits((prev) => ({ ...prev, [productId]: value }));
  };

  const blurFormatVial = (productId: string) => {
    setVialEdits((prev) => {
      const v = prev[productId];
      if (v === undefined || v === '') return prev;
      const num = parseFloat(v);
      if (isNaN(num)) return prev;
      return { ...prev, [productId]: Math.max(0, num).toFixed(2) };
    });
  };

  // Flip a product's visibility for this customer. Hidden products are dropped
  // from the customer's storefront/product listings.
  const toggleVis = (productId: string) => {
    if (!mayEdit) return;
    setVisEdits((prev) => ({ ...prev, [productId]: prev[productId] === false }));
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      inputRefs.current[idx + 1]?.focus();
      inputRefs.current[idx + 1]?.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputRefs.current[idx - 1]?.focus();
      inputRefs.current[idx - 1]?.select();
    }
  };

  const handleSave = async () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    try {
      const headers = await authHeaders({ 'Content-Type': 'application/json' });
      const ops: Promise<Response>[] = [
        ...upserts.map((u) =>
          fetch('/api/admin/price-overrides', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              customer_id: customerId,
              product_id: u.product_id,
              override_price: u.price,
              vial_override_price: u.vial,
              is_visible: u.is_visible,
            }),
          }),
        ),
        ...deletes.map((pid) =>
          fetch(`/api/admin/price-overrides?customer_id=${customerId}&product_id=${pid}`, {
            method: 'DELETE',
            headers,
          }),
        ),
      ];
      const results = await Promise.all(ops);
      const failed = results.filter((r) => !r.ok).length;

      // Fold the successful changes into the baseline.
      setOriginal(() => {
        const next: Record<string, string> = {};
        // Rebuild from edits: any valid non-empty value is the new baseline.
        for (const p of products) {
          const val = edits[p.id];
          if (val !== undefined && val !== '' && !isNaN(parseFloat(val))) {
            next[p.id] = parseFloat(val).toFixed(2);
          }
        }
        return next;
      });
      // Same for the per-vial overrides.
      setOriginalVial(() => {
        const next: Record<string, string> = {};
        for (const p of products) {
          const val = vialEdits[p.id];
          if (val !== undefined && val !== '' && !isNaN(parseFloat(val))) {
            next[p.id] = parseFloat(val).toFixed(2);
          }
        }
        return next;
      });
      // Rebuild the visibility baseline the same way (only hidden products stored).
      setOriginalVis(() => {
        const next: Record<string, boolean> = {};
        for (const p of products) {
          if (visEdits[p.id] === false) next[p.id] = false;
        }
        return next;
      });

      if (failed > 0) {
        toast.error(`Saved ${dirtyCount - failed} of ${dirtyCount} — ${failed} failed`);
      } else {
        toast.success(`Saved ${dirtyCount} price${dirtyCount !== 1 ? 's' : ''}`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save prices');
    }
    setSaving(false);
  };

  const handleReset = () => { setEdits(original); setVialEdits(originalVial); setVisEdits(originalVis); };

  const pctDiff = (price: number, def: number) => (def > 0 ? ((price - def) / def) * 100 : 0);

  const overrideCount = new Set([...Object.keys(original), ...Object.keys(originalVial)]).size;

  return (
    <>
      <Link href="/admin/pricing" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Pricing
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-1">
            {customer ? getCustomerName(customer) : 'Customer'}
          </h1>
          <p className="text-ink-muted text-sm">
            {customer?.email}
            {customer?.email ? ' · ' : ''}
            {overrideCount} custom price{overrideCount !== 1 ? 's' : ''}
          </p>
        </div>
        {mayEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={dirtyCount === 0 || saving}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <button
              onClick={handleSave}
              disabled={dirtyCount === 0 || saving}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount !== 1 ? 's' : ''}` : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Apply a price list / multiply / convert — the reusable pricing form,
          ported onto this page so a list can be applied (and re-priced) without
          leaving the customer's editor. */}
      {canCreate && (
        <div className="mb-5 bg-white rounded-xl border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setShowApply((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-surface/60 transition-colors"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <ListChecks className="w-4 h-4 text-vital" />
              Apply a price list · multiply · convert
            </span>
            <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${showApply ? 'rotate-180' : ''}`} />
          </button>
          {showApply && (
            <div className="px-5 pb-5 pt-1 border-t border-line">
              <CustomerPricingPanel
                customer={{ id: customerId, ...(customer || {}) }}
                variant="card"
                onApplied={() => fetchData()}
              />
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
      </div>

      {mayEdit && (
        <div className="mb-3 text-xs text-ink-muted">
          Edit the <span className="font-semibold text-ink">Custom Box</span> and{' '}
          <span className="font-semibold text-ink">Custom Vial</span> prices like a spreadsheet — in the box column use{' '}
          <span className="font-semibold">↑ / ↓</span> or <span className="font-semibold">Enter</span> to move between rows.
          Box lines charge the box price; single-vial lines charge the vial price. Clear a cell to remove that override and
          fall back to the default. Toggle <span className="font-semibold text-ink">Status</span> to hide a product from this
          customer — hidden products don’t appear in their storefront. A custom box price of{' '}
          <span className="font-semibold">$0</span> also hides the product automatically.
        </div>
      )}

      {/* Grid (desktop table ≥lg / mobile cards) — ADR 0007. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Default Box</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider w-44">Custom Box</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Change</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Default Vial</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider w-44">Custom Vial</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider w-36">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-muted text-sm">No products found</td></tr>
              ) : (
                pageRows.map((p, idx) => {
                  const val = edits[p.id] ?? '';
                  const num = parseFloat(val);
                  const hasVal = val !== '' && !isNaN(num);
                  const effective = hasVal ? num : p.price;
                  const diff = pctDiff(effective, p.price);
                  const orig = original[p.id];
                  const priceDirty = hasVal ? orig !== num.toFixed(2) : orig !== undefined && val === '';
                  // Per-vial override cell.
                  const vval = vialEdits[p.id] ?? '';
                  const vnum = parseFloat(vval);
                  const hasVialVal = vval !== '' && !isNaN(vnum);
                  const vialDefault = vialDefaultOf(p);
                  const origVial = originalVial[p.id];
                  const vialDirty = hasVialVal ? origVial !== vnum.toFixed(2) : origVial !== undefined && vval === '';
                  const visible = visEdits[p.id] !== false;
                  const visDirty = visible !== (originalVis[p.id] !== false);
                  const isDirty = priceDirty || vialDirty || visDirty;
                  // A $0 custom price hides the product from the customer's
                  // storefront, regardless of the manual status toggle.
                  const zeroPriced = hasVal && num === 0;
                  const effectivelyHidden = !visible || zeroPriced;
                  return (
                    <tr key={p.id} className={`transition-colors ${isDirty ? 'bg-vital/5' : effectivelyHidden ? 'bg-red-50/40' : 'hover:bg-surface'}`}>
                      <td className="px-5 py-2.5">
                        <div className="text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink-muted font-mono">{p.slug}</div>
                      </td>
                      <td className="px-5 py-2.5 text-sm text-ink-muted tabular-nums">${p.price.toFixed(2)}</td>
                      <td className="px-5 py-2.5">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            ref={(el) => { inputRefs.current[idx] = el; }}
                            type="text"
                            inputMode="decimal"
                            value={val}
                            disabled={!mayEdit}
                            onChange={(e) => setCell(p.id, e.target.value)}
                            onBlur={() => blurFormat(p.id)}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => onCellKeyDown(e, idx)}
                            placeholder={p.price.toFixed(2)}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-vital/40 focus:z-10 disabled:bg-surface disabled:cursor-not-allowed ${
                              priceDirty ? 'border-vital bg-vital/5' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-2.5">
                        {hasVal ? (
                          <span className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                            diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-red-600' : 'text-ink-muted'
                          }`}>
                            {diff < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : diff > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                            {diff !== 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : '—'}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-muted/60">default</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-sm text-ink-muted tabular-nums">${vialDefault.toFixed(2)}</td>
                      <td className="px-5 py-2.5">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={vval}
                            disabled={!mayEdit}
                            onChange={(e) => setVialCell(p.id, e.target.value)}
                            onBlur={() => blurFormatVial(p.id)}
                            onFocus={(e) => e.target.select()}
                            placeholder={vialDefault.toFixed(2)}
                            title="Single-vial price for this customer. Clear to use the default vial price."
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:z-10 disabled:bg-surface disabled:cursor-not-allowed ${
                              vialDirty ? 'border-indigo-400 bg-indigo-50/50' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-2.5">
                        {zeroPriced ? (
                          <span
                            title="Priced at $0 — hidden from this customer's storefront"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold"
                          >
                            <EyeOff className="w-3.5 h-3.5" /> Hidden ($0)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleVis(p.id)}
                            disabled={!mayEdit}
                            aria-pressed={visible}
                            title={visible ? 'Visible to this customer — click to hide' : 'Hidden from this customer — click to show'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              visible
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            {visible ? 'Visible' : 'Hidden'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg): one card per product with a Box section and a
            Vial section. The box input omits the desktop cell-nav ref/keydown so
            the shared ref array isn't clobbered; 16px inputs avoid iOS zoom. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</div>
          ) : pageRows.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">No products found</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {pageRows.map((p) => {
                const val = edits[p.id] ?? '';
                const num = parseFloat(val);
                const hasVal = val !== '' && !isNaN(num);
                const effective = hasVal ? num : p.price;
                const diff = pctDiff(effective, p.price);
                const orig = original[p.id];
                const priceDirty = hasVal ? orig !== num.toFixed(2) : orig !== undefined && val === '';
                const vval = vialEdits[p.id] ?? '';
                const vnum = parseFloat(vval);
                const hasVialVal = vval !== '' && !isNaN(vnum);
                const vialDefault = vialDefaultOf(p);
                const origVial = originalVial[p.id];
                const vialDirty = hasVialVal ? origVial !== vnum.toFixed(2) : origVial !== undefined && vval === '';
                const visible = visEdits[p.id] !== false;
                const visDirty = visible !== (originalVis[p.id] !== false);
                const isDirty = priceDirty || vialDirty || visDirty;
                const zeroPriced = hasVal && num === 0;
                const effectivelyHidden = !visible || zeroPriced;
                return (
                  <li key={p.id} className={`px-4 py-3.5 ${isDirty ? 'bg-vital/5' : effectivelyHidden ? 'bg-red-50/40' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink-muted font-mono break-all">{p.slug}</div>
                      </div>
                      {zeroPriced ? (
                        <span title="Priced at $0 — hidden from this customer's storefront" className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold">
                          <EyeOff className="w-3.5 h-3.5" /> $0
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleVis(p.id)}
                          disabled={!mayEdit}
                          aria-pressed={visible}
                          title={visible ? 'Visible to this customer — tap to hide' : 'Hidden from this customer — tap to show'}
                          className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            visible ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          {visible ? 'Visible' : 'Hidden'}
                        </button>
                      )}
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light">Box</div>
                        <div className="text-xs text-ink-muted mt-0.5">Default <span className="tabular-nums">${p.price.toFixed(2)}</span></div>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={val}
                            disabled={!mayEdit}
                            onChange={(e) => setCell(p.id, e.target.value)}
                            onBlur={() => blurFormat(p.id)}
                            onFocus={(e) => e.target.select()}
                            placeholder={p.price.toFixed(2)}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-base text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:bg-surface disabled:cursor-not-allowed ${
                              priceDirty ? 'border-vital bg-vital/5' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                        <div className="mt-1 text-right text-xs font-medium tabular-nums">
                          {hasVal ? (
                            <span className={diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-red-600' : 'text-ink-muted'}>
                              {diff !== 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : '—'}
                            </span>
                          ) : (
                            <span className="text-ink-muted/60">default</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light">Vial</div>
                        <div className="text-xs text-ink-muted mt-0.5">Default <span className="tabular-nums">${vialDefault.toFixed(2)}</span></div>
                        <div className="relative mt-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={vval}
                            disabled={!mayEdit}
                            onChange={(e) => setVialCell(p.id, e.target.value)}
                            onBlur={() => blurFormatVial(p.id)}
                            onFocus={(e) => e.target.select()}
                            placeholder={vialDefault.toFixed(2)}
                            title="Single-vial price for this customer. Clear to use the default vial price."
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-base text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-indigo-400/40 disabled:bg-surface disabled:cursor-not-allowed ${
                              vialDirty ? 'border-indigo-400 bg-indigo-50/50' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{safePage * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-ink tabular-nums">{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{filtered.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {safePage + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={safePage + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      {mayEdit && dirtyCount > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-center">
          <div className="inline-flex items-center gap-3 px-4 py-2.5 bg-ink text-white rounded-full shadow-lg">
            <span className="text-sm font-medium">{dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}</span>
            <button onClick={handleReset} className="text-xs text-white/70 hover:text-white">Reset</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-ink rounded-full text-xs font-semibold hover:bg-white/90 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
