'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Minus, Check, ShoppingCart, Beaker, Sparkles } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useCustomer } from '@/contexts/CustomerContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { productUsdPrice, usdFromCad } from '@/lib/pricing';

interface AddonProduct {
  id: string;
  name: string;
  price: number;
  vial_price: number | null;
  price_usd: number | null;
  vials_per_box: number | null;
  strength: string | null;
  image_url: string | null;
  box_image_url: string | null;
  stock_quantity: number;
  has_override?: boolean;
}

interface AddonGroup {
  base: string;
  variants: { product: AddonProduct; sizeLabel: string; ml: number }[];
}

/** Pull a "30mL"-style size out of a product's name/strength for the selector. */
function sizeOf(p: AddonProduct): { label: string; ml: number } {
  const raw = p.strength || p.name.match(/(\d+\s?ml)/i)?.[1] || '';
  const ml = Number(raw.match(/\d+/)?.[0] ?? 0);
  const label = ml > 0 ? `${ml}mL` : (p.strength || 'Standard');
  return { label, ml };
}

/** Strip a trailing size token so sizes of one product collapse to a base name. */
function baseNameOf(p: AddonProduct): string {
  return p.name.replace(/\s*\d+\s?ml\b/i, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * "Complete your order" upsell shown in the cart and checkout. Fetches products
 * flagged `is_checkout_addon` (e.g. bacteriostatic water — needed to reconstitute
 * every peptide order), groups sizes of the same product under one card with a
 * size selector, and adds a single vial (× quantity) at the per-vial price.
 * Renders nothing when there are no add-ons to offer.
 */
export default function CheckoutAddons() {
  const { addItem } = useCart();
  const { customer } = useCustomer();
  const { currency, rate, convert } = useCurrency();
  const [addons, setAddons] = useState<AddonProduct[]>([]);
  // Per-group selected variant id + quantity + a brief "added" flash.
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    const url = new URL('/api/products', window.location.origin);
    url.searchParams.set('addon', '1');
    if (customer?.id) url.searchParams.set('customer_id', customer.id);
    fetch(url.toString())
      .then((res) => (res.ok ? res.json() : { products: [] }))
      .then((data) => {
        if (!active) return;
        const list: AddonProduct[] = (data.products || []).filter(
          (p: AddonProduct) => p.stock_quantity > 0 && p.price > 0,
        );
        setAddons(list);
      })
      .catch(() => {
        /* best-effort — the upsell simply doesn't render on failure */
      });
    return () => {
      active = false;
    };
  }, [customer?.id]);

  // Group sizes of the same product under one base name, sorted small → large.
  const groups = useMemo<AddonGroup[]>(() => {
    const map = new Map<string, AddonGroup>();
    for (const product of addons) {
      const base = baseNameOf(product);
      const key = base.toLowerCase();
      const { label, ml } = sizeOf(product);
      if (!map.has(key)) map.set(key, { base, variants: [] });
      map.get(key)!.variants.push({ product, sizeLabel: label, ml });
    }
    for (const g of map.values()) g.variants.sort((a, b) => a.ml - b.ml);
    return Array.from(map.values());
  }, [addons]);

  if (groups.length === 0) return null;

  // Per-vial price in CAD + USD, mirroring the single-vial logic used elsewhere.
  const perVial = (p: AddonProduct) => {
    const perBox = p.vials_per_box && p.vials_per_box > 0 ? p.vials_per_box : 10;
    const cad = p.vial_price != null && p.vial_price > 0 ? p.vial_price : p.price / perBox;
    const usd =
      p.vial_price != null && p.vial_price > 0
        ? usdFromCad(p.vial_price, rate)
        : productUsdPrice(p, rate, convert) / perBox;
    return { cad, usd };
  };
  const money = (cad: number, usd: number) =>
    `$${(currency === 'USD' ? usd : cad).toFixed(2)}`;

  const handleAdd = (group: AddonGroup) => {
    const variantId = selected[group.base] ?? group.variants[0].product.id;
    const product = group.variants.find((v) => v.product.id === variantId)?.product;
    if (!product) return;
    const count = Math.max(1, qty[group.base] ?? 1);
    const { cad, usd } = perVial(product);
    addItem(
      {
        id: product.id,
        name: product.name,
        price: cad,
        priceUsd: usd,
        strength: product.strength ?? '',
        image_url: product.image_url ?? undefined,
        box_image_url: product.box_image_url ?? undefined,
        packSize: 1,
        priceType: 'vial',
      },
      count,
    );
    setAdded((a) => ({ ...a, [group.base]: true }));
    setTimeout(() => setAdded((a) => ({ ...a, [group.base]: false })), 1500);
  };

  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-surface">
        <Sparkles className="w-4 h-4 text-vital" />
        <h3 className="text-sm font-semibold text-ink">Complete your order</h3>
      </div>

      <div className="divide-y divide-line">
        {groups.map((group) => {
          const variantId = selected[group.base] ?? group.variants[0].product.id;
          const active = group.variants.find((v) => v.product.id === variantId) ?? group.variants[0];
          const product = active.product;
          const count = Math.max(1, qty[group.base] ?? 1);
          const { cad, usd } = perVial(product);
          const isAdded = added[group.base];

          return (
            <div key={group.base} className="p-4 flex items-start gap-3 sm:gap-4">
              <div className="bg-surface w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 border border-line">
                {product.image_url ? (
                  <img src={product.image_url} alt={group.base} className="w-full h-full object-contain rounded-xl p-1" />
                ) : (
                  <Beaker className="w-6 h-6 text-line" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-ink text-sm">{group.base}</h4>
                <p className="text-[11px] text-ink-muted mb-2">
                  Essential for reconstituting lyophilized peptides.
                </p>

                {/* Size selector — only when there's more than one size */}
                {group.variants.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {group.variants.map((v) => {
                      const on = v.product.id === variantId;
                      return (
                        <button
                          key={v.product.id}
                          type="button"
                          onClick={() => setSelected((s) => ({ ...s, [group.base]: v.product.id }))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                            on
                              ? 'border-ink bg-ink text-white'
                              : 'border-line bg-surface text-ink hover:border-ink/30'
                          }`}
                        >
                          {v.sizeLabel}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink tabular-nums">
                      {money(cad, usd)}
                      <span className="text-[10px] font-normal text-ink-muted ml-1">/ vial</span>
                    </span>
                    <div className="flex items-center bg-surface border border-line rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setQty((q) => ({ ...q, [group.base]: Math.max(1, count - 1) }))}
                        className="px-2 py-1.5 hover:bg-white transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3 h-3 text-ink" />
                      </button>
                      <span className="px-2.5 py-1 text-xs font-semibold tabular-nums bg-white border-x border-line min-w-[2rem] text-center">
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty((q) => ({ ...q, [group.base]: count + 1 }))}
                        className="px-2 py-1.5 hover:bg-white transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3 h-3 text-ink" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => handleAdd(group)}
                    className={`flex-shrink-0 font-semibold py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs ${
                      isAdded ? 'bg-emerald-500 text-white' : 'bg-ink hover:bg-ink/90 text-white'
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Added</span>
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
