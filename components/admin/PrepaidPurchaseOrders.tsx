'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  PackageSearch, Loader2, Plus, Download, ExternalLink, Sparkles, AlertTriangle,
  Building2, FileDown, ChevronDown, ChevronRight, Truck, RefreshCw, CheckCircle2,
} from 'lucide-react';
import { supabase, type InvoiceLineItem, type InvoiceCurrency } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { PO_STATUS_META } from '@/lib/admin/po-status';
import type { PurchaseOrderStatus } from '@/lib/supabase';
import SupplierSelect, { type SupplierChoice } from '@/components/admin/SupplierSelect';
import {
  getInvoiceSupplierOptions,
  getInvoicePurchaseOrders,
  createInvoicePurchaseOrders,
  type SupplierOptionsResult,
  type LinkedPurchaseOrder,
  type CreatePoGroup,
} from '@/lib/admin/prepaid-purchase-orders';

interface Props {
  invoiceId: string;
  currency: InvoiceCurrency;
  lineItems: InvoiceLineItem[];
  canAct: boolean;
}

/** A line item joined with the product SKU (as returned by the detail route). */
type LineWithSku = InvoiceLineItem & { product?: { sku?: string | null } | null };

const skuOf = (li: LineWithSku): string => (li.product?.sku ?? '').toString();

