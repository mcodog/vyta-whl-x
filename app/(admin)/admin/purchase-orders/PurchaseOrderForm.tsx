'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Plus, Search, X, Package, Lock, Unlock, Save, AlertCircle, Loader2,
  ArrowLeftRight, TrendingDown, Truck,
} from 'lucide-react';
import { supabase, type Product, type PurchaseOrder, type Supplier } from '@/lib/supabase';
import {
  createPurchaseOrder, updatePurchaseOrder, createSupplier, searchSuppliers,
  type PurchaseOrderPatch,
} from '@/lib/admin/purchase-orders';
import { computeLandedCosts } from '@/lib/admin/po-landed-cost';
import { getSupplierPrices, getCheapestSupplierPrices } from '@/lib/admin/supplier-prices';
import { PO_STATUSES, PO_STATUS_META, isPoLocked } from '@/lib/admin/po-status';
import type {
  PurchaseOrderStatus, PurchaseOrderTaxType, SupplierPriceRow, CheapestSupplierPrice,
} from '@/lib/supabase';
import Tooltip, { InfoHint } from '@/components/Tooltip';
import NumberInput from '@/components/admin/NumberInput';

/** supplier_price (or the product default when unset), keyed by product_id. */
function buildPriceMap(rows: SupplierPriceRow[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.product_id] = r.supplier_price ?? r.original_price;
  return m;
}

interface DraftItem {
  /** Existing PO line id (null for lines added in this session). */
  id: string | null;
  product_id: string | null;
  description: string;
  sku_snapshot: string | null;
  qty: number | null;
  unit_price: number | null;
  /** Whether the unit price is the box (pack of 10) or single-vial price. */
  price_type: 'box' | 'vial';
  /** How much of this line has already been received (0 for new lines). */
  qty_received: number;
}

interface Props {
  mode: 'create' | 'edit';
  initial?: PurchaseOrder;
  /** Prefilled line items (e.g. when fulfilling a backorder). */
  prefillItems?: DraftItem[];
  /** When set, this PO fulfils the given backorder (flushed on create). */
  backorderId?: string | null;
}

