'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  PackageSearch, Loader2, Building2, Truck, Sparkles, AlertTriangle, Info,
} from 'lucide-react';
import type { Product, InvoiceCurrency } from '@/lib/supabase';
import SupplierSelect, { type SupplierChoice } from '@/components/admin/SupplierSelect';
import {
  getSupplierOptionsByProductIds,
  type SupplierOptionsResult,
} from '@/lib/admin/prepaid-purchase-orders';

/** The subset of a draft line item this view needs. */
export interface PrepaidDraftLine {
  product_id: string | null;
  description: string;
  qty: number | null;
  price_type: 'box' | 'vial';
  preferred_supplier_id?: string | null;
}

interface Props {
  lines: PrepaidDraftLine[];
  products: Product[];
  currency: InvoiceCurrency;
  disabled?: boolean;
  /** Persist the supplier chosen for the line at `index` (null = use cheapest). */
  onAssign: (index: number, supplierId: string | null) => void;
}

/**
 * Live "which supplier procures each line" view shown inside the prepaid invoice
 * form, below the line items. Auto-selects the cheapest supplier per product,
 * lets the admin override per line, and previews the purchase orders that will
 * be generated (grouped by supplier) once the invoice is saved.
 */
export default function PrepaidLineSuppliers({
  lines,
  products,
  currency,
  disabled = false,
  onAssign,
}: Props) {
  const money = (n: number) => `${currency === 'USD' ? 'US$' : '$'}${Number(n ?? 0).toFixed(2)}`;

  const [options, setOptions] = useState<SupplierOptionsResult>({ suppliers: [], products: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skuById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.sku) m.set(p.id, p.sku);
    return m;
  }, [products]);

  // Product ids across the current draft lines — refetch options when they change.
  const productIds = useMemo(
    () => [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))],
    [lines],
  );
  const idsKey = productIds.slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;
    if (productIds.length === 0) {
      setOptions({ suppliers: [], products: {} });
      return;
    }
    setLoading(true);
    setError(null);
    getSupplierOptionsByProductIds(productIds)
      .then((res) => { if (!cancelled) setOptions(res); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Could not load suppliers'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Build supplier choices for one line (every supplier, priced for this product).
  const choicesForLine = (productId: string | null): SupplierChoice[] => {
    const po = productId ? options.products[productId] : undefined;
    const explicit = new Map((po?.options ?? []).map((o) => [o.supplier_id, o]));
    const defaultPrice = po?.default_price ?? 0;
    const cheapestId = po?.cheapest_supplier_id ?? null;
    return options.suppliers
      .map((s) => {
        const ex = explicit.get(s.id);
        return {
          supplier_id: s.id,
          supplier_name: s.name,
          price: ex ? ex.price : defaultPrice,
          lead_time_days: s.lead_time_days,
          is_cheapest: s.id === cheapestId,
          has_price: !!ex,
        };
      })
      .sort((a, b) => Number(b.has_price) - Number(a.has_price) || a.price - b.price);
  };

  // The supplier that would actually be used for a line: explicit override, else
  // the cheapest for its product.
  const effectiveSupplier = (line: PrepaidDraftLine): string | null => {
    if (line.preferred_supplier_id) return line.preferred_supplier_id;
    const po = line.product_id ? options.products[line.product_id] : undefined;
    return po?.cheapest_supplier_id ?? null;
  };

  const priceFor = (line: PrepaidDraftLine, supplierId: string | null): number => {
    if (!supplierId) return 0;
    return choicesForLine(line.product_id).find((c) => c.supplier_id === supplierId)?.price ?? 0;
  };

  // Rows to render (keep original index for onAssign).
  const rows = lines
    .map((line, index) => ({ line, index }))
    .filter((r) => !!r.line.product_id);

  const unlinkedCount = lines.filter((l) => !l.product_id && l.description.trim()).length;

  // Grouped preview by effective supplier.
  const groups = useMemo(() => {
    const map = new Map<string, { supplier_id: string; supplier_name: string; lead: number | null; lines: PrepaidDraftLine[]; cost: number }>();
    for (const { line } of rows) {
      const sid = effectiveSupplier(line);
      if (!sid) continue;
      const supplier = options.suppliers.find((s) => s.id === sid);
      if (!supplier) continue;
      if (!map.has(sid)) {
        map.set(sid, { supplier_id: sid, supplier_name: supplier.name, lead: supplier.lead_time_days, lines: [], cost: 0 });
      }
      const g = map.get(sid)!;
      g.lines.push(line);
      g.cost += priceFor(line, sid) * Number(line.qty || 0);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.index}:${effectiveSupplier(r.line)}:${r.line.qty}`).join('|'), options]);

  const unassigned = rows.filter((r) => !effectiveSupplier(r.line)).length;

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line bg-gradient-to-r from-bronze/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-bronze/10 flex items-center justify-center">
            <PackageSearch className="w-4 h-4 text-bronze" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">Supplier routing</h3>
            <p className="text-xs text-ink-muted">
              Cheapest supplier auto-selected per line — override any of them below.
            </p>
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
      </div>

      <div className="p-5 space-y-4">
        {rows.length === 0 ? (
          <div className="text-sm text-ink-muted text-center py-3">
            Add product line items above to route them to suppliers.
          </div>
        ) : options.suppliers.length === 0 && !loading ? (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="w-4 h-4" /> No suppliers configured yet — add suppliers under Purchase Orders.
          </div>
        ) : (
          <>
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </div>
            )}

            {/* Assignment list — one card per line. The product description gets
                the full row width (wraps freely); the supplier picker sits on its
                own line below so neither gets squished in the narrow column. */}
            <div className="space-y-2">
              {rows.map(({ line, index }) => {
                const choices = choicesForLine(line.product_id);
                const sid = effectiveSupplier(line);
                const sku = line.product_id ? skuById.get(line.product_id) : undefined;
                const cost = priceFor(line, sid) * Number(line.qty || 0);
                return (
                  <div key={index} className="border border-line rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-ink font-medium break-words">
                          {line.description || 'Untitled line'}
                        </div>
                        {sku && <div className="text-[11px] font-mono text-ink-muted mt-0.5">{sku}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase tracking-wider text-ink-muted">Qty</div>
                        <div className="text-sm font-semibold text-ink tabular-nums">×{line.qty ?? 1}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-end gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Supplier</div>
                        <SupplierSelect
                          value={sid}
                          options={choices}
                          currency={currency}
                          disabled={disabled}
                          onChange={(supplierId) => onAssign(index, supplierId)}
                        />
                      </div>
                      <div className="text-right shrink-0 pb-2">
                        <div className="text-[10px] uppercase tracking-wider text-ink-muted">Line cost</div>
                        <div className="text-sm font-semibold text-ink tabular-nums">
                          {sid ? money(cost) : <span className="text-ink-muted">—</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Grouped PO preview */}
            {groups.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  {groups.length} purchase order{groups.length !== 1 ? 's' : ''} will be prepared
                </h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  {groups.map((g) => {
                    const units = g.lines.reduce((s, li) => s + Number(li.qty || 0), 0);
                    return (
                      <div key={g.supplier_id} className="border border-line rounded-lg p-3.5 bg-surface/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <Building2 className="w-4 h-4 text-bronze" /> {g.supplier_name}
                          </span>
                          {g.lead != null && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                              <Truck className="w-3 h-3" /> ~{g.lead}d
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60 text-xs">
                          <span className="text-ink-muted">
                            {g.lines.length} line{g.lines.length !== 1 ? 's' : ''} · {units} units
                          </span>
                          <span className="tabular-nums font-semibold text-ink">{money(g.cost)} cost</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer hint */}
            <div className="flex items-start gap-2 text-xs text-ink-muted bg-surface rounded-lg px-3 py-2.5">
              {unassigned > 0 ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>{unassigned} line{unassigned !== 1 ? 's' : ''} have no supplier configured — they won't be added to a purchase order.</span>
                </>
              ) : (
                <>
                  <Info className="w-4 h-4 text-bronze flex-shrink-0 mt-0.5" />
                  <span>
                    <Sparkles className="w-3 h-3 inline -mt-0.5 text-emerald-600" /> Cheapest supplier auto-selected.
                    Save the invoice, then generate these purchase orders from the invoice page (downloadable as
                    price-less supplier PDFs).
                  </span>
                </>
              )}
            </div>

            {unlinkedCount > 0 && (
              <p className="text-[11px] text-ink-muted">
                {unlinkedCount} custom line{unlinkedCount !== 1 ? 's are' : ' is'} not linked to a catalog product and
                can't be routed to a supplier automatically.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