export default function PrepaidPurchaseOrders({
  invoiceId,
  currency,
  lineItems,
  canAct,
}: Props) {
  const toast = useToast();
  const money = (n: number) => `${currency === 'USD' ? 'US$' : '$'}${Number(n ?? 0).toFixed(2)}`;

  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<SupplierOptionsResult>({ suppliers: [], products: {} });
  const [existingPos, setExistingPos] = useState<LinkedPurchaseOrder[]>([]);
  // line id -> chosen supplier id
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [creating, setCreating] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(true);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Product-bearing lines are the only ones we can route to a supplier.
  const procurableLines = useMemo(
    () => (lineItems as LineWithSku[]).filter((li) => !!li.product_id),
    [lineItems],
  );
  const unlinkedLines = useMemo(
    () => (lineItems as LineWithSku[]).filter((li) => !li.product_id),
    [lineItems],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [opts, pos] = await Promise.all([
        getInvoiceSupplierOptions(invoiceId),
        getInvoicePurchaseOrders(invoiceId),
      ]);
      setOptions(opts);
      setExistingPos(pos);
      setBuilderOpen(pos.length === 0);
      // Default each line to the supplier chosen on the invoice (preferred),
      // else the cheapest explicit supplier for its product.
      setAssignments((prev) => {
        const next: Record<string, string | null> = { ...prev };
        for (const li of procurableLines) {
          if (next[li.id] === undefined) {
            const po = li.product_id ? opts.products[li.product_id] : undefined;
            next[li.id] = li.preferred_supplier_id ?? po?.cheapest_supplier_id ?? null;
          }
        }
        return next;
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load supplier options');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, lineItems]);

  // Build the supplier choice list for a single line (every supplier, priced for
  // this product where an explicit row exists, else the catalog fallback).
  const choicesForLine = (li: LineWithSku): SupplierChoice[] => {
    const po = li.product_id ? options.products[li.product_id] : undefined;
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

  const resolvedPrice = (li: LineWithSku, supplierId: string | null): number => {
    if (!supplierId) return 0;
    const c = choicesForLine(li).find((x) => x.supplier_id === supplierId);
    return c?.price ?? 0;
  };

  // Group the assigned lines by supplier → one draft PO per supplier.
  const draftGroups = useMemo(() => {
    const map = new Map<string, { supplier_id: string; supplier_name: string; lines: LineWithSku[] }>();
    for (const li of procurableLines) {
      const sid = assignments[li.id];
      if (!sid) continue;
      const supplier = options.suppliers.find((s) => s.id === sid);
      if (!supplier) continue;
      if (!map.has(sid)) map.set(sid, { supplier_id: sid, supplier_name: supplier.name, lines: [] });
      map.get(sid)!.lines.push(li);
    }
    return [...map.values()];
  }, [assignments, procurableLines, options.suppliers]);

  const unassignedCount = procurableLines.filter((li) => !assignments[li.id]).length;

  const groupCost = (lines: LineWithSku[], supplierId: string) =>
    lines.reduce((s, li) => s + resolvedPrice(li, supplierId) * Number(li.qty || 0), 0);

  // ---- create -------------------------------------------------------------
  const handleCreate = async () => {
    if (draftGroups.length === 0) {
      toast.error('Assign a supplier to at least one line first.');
      return;
    }
    setCreating(true);
    try {
      const groups: CreatePoGroup[] = draftGroups.map((g) => ({
        supplier_id: g.supplier_id,
        items: g.lines.map((li) => ({
          product_id: li.product_id,
          description: li.description,
          sku_snapshot: skuOf(li) || null,
          qty: Number(li.qty || 1),
          unit_price: resolvedPrice(li, g.supplier_id),
          price_type: li.price_type === 'vial' ? 'vial' : 'box',
        })),
      }));
      const res = await createInvoicePurchaseOrders(invoiceId, groups);
      if (res.purchase_orders.length > 0) {
        toast.success(
          `Created ${res.purchase_orders.length} purchase order${res.purchase_orders.length !== 1 ? 's' : ''}` +
            (res.failures.length ? ` · ${res.failures.length} failed` : ''),
        );
      }
      if (res.failures.length && res.purchase_orders.length === 0) {
        toast.error(res.failures[0].error || 'Could not create purchase orders');
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not create purchase orders');
    } finally {
      setCreating(false);
    }
  };

  // ---- price-less PDF download -------------------------------------------
  const downloadPoPdf = async (poId: string, poNumber: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/purchase-orders/${poId}/pdf?prices=hidden`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) throw new Error('Could not open PDF');
      const blob = await res.blob();
      const w = window.open(URL.createObjectURL(blob), '_blank');
      if (!w) toast.error('Pop-up blocked — allow pop-ups to open the PDF.');
    } catch (e: any) {
      toast.error(e?.message ?? `Could not open ${poNumber}`);
    }
  };

  const downloadAll = async () => {
    setDownloadingAll(true);
    for (const po of existingPos) {
      // eslint-disable-next-line no-await-in-loop
      await downloadPoPdf(po.id, po.po_number);
    }
    setDownloadingAll(false);
  };

  // ------------------------------------------------------------------------
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line bg-gradient-to-r from-bronze/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-bronze/10 flex items-center justify-center">
            <PackageSearch className="w-4 h-4 text-bronze" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">Supplier Purchase Orders</h3>
            <p className="text-xs text-ink-muted">
              Route each product to a supplier and generate the POs to fulfil this prepaid order.
            </p>
          </div>
        </div>
        {existingPos.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" /> {existingPos.length} PO{existingPos.length !== 1 ? 's' : ''} created
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading suppliers…
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* ── Created POs ─────────────────────────────────────────────── */}
          {existingPos.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Generated purchase orders</h4>
                <button
                  onClick={downloadAll}
                  disabled={downloadingAll}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-50"
                >
                  {downloadingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                  Download all (no prices)
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {existingPos.map((po) => {
                  const meta = PO_STATUS_META[po.status as PurchaseOrderStatus];
                  const itemCount = po.items?.length ?? 0;
                  const unitCount = (po.items ?? []).reduce((s, it) => s + Number(it.qty || 0), 0);
                  return (
                    <div key={po.id} className="border border-line rounded-lg p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/admin/purchase-orders/${po.id}`}
                            className="font-mono text-sm text-ink hover:text-bronze inline-flex items-center gap-1"
                          >
                            {po.po_number} <ExternalLink className="w-3 h-3" />
                          </Link>
                          <div className="flex items-center gap-1.5 text-xs text-ink-muted mt-0.5">
                            <Building2 className="w-3 h-3" /> {po.supplier?.name ?? 'Supplier'}
                          </div>
                        </div>
                        {meta && (
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${meta.badge}`}>
                            {meta.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line/60">
                        <span className="text-xs text-ink-muted tabular-nums">
                          {itemCount} line{itemCount !== 1 ? 's' : ''} · {unitCount} unit{unitCount !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => downloadPoPdf(po.id, po.po_number)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-ink hover:bg-ink/90 text-white font-medium"
                        >
                          <Download className="w-3.5 h-3.5" /> PDF
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Builder ─────────────────────────────────────────────────── */}
          {existingPos.length > 0 && (
            <button
              onClick={() => setBuilderOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface hover:bg-surface-2 text-sm text-ink-muted hover:text-ink transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Create additional purchase orders
              </span>
              {builderOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}

          {builderOpen && (
            <>
              {procurableLines.length === 0 ? (
                <div className="text-sm text-ink-muted py-4 text-center">
                  No product-linked line items to procure.
                </div>
              ) : (
                <>
                  {/* Assignment list — one card per line. The product description
                      gets the full row width (wraps freely); the supplier picker
                      sits on its own line below so neither gets squished. */}
                  <div className="space-y-2">
                    {procurableLines.map((li) => {
                      const choices = choicesForLine(li);
                      const sid = assignments[li.id] ?? null;
                      const lineCost = resolvedPrice(li, sid) * Number(li.qty || 0);
                      const noSuppliers = choices.length === 0;
                      return (
                        <div key={li.id} className="border border-line rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm text-ink font-medium break-words">{li.description}</div>
                              {skuOf(li) && (
                                <div className="text-[11px] font-mono text-ink-muted mt-0.5">{skuOf(li)}</div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] uppercase tracking-wider text-ink-muted">Qty</div>
                              <div className="text-sm font-semibold text-ink tabular-nums">×{li.qty}</div>
                            </div>
                          </div>
                          <div className="mt-2.5 flex items-end gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Supplier</div>
                              {noSuppliers ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 py-2">
                                  <AlertTriangle className="w-3.5 h-3.5" /> No suppliers configured
                                </span>
                              ) : (
                                <SupplierSelect
                                  value={sid}
                                  options={choices}
                                  currency={currency}
                                  disabled={!canAct}
                                  onChange={(supplierId) =>
                                    setAssignments((prev) => ({ ...prev, [li.id]: supplierId }))
                                  }
                                />
                              )}
                            </div>
                            <div className="text-right shrink-0 pb-2">
                              <div className="text-[10px] uppercase tracking-wider text-ink-muted">Line cost</div>
                              <div className="text-sm font-semibold text-ink tabular-nums">
                                {sid ? money(lineCost) : <span className="text-ink-muted">—</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Draft PO preview grouped by supplier */}
                  {draftGroups.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        {draftGroups.length} purchase order{draftGroups.length !== 1 ? 's' : ''} will be created
                      </h4>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {draftGroups.map((g) => {
                          const supplier = options.suppliers.find((s) => s.id === g.supplier_id);
                          const cost = groupCost(g.lines, g.supplier_id);
                          const units = g.lines.reduce((s, li) => s + Number(li.qty || 0), 0);
                          return (
                            <div key={g.supplier_id} className="border border-line rounded-lg p-3.5 bg-surface/40">
                              <div className="flex items-center justify-between gap-2">
                                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                                  <Building2 className="w-4 h-4 text-bronze" /> {g.supplier_name}
                                </div>
                                {supplier?.lead_time_days != null && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                                    <Truck className="w-3 h-3" /> ~{supplier.lead_time_days}d
                                  </span>
                                )}
                              </div>
                              <ul className="mt-2 space-y-1">
                                {g.lines.map((li) => (
                                  <li key={li.id} className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                                    <span className="truncate">{li.description}</span>
                                    <span className="tabular-nums whitespace-nowrap">×{li.qty}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60 text-xs">
                                <span className="text-ink-muted">{g.lines.length} line{g.lines.length !== 1 ? 's' : ''} · {units} units</span>
                                <span className="tabular-nums font-semibold text-ink">{money(cost)} cost</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Footer actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                    <div className="text-xs text-ink-muted">
                      {unassignedCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-600">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {unassignedCount} line{unassignedCount !== 1 ? 's' : ''} still need a supplier
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600">
                          <Sparkles className="w-3.5 h-3.5" /> Cheapest supplier auto-selected — override any line above
                        </span>
                      )}
                    </div>
                    {canAct && (
                      <button
                        onClick={handleCreate}
                        disabled={creating || draftGroups.length === 0}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Create {draftGroups.length || ''} purchase order{draftGroups.length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                </>
              )}

              {unlinkedLines.length > 0 && (
                <p className="text-[11px] text-ink-muted border-t border-line/60 pt-3">
                  {unlinkedLines.length} line item{unlinkedLines.length !== 1 ? 's are' : ' is'} not linked to a catalog
                  product and can't be auto-routed to a supplier. Add {unlinkedLines.length !== 1 ? 'them' : 'it'} to a
                  purchase order manually if needed.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