export default function PurchaseOrderForm({ mode, initial, prefillItems, backorderId }: Props) {
  const router = useRouter();

  // ---- supplier state -------------------------------------------------------
  const [supplier, setSupplier] = useState<Supplier | null>(initial?.supplier ?? null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const supplierBoxRef = useRef<HTMLDivElement>(null);

  // new-supplier draft
  const [ns, setNs] = useState({
    name: '', contact_person: '', email: '', phone: '', lead_time_days: 7, notes: '',
  });

  // ---- product picker (invoice-style per-line typeahead) --------------------
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  // Which line's inline product-search dropdown is currently open.
  const [activeLineIdx, setActiveLineIdx] = useState<number | null>(null);
  const lineItemsRef = useRef<HTMLDivElement>(null);

  // ---- form state -----------------------------------------------------------
  const [items, setItems] = useState<DraftItem[]>(
    initial?.items?.map((i) => ({
      id: i.id,
      product_id: i.product_id,
      description: i.description,
      sku_snapshot: i.sku_snapshot,
      qty: i.qty,
      unit_price: Number(i.unit_price),
      price_type: i.price_type === 'vial' ? 'vial' : 'box',
      qty_received: Number(i.qty_received ?? 0),
    })) ?? prefillItems ?? [],
  );
  const [status, setStatus] = useState<PurchaseOrderStatus>(initial?.status ?? 'pending');
  const [taxType, setTaxType] = useState<PurchaseOrderTaxType>(initial?.tax_type ?? 'percentage');
  const [taxValue, setTaxValue] = useState<number | null>(
    initial?.tax_value != null ? Number(initial.tax_value) : null,
  );
  const [shippingFee, setShippingFee] = useState<number | null>(
    initial?.shipping_fee != null ? Number(initial.shipping_fee) : null,
  );
  const [discountType, setDiscountType] = useState<PurchaseOrderTaxType>(initial?.discount_type ?? 'fixed');
  const [discountValue, setDiscountValue] = useState<number | null>(
    initial?.discount_value != null ? Number(initial.discount_value) : null,
  );
  const [orderDate, setOrderDate] = useState<string>(initial?.order_date ?? '');
  const [expectedDate, setExpectedDate] = useState<string>(initial?.expected_date ?? '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- supplier pricing -----------------------------------------------------
  // Effective unit price per product for the selected supplier (supplier price,
  // falling back to the product default). Drives line-item auto-pricing.
  const [supplierPrices, setSupplierPrices] = useState<Record<string, number>>({});
  // True while a supplier's price map is being fetched — locks the product
  // picker so a line can't be added before its prices resolve.
  const [pricesLoading, setPricesLoading] = useState(false);
  // Cheapest supplier per product across all suppliers — powers the alert.
  const [cheapest, setCheapest] = useState<Record<string, CheapestSupplierPrice>>({});
  // When on, adding a product another supplier sells cheaper opens a prompt.
  const [detectCheaper, setDetectCheaper] = useState(true);
  // Pending "a cheaper supplier exists" confirmation.
  const [cheaperPrompt, setCheaperPrompt] = useState<
    { product: Product; lineIdx: number; currentPrice: number; cheapest: CheapestSupplierPrice } | null
  >(null);

  const locked = mode === 'edit' && initial ? isPoLocked(initial.status) : false;
  const receivingStarted = (initial?.items ?? []).some((i) => Number(i.qty_received ?? 0) > 0);
  // Admin opt-in to edit line items after receiving has started (guarded by a
  // warning dialog). Never available for a paid/cancelled PO (that lock stays).
  const [overrideLock, setOverrideLock] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  // Line items are frozen once receiving begins so receipts stay consistent —
  // unless the admin has explicitly overridden the lock.
  const itemsLocked = locked || (receivingStarted && !overrideLock);

  // ---- effects --------------------------------------------------------------
  // load products once
  useEffect(() => {
    supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('name')
      .then(({ data }) => setProducts(data ?? []));
  }, []);

  // debounced supplier search
  useEffect(() => {
    if (!supplierQuery.trim()) {
      setSupplierResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await searchSuppliers(supplierQuery);
      setSupplierResults(res);
    }, 220);
    return () => clearTimeout(handle);
  }, [supplierQuery]);

  // close supplier dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!supplierBoxRef.current?.contains(e.target as Node)) setSupplierOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // close the active line's product dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!lineItemsRef.current?.contains(e.target as Node)) setActiveLineIdx(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // load the cheapest-supplier-per-product map once (for the alert)
  useEffect(() => {
    getCheapestSupplierPrices().then(setCheapest).catch(() => {});
  }, []);

  // when editing an existing PO, load the supplier's price map for auto-pricing.
  // Existing line prices are preserved (no re-pricing on initial load).
  useEffect(() => {
    if (initial?.supplier?.id) {
      getSupplierPrices(initial.supplier.id)
        .then((rows) => setSupplierPrices(buildPriceMap(rows)))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derived totals -------------------------------------------------------
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + (i.qty ?? 0) * (i.unit_price ?? 0), 0),
    [items],
  );
  // Discount can be a flat amount or a percentage of the product subtotal.
  const discountAmount = useMemo(
    () =>
      discountType === 'percentage'
        ? subtotal * ((Number(discountValue) || 0) / 100)
        : Number(discountValue) || 0,
    [discountType, discountValue, subtotal],
  );
  // Financial summary order: subtotal -> shipping fee -> discount -> tax.
  // Percentage tax is applied to the running total after shipping and discount.
  const taxableBase = useMemo(
    () => subtotal + (Number(shippingFee) || 0) - discountAmount,
    [subtotal, shippingFee, discountAmount],
  );
  const taxTotal = useMemo(
    () => (taxType === 'percentage' ? taxableBase * ((taxValue ?? 0) / 100) : Number(taxValue || 0)),
    [taxType, taxValue, taxableBase],
  );
  const total = taxableBase + taxTotal;

  // Per-line landed cost: each line's supplier price plus its share of shipping
  // minus its share of the discount (allocated by value). The true cost basis
  // for margin. Recomputed live as qty / shipping / discount change.
  const landedCosts = useMemo(
    () =>
      computeLandedCosts({
        lines: items.map((i) => ({ qty: i.qty ?? 0, unit_price: i.unit_price ?? 0 })),
        shippingFee: Number(shippingFee) || 0,
        discountAmount,
      }),
    [items, shippingFee, discountAmount],
  );

  // ---- product picker view --------------------------------------------------
  // Top matches for the active line's typeahead query (capped for a tidy list).
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products.slice(0, 12);
    const q = productSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.slug ?? '').toLowerCase().includes(q) ||
          (p.strength ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [products, productSearch]);

  // Fetch + cache the selected supplier's price map. Locks the picker while
  // in flight so products can't be added against stale/empty prices.
  const loadSupplierPrices = async (id: string) => {
    setPricesLoading(true);
    try {
      const rows = await getSupplierPrices(id);
      const map = buildPriceMap(rows);
      setSupplierPrices(map);
      return map;
    } finally {
      setPricesLoading(false);
    }
  };

  // Re-price every editable line to the given supplier's prices.
  const repriceItems = (map: Record<string, number>) => {
    setItems((prev) =>
      prev.map((i) =>
        i.product_id && map[i.product_id] != null ? { ...i, unit_price: map[i.product_id] } : i,
      ),
    );
  };

  // Append an empty line the admin can bind a product to via the inline search
  // (or leave as a free-text description).
  const addLine = () => {
    setItems((prev) => [
      ...prev,
      { id: null, product_id: null, description: '', sku_snapshot: null, qty: null, unit_price: null, price_type: 'box', qty_received: 0 },
    ]);
  };

  const patchLine = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeLine = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Box price = supplier price (or product price); vial price = product
  // vial_price, falling back to the box price / 10.
  const boxUnitForProduct = (p: Product): number => supplierPrices[p.id] ?? Number(p.price ?? 0);
  const vialUnitForProduct = (p: Product): number =>
    p.vial_price != null && Number(p.vial_price) > 0
      ? Number(p.vial_price)
      : boxUnitForProduct(p) / 10;

  // Bind a catalog product to a specific line at the supplier's box price and
  // close that line's dropdown.
  const bindProductToLine = (idx: number, p: Product, unitPrice: number) => {
    patchLine(idx, {
      product_id: p.id,
      description: p.strength ? `${p.name} — ${p.strength}` : p.name,
      sku_snapshot: p.sku ?? p.slug ?? null,
      unit_price: unitPrice,
      price_type: 'box',
    });
    setActiveLineIdx(null);
    setProductSearch('');
  };

  // Dropdown entry point: bind the product, but first flag when another supplier
  // sells it cheaper (deferring the bind until the admin resolves the prompt).
  const pickProductForLine = (idx: number, p: Product) => {
    if (itemsLocked || !supplier || pricesLoading) return;
    const unit = supplierPrices[p.id] ?? Number(p.price ?? 0);
    const ch = cheapest[p.id];
    if (detectCheaper && ch && ch.supplier_id !== supplier.id && ch.price < unit) {
      setCheaperPrompt({ product: p, lineIdx: idx, currentPrice: unit, cheapest: ch });
      return;
    }
    bindProductToLine(idx, p, unit);
  };

  // Toggle a line between box and vial pricing, re-pricing from the catalog.
  const setLinePriceType = (idx: number, type: 'box' | 'vial') => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const p = it.product_id ? products.find((pr) => pr.id === it.product_id) : undefined;
        return {
          ...it,
          price_type: type,
          unit_price: p ? (type === 'vial' ? vialUnitForProduct(p) : boxUnitForProduct(p)) : it.unit_price,
        };
      }),
    );
  };

  // Cheaper-supplier dialog actions (operate on the stored line index).
  const keepCurrentSupplier = () => {
    if (!cheaperPrompt) return;
    bindProductToLine(cheaperPrompt.lineIdx, cheaperPrompt.product, cheaperPrompt.currentPrice);
    setCheaperPrompt(null);
  };

  const switchToCheaperSupplier = async () => {
    if (!cheaperPrompt) return;
    const { product, lineIdx, cheapest: ch } = cheaperPrompt;
    setCheaperPrompt(null);
    // Lock immediately so the (async) supplier lookup + price fetch can't race a
    // product click. loadSupplierPrices keeps the lock on through the fetch.
    setPricesLoading(true);
    try {
      const { data: sup } = await supabase.from('suppliers').select('*').eq('id', ch.supplier_id).single();
      if (!sup) { setError('Could not load the cheaper supplier'); return; }
      const map = await loadSupplierPrices(sup.id);
      setSupplier(sup as Supplier);
      if (!itemsLocked) repriceItems(map);
      bindProductToLine(lineIdx, product, map[product.id] ?? ch.price);
    } catch {
      setError('Could not switch supplier');
    } finally {
      setPricesLoading(false);
    }
  };

  // ---- supplier handlers ----------------------------------------------------
  const pickSupplier = async (s: Supplier) => {
    setSupplier(s);
    setSupplierQuery('');
    setSupplierOpen(false);
    setShowCreateSupplier(false);
    try {
      const map = await loadSupplierPrices(s.id);
      if (!itemsLocked) repriceItems(map);
    } catch { /* prices fall back to product defaults */ }
  };

  const startCreateSupplier = (name: string) => {
    setNs((prev) => ({ ...prev, name }));
    setShowCreateSupplier(true);
    setSupplierOpen(false);
    setSupplierQuery('');
  };

  const submitNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ns.name.trim()) return;
    try {
      const s = await createSupplier({
        name: ns.name.trim(),
        contact_person: ns.contact_person || null,
        email: ns.email || null,
        phone: ns.phone || null,
        lead_time_days: ns.lead_time_days,
        notes: ns.notes || null,
      });
      setSupplier(s);
      setShowCreateSupplier(false);
      setNs({ name: '', contact_person: '', email: '', phone: '', lead_time_days: 7, notes: '' });
      // New suppliers are seeded with default product prices server-side.
      loadSupplierPrices(s.id).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? 'Failed to create supplier');
    }
  };

  // ---- submit ---------------------------------------------------------------
  const submit = async () => {
    setError(null);
    if (!supplier) return setError('Pick a supplier');
    // Drop blank rows (no product bound and no free-text description) before validating.
    const filledItems = items.filter((i) => i.product_id || i.description.trim());
    if (filledItems.length === 0) return setError('Add at least one line item');

    // When overriding the receiving lock, keep the received-history invariants
    // (mirrors the server guards, but surfaces the error before we submit).
    if (mode === 'edit' && overrideLock && receivingStarted) {
      const removedReceived = (initial?.items ?? []).some(
        (orig) => Number(orig.qty_received ?? 0) > 0 && !filledItems.some((it) => it.id === orig.id),
      );
      if (removedReceived) {
        return setError(
          "A line with received stock can't be removed. Reduce it in the receiving panel first.",
        );
      }
      const below = filledItems.find((it) => it.qty_received > 0 && (it.qty ?? 0) < it.qty_received);
      if (below) {
        return setError(
          `"${below.description || 'A line'}" can't be below its received quantity (${below.qty_received}).`,
        );
      }
    }

    setSubmitting(true);
    try {
      const mappedItems = filledItems.map((i) => ({
        id: i.id,
        product_id: i.product_id,
        description: i.description,
        sku_snapshot: i.sku_snapshot,
        qty: Math.max(1, i.qty ?? 1),
        unit_price: i.unit_price ?? 0,
        price_type: i.price_type,
      }));
      if (mode === 'create') {
        const created = await createPurchaseOrder({
          supplier_id: supplier.id,
          status,
          tax_type: taxType,
          tax_value: Number(taxValue) || 0,
          shipping_fee: Number(shippingFee) || 0,
          discount_type: discountType,
          discount_value: Number(discountValue) || 0,
          order_date: orderDate || null,
          expected_date: expectedDate || null,
          notes: notes || null,
          items: mappedItems,
          backorder_id: backorderId ?? null,
        });
        router.push(`/admin/purchase-orders/${created.id}`);
      } else if (initial) {
        // Status is derived from receiving; never set it via the edit form.
        const patch: PurchaseOrderPatch = {
          supplier_id: supplier.id,
          tax_type: taxType,
          tax_value: Number(taxValue) || 0,
          shipping_fee: Number(shippingFee) || 0,
          discount_type: discountType,
          discount_value: Number(discountValue) || 0,
          order_date: orderDate || null,
          expected_date: expectedDate || null,
          notes: notes || null,
        };
        if (!itemsLocked) {
          patch.items = mappedItems;
          // Tell the server to reconcile in place (preserving receipts) rather
          // than reject the edit, when receiving had already started.
          if (overrideLock && receivingStarted) patch.override_receiving_lock = true;
        }
        await updatePurchaseOrder(initial.id, patch);
        router.refresh();
        setSubmitting(false);
      }
    } catch (err: any) {
      setError(err.message ?? 'Could not save');
      setSubmitting(false);
    }
  };

  // ---- quick status actions (edit only) -------------------------------------
  const quickStatus = async (next: PurchaseOrderStatus) => {
    if (!initial) return;
    setSubmitting(true);
    setError(null);
    try {
      await updatePurchaseOrder(initial.id, { status: next });
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Could not update status');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- render ---------------------------------------------------------------
  return (
    <div className="grid lg:grid-cols-3 gap-6 items-start">
      {/* LEFT (2 cols) ------------------------------------------------------ */}
      <div className="lg:col-span-2 space-y-6">
        {/* Receiving-lock banner. Kept outside the disabled wrapper below so its
            override / re-lock controls stay clickable while the cards are frozen. */}
        {receivingStarted && !locked && (
          overrideLock ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 flex-1">
                <p className="font-medium">Editing unlocked — receiving lock overridden.</p>
                <p className="mt-0.5 text-amber-700">
                  Received quantities and delivery history are preserved. You can&rsquo;t remove a line
                  that already has receipts or set its quantity below what&rsquo;s been received. Price or
                  product edits won&rsquo;t retroactively adjust stock already added.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverrideLock(false)}
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900 border border-amber-300 hover:bg-amber-100 rounded-lg px-2.5 py-1.5"
              >
                <Lock className="w-3.5 h-3.5" /> Re-lock
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-700 flex-1">
                Receiving has started, so the supplier and line items are locked. Use the receiving
                panel above to record deliveries. Tax, dates, and notes can still be edited.
              </p>
              <button
                type="button"
                onClick={() => setConfirmOverride(true)}
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 border border-blue-300 hover:bg-blue-100 rounded-lg px-2.5 py-1.5"
              >
                <Unlock className="w-3.5 h-3.5" /> Override &amp; edit
              </button>
            </div>
          )
        )}
        <div className={`space-y-6 ${itemsLocked ? 'opacity-60 pointer-events-none' : ''}`}>
        {/* Supplier card */}
        <Card
          title="Supplier"
          icon={Building2}
          action={
            <InfoHint
              side="left"
              content="Pick the supplier first — line items unlock once chosen and each line auto-prices from this supplier's pricelist. Changing the supplier re-prices all lines."
            />
          }
        >
          {supplier ? (
            <div className="flex items-start justify-between gap-3 p-4 bg-surface rounded-lg border border-line">
              <div>
                <div className="font-semibold text-ink flex items-center gap-2">
                  {supplier.name}
                  {pricesLoading && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-bronze">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading prices…
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted mt-1 space-y-0.5">
                  {supplier.contact_person && <div>{supplier.contact_person}</div>}
                  {supplier.email && <div>{supplier.email}</div>}
                  {supplier.phone && <div>{supplier.phone}</div>}
                  {supplier.lead_time_days != null && (
                    <div className="text-bronze">Lead time: {supplier.lead_time_days} days</div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSupplier(null)}
                disabled={pricesLoading}
                className="text-xs text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div ref={supplierBoxRef} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Search suppliers by name or email..."
                  value={supplierQuery}
                  onChange={(e) => { setSupplierQuery(e.target.value); setSupplierOpen(true); }}
                  onFocus={() => setSupplierOpen(true)}
                  className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                {supplierOpen && (supplierResults.length > 0 || supplierQuery.trim()) && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-72 overflow-auto">
                    {supplierResults.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => pickSupplier(s)}
                        className="w-full text-left px-4 py-2.5 hover:bg-surface text-sm border-b border-line/50 last:border-0"
                      >
                        <div className="font-medium text-ink">{s.name}</div>
                        {(s.contact_person || s.email) && (
                          <div className="text-xs text-ink-muted">
                            {[s.contact_person, s.email].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </button>
                    ))}
                    {supplierQuery.trim() && (
                      <button
                        onClick={() => startCreateSupplier(supplierQuery.trim())}
                        className="w-full text-left px-4 py-2.5 hover:bg-bronze/5 text-sm flex items-center gap-2 text-bronze border-t border-line/50"
                      >
                        <Plus className="w-4 h-4 flex-shrink-0" />
                        <span>Create new supplier &ldquo;{supplierQuery.trim()}&rdquo;</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowCreateSupplier((v) => !v)}
                className="mt-3 text-sm text-bronze hover:text-bronze-dark flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {showCreateSupplier ? 'Cancel new supplier' : 'Create new supplier'}
              </button>
              {showCreateSupplier && (
                <form onSubmit={submitNewSupplier} className="mt-3 p-4 bg-surface rounded-lg border border-line space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Name *">
                      <input
                        value={ns.name}
                        onChange={(e) => setNs({ ...ns, name: e.target.value })}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Contact person">
                      <input
                        value={ns.contact_person}
                        onChange={(e) => setNs({ ...ns, contact_person: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        type="email"
                        value={ns.email}
                        onChange={(e) => setNs({ ...ns, email: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        value={ns.phone}
                        onChange={(e) => setNs({ ...ns, phone: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Lead time (days)">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={ns.lead_time_days}
                        onChange={(v) => setNs({ ...ns, lead_time_days: v ?? 0 })}
                        className="input"
                      />
                    </Field>
                  </div>
                  <button type="submit" className="bg-ink hover:bg-ink/90 text-white text-sm px-4 py-2 rounded-lg">
                    Save supplier
                  </button>
                </form>
              )}
            </>
          )}
        </Card>

        {/* Products / line items — invoice-style per-line typeahead */}
        <Card
          title="Products"
          icon={Package}
          action={supplier ? (
            <div className="flex items-center gap-2">
              <Tooltip
                side="left"
                content="When on, adding a product that another supplier sells cheaper opens a prompt to switch the whole PO to that supplier. Turn off to add at the current supplier's price without checking."
              >
                <span className="text-[11px] text-ink-muted flex items-center gap-1 cursor-help">
                  <TrendingDown className="w-3.5 h-3.5" /> Cheaper-supplier alerts
                </span>
              </Tooltip>
              <button
                type="button"
                role="switch"
                aria-checked={detectCheaper}
                aria-label="Toggle cheaper-supplier alerts"
                onClick={() => setDetectCheaper((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${detectCheaper ? 'bg-ink' : 'bg-line'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${detectCheaper ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          ) : undefined}
        >
          {!supplier ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 mx-auto rounded-xl bg-surface border border-line flex items-center justify-center mb-3">
                <Lock className="w-5 h-5 text-ink-muted" />
              </div>
              <p className="text-sm font-medium text-ink">Select a supplier to add products</p>
              <p className="text-xs text-ink-muted mt-1 max-w-xs mx-auto">
                Line items stay locked until a supplier is chosen. Each line then auto-prices from that
                supplier&rsquo;s pricelist.
              </p>
            </div>
          ) : pricesLoading ? (
            <div className="text-center py-10">
              <Loader2 className="w-6 h-6 text-bronze animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-ink">Loading {supplier.name}&rsquo;s prices…</p>
              <p className="text-xs text-ink-muted mt-1">Products unlock once pricing is ready.</p>
            </div>
          ) : (
            <div ref={lineItemsRef} className="space-y-3">
              <p className="text-xs text-ink-muted -mt-1">
                Search a product on each line — prices default from{' '}
                <span className="font-medium text-bronze">{supplier.name}</span>&rsquo;s pricelist (editable per line).
              </p>
              {items.length === 0 && (
                <p className="text-sm text-ink-muted text-center py-4 border border-dashed border-line rounded-lg">
                  No line items yet — add one below and search for a product.
                </p>
              )}
              {items.map((line, idx) => {
                const product = line.product_id ? products.find((p) => p.id === line.product_id) : undefined;
                // Prefer the live catalog slug; fall back to the snapshot captured on add.
                const slug = product?.slug ?? line.sku_snapshot ?? null;
                const price = product ? (supplierPrices[product.id] ?? Number(product.price ?? 0)) : (line.unit_price ?? 0);
                const ch = line.product_id ? cheapest[line.product_id] : undefined;
                const cheaperElsewhere = !!ch && ch.supplier_id !== supplier.id && ch.price < price;
                const lineTotal = (line.qty ?? 0) * (line.unit_price ?? 0);
                // Landed unit cost (supplier price + shipping share − discount share).
                const landedUnit = landedCosts[idx]?.landedUnitCost ?? line.unit_price ?? 0;
                // Sell price in the same unit as the line (box vs vial) for a margin hint.
                const sellUnit = product
                  ? line.price_type === 'vial'
                    ? product.vial_price != null && Number(product.vial_price) > 0
                      ? Number(product.vial_price)
                      : Number(product.price ?? 0) / 10
                    : Number(product.price ?? 0)
                  : null;
                const marginPct =
                  sellUnit && sellUnit > 0 ? ((sellUnit - landedUnit) / sellUnit) * 100 : null;
                // Received lines carry delivery history: floor their qty and block removal.
                const received = line.qty_received;
                const isReceivedLine = received > 0;
                const qtyFloor = Math.max(1, received);
                return (
                  <div key={idx} className="border border-line rounded-lg p-3 bg-surface space-y-2.5">
                    {/* Product search / free-text description */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => {
                          patchLine(idx, { description: e.target.value, product_id: null, sku_snapshot: null });
                          setActiveLineIdx(idx);
                          setProductSearch(e.target.value);
                        }}
                        onFocus={() => { setActiveLineIdx(idx); setProductSearch(line.product_id ? '' : line.description); }}
                        placeholder="Search products or type a description…"
                        className="w-full pl-9 pr-3 py-2 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                      />
                      {activeLineIdx === idx && filteredProducts.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-auto">
                          {filteredProducts.map((p) => {
                            const pPrice = supplierPrices[p.id] ?? Number(p.price ?? 0);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); pickProductForLine(idx, p); }}
                                className="w-full text-left px-3 py-2 hover:bg-surface border-b border-line/50 last:border-0"
                              >
                                <div className="text-sm text-ink">
                                  {p.name}
                                  {p.strength && <span className="ml-1.5 text-xs text-ink-muted">{p.strength}</span>}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {p.slug && <span className="font-mono text-[11px] text-bronze">{p.slug}</span>}
                                  {p.sku && <span className="font-mono text-[11px] text-ink-muted">SKU {p.sku}</span>}
                                </div>
                                <div className="text-[11px] text-ink-muted mt-0.5">
                                  ${pPrice.toFixed(2)} · stock {p.stock_quantity}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Identity — slug prominent, SKU secondary */}
                    {(line.product_id || isReceivedLine) && (
                      <div className="flex items-center flex-wrap gap-2">
                        {line.product_id && (slug ? (
                          <span className="inline-flex items-center font-mono text-xs text-bronze bg-bronze/10 border border-bronze/20 px-2 py-0.5 rounded">
                            {slug}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-muted italic">no slug</span>
                        ))}
                        {line.sku_snapshot && slug !== line.sku_snapshot && (
                          <span className="font-mono text-[11px] text-ink-muted">SKU {line.sku_snapshot}</span>
                        )}
                        {isReceivedLine && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            <Package className="w-3 h-3" /> received {received}
                          </span>
                        )}
                        {cheaperElsewhere && (
                          <Tooltip content={`${ch!.supplier_name} sells this for $${ch!.price.toFixed(2)}`}>
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 cursor-help">
                              <TrendingDown className="w-3 h-3" /> cheaper elsewhere
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )}

                    {/* Controls — box/vial, qty, unit, total, remove */}
                    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Price</label>
                        <div className="inline-flex rounded-md border border-line overflow-hidden text-[11px]">
                          {(['box', 'vial'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              disabled={itemsLocked || !line.product_id}
                              onClick={() => setLinePriceType(idx, t)}
                              className={`px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${
                                line.price_type === t
                                  ? t === 'vial'
                                    ? 'bg-indigo-500 text-white'
                                    : 'bg-ink text-white'
                                  : 'bg-white text-ink-muted hover:text-ink'
                              }`}
                              title={t === 'vial' ? 'Price per single vial' : 'Price per pack of 10 (box)'}
                            >
                              {t === 'vial' ? 'Vial' : 'Box'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="w-20">
                        <label className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Qty</label>
                        <NumberInput
                          min={qtyFloor}
                          placeholder="0"
                          value={line.qty}
                          onChange={(v) => patchLine(idx, { qty: isReceivedLine ? Math.max(qtyFloor, v ?? qtyFloor) : v })}
                          title={isReceivedLine ? `Can't go below ${received} already received` : undefined}
                          className="w-full bg-white border border-line rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-bronze/40"
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Unit $</label>
                        <NumberInput
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          value={line.unit_price}
                          onChange={(v) => patchLine(idx, { unit_price: v })}
                          className="w-full bg-white border border-line rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-bronze/40"
                        />
                      </div>
                      <div className="ml-auto text-right">
                        <label className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Total</label>
                        <div className="text-sm font-semibold text-ink tabular-nums py-1.5 whitespace-nowrap">
                          ${lineTotal.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={isReceivedLine}
                        title={isReceivedLine ? "Can't remove a line that already has receipts" : 'Remove line'}
                        className="mb-1.5 text-ink-muted hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-ink-muted"
                        aria-label="Remove line"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Landed cost — true per-unit cost after this line's share of
                        shipping + discount is folded in. Cost basis for margin. */}
                    <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-ink-muted">
                        <Truck className="w-3 h-3 flex-shrink-0" />
                        Landed{' '}
                        <span className="font-semibold text-ink tabular-nums">${landedUnit.toFixed(2)}</span>
                        <span className="text-ink-muted">/unit</span>
                        <InfoHint
                          side="right"
                          content="True per-unit cost after this line's share of the order's shipping and discount is folded in (allocated by each line's value). This is the cost basis for margin — the supplier Unit $ above is the raw price before allocation."
                        />
                      </span>
                      {marginPct != null && (
                        <Tooltip
                          side="left"
                          content={`Sell $${sellUnit!.toFixed(2)} vs landed $${landedUnit.toFixed(2)} per ${line.price_type === 'vial' ? 'vial' : 'box'}`}
                        >
                          <span
                            className={`tabular-nums font-semibold cursor-help ${
                              marginPct >= 0 ? 'text-emerald-600' : 'text-red-500'
                            }`}
                          >
                            {marginPct >= 0 ? 'margin' : 'loss'} {Math.abs(marginPct).toFixed(1)}%
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addLine}
                className="w-full py-2 border border-dashed border-line rounded-lg text-sm text-ink-muted hover:text-bronze hover:border-bronze flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add another item
              </button>
            </div>
          )}
        </Card>
        </div>
      </div>

      {/* RIGHT (1 col) ------------------------------------------------------ */}
      <div className="space-y-6">
        {/* Financial summary */}
        <Card title="Financial Summary" tight>
          <div className="space-y-3">
            <Field label="Shipping fee ($)">
              <NumberInput
                min={0}
                step="0.01"
                placeholder="0.00"
                value={shippingFee}
                disabled={locked}
                onChange={(v) => setShippingFee(v)}
                className="input"
              />
            </Field>
            <div>
              <label className="text-xs font-medium text-ink-muted uppercase tracking-wider">Discount Type</label>
              <div className="mt-1 inline-flex w-full rounded-lg border border-line bg-white p-1">
                {(['percentage', 'fixed'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={locked}
                    onClick={() => setDiscountType(t)}
                    className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                      discountType === t ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {t === 'percentage' ? 'Percentage' : 'Fixed'}
                  </button>
                ))}
              </div>
            </div>
            <Field label={discountType === 'percentage' ? 'Discount rate (%)' : 'Discount amount ($)'}>
              <NumberInput
                min={0}
                step="0.01"
                placeholder="0"
                value={discountValue}
                disabled={locked}
                onChange={(v) => setDiscountValue(v)}
                className="input"
              />
            </Field>
            <div>
              <label className="text-xs font-medium text-ink-muted uppercase tracking-wider">Tax Type</label>
              <div className="mt-1 inline-flex w-full rounded-lg border border-line bg-white p-1">
                {(['percentage', 'fixed'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={locked}
                    onClick={() => setTaxType(t)}
                    className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                      taxType === t ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {t === 'percentage' ? 'Percentage' : 'Fixed'}
                  </button>
                ))}
              </div>
            </div>
            <Field label={taxType === 'percentage' ? 'Tax rate (%)' : 'Tax amount ($)'}>
              <NumberInput
                min={0}
                step="0.01"
                placeholder="0"
                value={taxValue}
                disabled={locked}
                onChange={(v) => setTaxValue(v)}
                className="input"
              />
            </Field>
            <div className="pt-3 border-t border-line space-y-1.5 text-sm">
              <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
              <Row label="Shipping fee" value={`$${(Number(shippingFee) || 0).toFixed(2)}`} />
              <Row label={discountType === 'percentage' ? `Discount (${discountValue || 0}%)` : 'Discount'} value={`-$${discountAmount.toFixed(2)}`} />
              <Row label={taxType === 'percentage' ? `Tax (${taxValue || 0}%)` : 'Tax'} value={`$${taxTotal.toFixed(2)}`} />
              <Row label="Total" value={`$${total.toFixed(2)}`} bold />
            </div>
          </div>
        </Card>

        {/* Payment status / quick actions */}
        {mode === 'create' ? (
          <Card title="Initial Status" tight>
            <div className="grid grid-cols-2 gap-2">
              {PO_STATUSES.filter((s) => s !== 'partially_fulfilled').map((s) => {
                const meta = PO_STATUS_META[s];
                const active = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                      active ? `${meta.badge} ring-1 ring-current` : 'bg-white border border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            {(status === 'paid' || status === 'cancelled') && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>This PO will be locked immediately. Only the status can change afterwards.</span>
              </div>
            )}
          </Card>
        ) : initial && (
          <Card title="Quick Status Actions" tight>
            <p className="text-xs text-ink-muted mb-3">
              Fulfillment is tracked in the receiving panel above. These actions set the
              terminal payment state.
            </p>
            <div className="space-y-2">
              <QuickStatusBtn
                label="Mark as Paid"
                color="bg-emerald-500 hover:bg-emerald-600"
                disabled={submitting || initial.status === 'paid'}
                onClick={() => quickStatus('paid')}
              />
              <QuickStatusBtn
                label="Cancel Order"
                color="bg-white border border-line text-ink-muted hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                disabled={submitting || initial.status === 'cancelled'}
                onClick={() => quickStatus('cancelled')}
                ghost
              />
            </div>
          </Card>
        )}

        {/* Order date + expected date + notes */}
        <Card title="Details" tight>
          <Field label="Order date">
            <input
              type="date"
              value={orderDate ?? ''}
              disabled={locked}
              onChange={(e) => setOrderDate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Expected delivery date">
            <input
              type="date"
              value={expectedDate ?? ''}
              disabled={locked}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Notes">
            <textarea
              rows={3}
              value={notes ?? ''}
              disabled={locked}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              placeholder="Internal notes (optional)"
            />
          </Field>
        </Card>

        {/* Submit */}
        {!locked && (
          <button
            onClick={submit}
            disabled={submitting || !supplier || items.length === 0 || pricesLoading}
            className="w-full bg-ink hover:bg-ink/90 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : mode === 'create'
                ? <><Plus className="w-4 h-4" /> Create Purchase Order</>
                : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Receiving-lock override confirmation */}
      {confirmOverride && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-line shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <Unlock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-ink">Override the receiving lock?</h3>
                <p className="text-sm text-ink-muted mt-1">
                  This unlocks the supplier and line items on a purchase order that already has
                  received stock.
                </p>
              </div>
            </div>
            <ul className="bg-surface rounded-xl border border-line p-3 text-xs text-ink-muted mb-4 space-y-1.5 list-disc list-inside">
              <li>Received quantities and delivery history are <strong className="text-ink">preserved</strong>.</li>
              <li>You <strong className="text-ink">can&rsquo;t remove</strong> a line that has receipts, or set its quantity below what&rsquo;s already been received.</li>
              <li>Price or product edits <strong className="text-ink">won&rsquo;t</strong> retroactively adjust stock already added to inventory.</li>
            </ul>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => { setOverrideLock(true); setConfirmOverride(false); }}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-ink hover:bg-ink/90 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                <Unlock className="w-4 h-4" /> Unlock editing
              </button>
              <button
                onClick={() => setConfirmOverride(false)}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-line text-ink hover:bg-surface px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cheaper-supplier confirmation */}
      {cheaperPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-line shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <TrendingDown className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-ink">A cheaper supplier is available</h3>
                <p className="text-sm text-ink-muted mt-1">
                  <strong className="text-ink">{cheaperPrompt.cheapest.supplier_name}</strong> sells{' '}
                  <strong className="text-ink">{cheaperPrompt.product.name}</strong> for{' '}
                  <strong className="text-emerald-600">${cheaperPrompt.cheapest.price.toFixed(2)}</strong>
                  {' '}— vs <strong className="text-ink">${cheaperPrompt.currentPrice.toFixed(2)}</strong> from{' '}
                  {supplier?.name ?? 'the current supplier'}.
                </p>
              </div>
            </div>
            <div className="bg-surface rounded-xl border border-line p-3 text-xs text-ink-muted mb-4">
              Switching changes this purchase order&rsquo;s supplier to{' '}
              <strong className="text-ink">{cheaperPrompt.cheapest.supplier_name}</strong> and re-prices every
              line item to their pricelist.
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={switchToCheaperSupplier}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-ink hover:bg-ink/90 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                <ArrowLeftRight className="w-4 h-4" /> Switch to {cheaperPrompt.cheapest.supplier_name}
              </button>
              <button
                onClick={keepCurrentSupplier}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-line text-ink hover:bg-surface px-4 py-2.5 rounded-lg text-sm font-medium"
              >
                Keep {supplier?.name ?? 'current'}
              </button>
            </div>
            <button
              onClick={() => setCheaperPrompt(null)}
              className="w-full text-center text-xs text-ink-muted hover:text-ink mt-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: white;
          border: 1px solid #C9CCD1;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #1A1A1A;
        }
        :global(.input:focus) {
          outline: none;
          box-shadow: 0 0 0 2px rgba(156, 139, 90, 0.4);
        }
        :global(.input:disabled) {
          background: #F7F7F7;
          color: #8A8A8A;
        }
      `}</style>
    </div>
  );
}

// ---- helpers -------------------------------------------------------------
function Card({
  title, children, icon: Icon, tight, action,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tight?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-xl border border-line ${tight ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-bronze" />} {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'pt-2 border-t border-line text-base font-semibold text-ink' : 'text-ink-muted'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function QuickStatusBtn({
  label, color, onClick, disabled, ghost,
}: { label: string; color: string; onClick: () => void; disabled?: boolean; ghost?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        ghost ? color : `${color} text-white`
      }`}
    >
      {label}
    </button>
  );
}
