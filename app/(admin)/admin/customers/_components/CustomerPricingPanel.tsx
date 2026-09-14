'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check, ArrowRight, ListChecks, ShieldQuestion, Layers, ExternalLink,
  Search, ChevronLeft, ChevronRight, Tag, ArrowLeftRight, Users,
  ArrowUp, ArrowDown, FlaskConical, EyeOff, Box,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import {
  MULTIPLIER_ADJUST_PRESETS, adjustToScale, scaleToAdjust,
  DEFAULT_CAD_PER_USD, transformPrice, resultCurrency,
  isTransformed, roundPrice, ROUND_TO_OPTIONS, DEFAULT_ROUND_TO, DEFAULT_ROUND_DIR,
  catalogVialPrice, vialBasisValue,
  type ResultCurrency, type RoundTo, type RoundDir, type VialBasis,
} from '@/lib/pricing-transform';

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface PriceListLite {
  id: string; name: string; description: string | null; is_active: boolean; item_count: number; currency?: 'CAD' | 'USD' | null;
}
// A source item: its box price plus (for a customer source) that customer's own
// per-vial override, used by the `source_vial` basis.
interface ListItem { product_id: string; price: number; vial: number | null; product: { id: string; name: string; slug: string; price: number } | null; }
// A target override row — box price, per-vial price, and visibility. Any field
// may be null/absent (a row can carry a box price, a vial price, a hidden flag,
// or a combination).
interface Override {
  product_id: string;
  override_price: number | null;
  vial_override_price: number | null;
  is_visible: boolean;
}
interface Product { id: string; name: string; slug: string; sku: string | null; price: number; vial_price: number | null; }
interface CustomerLite { id: string; first_name: string | null; last_name: string | null; email: string; price_currency: ResultCurrency; }

type Mode = 'override' | 'keep_existing';
type SourceKind = 'pricelist' | 'customer';

// The vial-basis options offered for each source kind (a price list has no vial
// of its own, so it can't offer "Source's vial").
const VIAL_BASIS_OPTIONS: Record<SourceKind, { value: VialBasis; label: string }[]> = {
  pricelist: [
    { value: 'catalog_vial', label: 'Catalog vial' },
    { value: 'box_div_10', label: 'Box ÷ 10' },
    { value: 'retail', label: 'Retail price' },
  ],
  customer: [
    { value: 'source_vial', label: "Source's vial" },
    { value: 'catalog_vial', label: 'Catalog vial' },
    { value: 'box_div_10', label: 'Box ÷ 10' },
    { value: 'retail', label: 'Retail price' },
  ],
};

const VIAL_BASIS_HELP: Record<VialBasis, string> = {
  catalog_vial: 'Each product’s own single-vial price (vial price, else box ÷ 10).',
  box_div_10: 'A tenth of the source box price — vials track the box discount.',
  retail: 'The catalog retail (box) price.',
  source_vial: 'The source customer’s own per-vial price.',
};

// Signed-adjustment (multiplier) preset buttons. 0% = unchanged; negatives
// deduct, positives mark up. Shared by the box + vial panels.
function AdjustPresets({ scalePct, onSelect }: { scalePct: number; onSelect: (scale: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MULTIPLIER_ADJUST_PRESETS.map((adjust) => {
        const scale = adjustToScale(adjust);
        const active = scalePct === scale;
        const label = adjust === 0 ? '0%' : `${adjust > 0 ? '+' : ''}${adjust}%`;
        return (
          <button
            key={adjust}
            type="button"
            onClick={() => onSelect(scale)}
            aria-pressed={active}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
              active
                ? 'bg-ink text-white border-ink'
                : adjust < 0
                  ? 'bg-white text-red-600 border-line hover:border-red-300'
                  : 'bg-white text-ink-muted border-line hover:border-ink/30'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Rounding control: $ target presets + a direction toggle (shown when on) + a
// worked example. Shared by the box + vial panels (each keeps its own state).
function RoundControl({
  roundTo, roundDir, onRoundTo, onRoundDir, example,
}: {
  roundTo: RoundTo; roundDir: RoundDir;
  onRoundTo: (v: RoundTo) => void; onRoundDir: (v: RoundDir) => void;
  example: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-ink-muted">Round</span>
        {roundTo !== 0 && (
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {([
              { value: 'down', label: 'Lower', icon: ArrowDown },
              { value: 'up', label: 'Higher', icon: ArrowUp },
            ] as const).map(({ value, label, icon: Icon }) => {
              const active = roundDir === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onRoundDir(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
                    active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon className="w-3 h-3" /> {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ROUND_TO_OPTIONS.map((value) => {
          const active = roundTo === value;
          const label = value === 0 ? 'Off' : value === 9 ? '$9 ends' : `$${value}`;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onRoundTo(value)}
              aria-pressed={active}
              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                active ? 'bg-ink text-white border-ink' : 'bg-white text-ink-muted border-line hover:border-ink/30'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {roundTo !== 0 && (
        <p className="mt-1.5 text-[10px] text-ink-muted">
          e.g. ${example.toFixed(2)} → <span className="font-semibold text-ink tabular-nums">${roundPrice(example, roundTo, roundDir).toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}

const PROD_PAGE_SIZE = 6;

// Resolve a price list's currency (stored column wins, else infer from a "USD …"
// name) — mirrors lib/admin/pricelists.ts so the preview matches the server.
const listCurrencyOf = (pl: PriceListLite | undefined): ResultCurrency => {
  if (!pl) return 'CAD';
  if (pl.currency === 'USD') return 'USD';
  if (pl.currency === 'CAD') return 'CAD';
  if (/\busd\b/i.test(pl.name)) return 'USD';
  return 'CAD';
};

const customerName = (c: { first_name: string | null; last_name: string | null; email: string }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

interface Props {
  customer: any;
  // Called after a successful apply so the parent can refresh its data.
  onApplied?: (message: string) => void;
  // Rendered as a bordered card (standalone modal) vs a plain section (inside edit modal).
  variant?: 'card' | 'section';
}

export default function CustomerPricingPanel({ customer, onApplied, variant = 'card' }: Props) {
  const toast = useToast();
  const [lists, setLists] = useState<PriceListLite[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [appliedList, setAppliedList] = useState<{ id: string; name: string } | null>(
    customer.applied_pricelist ? { id: customer.applied_pricelist.id, name: customer.applied_pricelist.name } : null,
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  // The template price list currently applied to this customer (product_id →
  // box price) + its name, shown as a reference column alongside the catalog
  // default. Empty when the customer has no applied list.
  const [templateBox, setTemplateBox] = useState<Map<string, number>>(new Map());
  const [templateName, setTemplateName] = useState<string | null>(null);

  // Source selection: a saved price list OR another customer's current prices.
  const [sourceKind, setSourceKind] = useState<SourceKind>('pricelist');
  const [selectedId, setSelectedId] = useState('');
  const [sourceCustomerId, setSourceCustomerId] = useState('');
  const [items, setItems] = useState<ListItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [mode, setMode] = useState<Mode>('override');
  const [applying, setApplying] = useState(false);

  // Re-price controls: a percentage multiplier + an optional CAD→USD convert.
  const [multiplierPct, setMultiplierPct] = useState(100);
  const [convertToUsd, setConvertToUsd] = useState(false);
  const [rateInput, setRateInput] = useState(String(DEFAULT_CAD_PER_USD));

  // Rounding: snap each transformed price to a tidy number. Defaults to the
  // nearest $10, rounded up — turn it Off for exact copies.
  const [roundTo, setRoundTo] = useState<RoundTo>(DEFAULT_ROUND_TO);
  const [roundDir, setRoundDir] = useState<RoundDir>(DEFAULT_ROUND_DIR);

  // How the per-vial override is derived from the (box-only) source. Defaults to
  // the catalog vial; a customer source defaults to copying that customer's vial.
  const [vialBasis, setVialBasis] = useState<VialBasis>('catalog_vial');
  // Vials carry their OWN multiplier + rounding, independent of the box price.
  // Rounding defaults to Off (a $5/$10 snap is coarse for a small vial price);
  // the operator can turn it on per-vial.
  const [vialMultiplierPct, setVialMultiplierPct] = useState(100);
  const [vialRoundTo, setVialRoundTo] = useState<RoundTo>(0);
  const [vialRoundDir, setVialRoundDir] = useState<RoundDir>(DEFAULT_ROUND_DIR);

  // "Current prices" table state (paginated + searchable).
  const [prodSearch, setProdSearch] = useState('');
  const [prodPage, setProdPage] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [listRes, custRes, ovRes, prodRes] = await Promise.all([
          fetch('/api/admin/pricelists', { headers: await authHeaders() }),
          fetch('/api/admin/customers', { headers: await authHeaders() }),
          fetch(`/api/admin/price-overrides?customer_id=${customer.id}`, { headers: await authHeaders() }),
          supabase.from('products').select('id, name, slug, sku, price, vial_price').eq('active', true).order('name'),
        ]);
        if (listRes.ok) {
          const { pricelists } = await listRes.json();
          setLists(pricelists || []);
        }
        // The customer's own record (from the admin list) tells us which price
        // list is applied to them, so we can show it as a reference column.
        let appliedListId: string | null = customer.applied_pricelist?.id ?? null;
        if (custRes.ok) {
          const { customers: cs } = await custRes.json();
          const me = (cs || []).find((c: any) => c.id === customer.id);
          if (me?.applied_pricelist_id) appliedListId = me.applied_pricelist_id;
          if (me?.applied_pricelist?.name) setTemplateName(me.applied_pricelist.name);
          setCustomers(
            (cs || [])
              .filter((c: any) => c.id !== customer.id)
              .map((c: any) => ({
                id: c.id,
                first_name: c.first_name,
                last_name: c.last_name,
                email: c.email,
                price_currency: c.price_currency === 'USD' ? 'USD' : 'CAD',
              })),
          );
        }
        if (ovRes.ok) {
          const { overrides: ov } = await ovRes.json();
          // Keep the full rows (box price, vial price, visibility) so all three
          // can be shown; a row may carry any combination.
          setOverrides((ov || []).map((o: any) => ({
            product_id: o.product_id,
            override_price: o.override_price != null ? Number(o.override_price) : null,
            vial_override_price: o.vial_override_price != null ? Number(o.vial_override_price) : null,
            is_visible: o.is_visible !== false,
          })));
        }
        setProducts((prodRes.data as Product[]) || []);

        // Load the applied template list's item prices for the reference column.
        if (appliedListId) {
          try {
            const tRes = await fetch(`/api/admin/pricelists/${appliedListId}`, { headers: await authHeaders() });
            if (tRes.ok) {
              const { pricelist } = await tRes.json();
              const m = new Map<string, number>();
              for (const it of pricelist?.items || []) m.set(it.product_id, Number(it.price));
              setTemplateBox(m);
              if (pricelist?.name) setTemplateName(pricelist.name);
            }
          } catch { /* reference column is best-effort */ }
        } else {
          setTemplateBox(new Map());
          setTemplateName(null);
        }
      } catch {
        toast.error('Failed to load pricing data');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id]);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  // Load the selected source's items for the preview (a price list's items, or
  // the chosen customer's own custom prices).
  useEffect(() => {
    if (sourceKind === 'pricelist' && !selectedId) { setItems([]); return; }
    if (sourceKind === 'customer' && !sourceCustomerId) { setItems([]); return; }
    (async () => {
      setLoadingPreview(true);
      try {
        if (sourceKind === 'pricelist') {
          const res = await fetch(`/api/admin/pricelists/${selectedId}`, { headers: await authHeaders() });
          if (res.ok) {
            const { pricelist } = await res.json();
            setItems((pricelist.items || []).map((i: any) => ({
              product_id: i.product_id,
              price: Number(i.price),
              vial: null, // price lists hold box prices only
              product: i.product,
            })));
          }
        } else {
          const res = await fetch(`/api/admin/price-overrides?customer_id=${sourceCustomerId}`, { headers: await authHeaders() });
          if (res.ok) {
            const { overrides: ov } = await res.json();
            setItems((ov || [])
              .filter((o: any) => o.override_price != null)
              .map((o: any) => {
                const p = productById.get(o.product_id);
                return {
                  product_id: o.product_id,
                  price: Number(o.override_price),
                  vial: o.vial_override_price != null ? Number(o.vial_override_price) : null,
                  product: p ? { id: p.id, name: p.name, slug: p.slug, price: p.price } : (o.products ?? null),
                };
              }));
          }
        }
      } catch {
        toast.error('Failed to load source prices');
      }
      setLoadingPreview(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKind, selectedId, sourceCustomerId, productById]);

  // Box override price per product (only rows that carry a custom box price).
  const overrideByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overrides) if (o.override_price != null) m.set(o.product_id, o.override_price);
    return m;
  }, [overrides]);
  // Per-vial override price per product (only rows that carry a custom vial).
  const overrideVialByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overrides) if (o.vial_override_price != null) m.set(o.product_id, o.vial_override_price);
    return m;
  }, [overrides]);
  // Products this customer has explicitly hidden.
  const hiddenSet = useMemo(() => {
    const s = new Set<string>();
    for (const o of overrides) if (o.is_visible === false) s.add(o.product_id);
    return s;
  }, [overrides]);
  // How many products carry a custom box or vial price.
  const customPriceCount = useMemo(
    () => new Set(overrides.filter((o) => o.override_price != null || o.vial_override_price != null).map((o) => o.product_id)).size,
    [overrides],
  );

  // A product's default single-vial price: explicit vial_price, else box ÷ 10.
  const catalogVialOf = (p: Product) => catalogVialPrice(p.price, p.vial_price);

  const hasSource = sourceKind === 'pricelist' ? !!selectedId : !!sourceCustomerId;

  // The currency the source prices are stored in — drives whether the Convert
  // toggle is offered and how the numbers convert.
  const sourceCurrency: ResultCurrency = useMemo(() => {
    if (sourceKind === 'pricelist') return listCurrencyOf(lists.find((l) => l.id === selectedId));
    return customers.find((c) => c.id === sourceCustomerId)?.price_currency ?? 'CAD';
  }, [sourceKind, selectedId, sourceCustomerId, lists, customers]);

  // Convert only applies to CAD sources; keep the flag from lingering on a USD
  // source (e.g. after switching lists).
  const convertActive = convertToUsd && sourceCurrency === 'CAD';
  const cadPerUsd = Number(rateInput) || DEFAULT_CAD_PER_USD;
  const transformOpts = { multiplierPct, convertToUsd: convertActive, cadPerUsd, roundTo, roundDir };
  // Vials use their own multiplier + rounding, but share the currency convert.
  const vialTransformOpts = { multiplierPct: vialMultiplierPct, convertToUsd: convertActive, cadPerUsd, roundTo: vialRoundTo, roundDir: vialRoundDir };
  const outCurrency = resultCurrency(sourceCurrency, convertActive);
  const transformed = isTransformed(transformOpts, sourceCurrency) || sourceKind === 'customer';
  // The signed adjustment (%) the current scale multiplier represents (0 =
  // unchanged, −25 = 25% off, +50 = +50%), for the button state + messages.
  const multiplierAdjust = scaleToAdjust(multiplierPct);
  const multiplierLabel = multiplierAdjust === 0 ? '0%' : `${multiplierAdjust > 0 ? '+' : ''}${multiplierAdjust}%`;

  // Preview rows sorted by product name — each source box + derived vial price
  // re-priced by the multiplier + optional conversion.
  const preview = useMemo(() => {
    return items
      .map((it) => {
        const p = productById.get(it.product_id);
        const current = overrideByProduct.get(it.product_id);
        const hasCurrent = current !== undefined;
        const next = transformPrice(it.price, sourceCurrency, transformOpts);

        // Vial: current effective (override, else catalog default) vs. the value
        // the chosen basis would write.
        const curVialOverride = overrideVialByProduct.get(it.product_id);
        const currentVial = curVialOverride ?? (p ? catalogVialOf(p) : null);
        const basisVal = vialBasisValue(vialBasis, {
          sourceBox: it.price,
          sourceVial: it.vial ?? null,
          catalogBox: p?.price ?? it.price,
          catalogVial: p?.vial_price ?? null,
        });
        // Vials use their own multiplier + rounding (independent of the box).
        const nextVial = basisVal != null ? transformPrice(basisVal, sourceCurrency, vialTransformOpts) : null;

        const isNew = !hasCurrent;
        const boxChanged = mode === 'override' ? current !== next : isNew;
        const vialChanged = mode === 'override' ? currentVial !== nextVial : isNew;
        const willApply = boxChanged || vialChanged;
        return {
          id: it.product_id,
          name: it.product?.name ?? 'Product',
          defaultPrice: it.product?.price ?? 0,
          current: hasCurrent ? current! : null,
          next,
          currentVial,
          nextVial,
          hasCurrent,
          boxChanged,
          vialChanged,
          willApply,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, productById, overrideByProduct, overrideVialByProduct, vialBasis, mode, sourceCurrency, multiplierPct, convertActive, cadPerUsd, roundTo, roundDir, vialMultiplierPct, vialRoundTo, vialRoundDir]);

  const conflicts = useMemo(() => preview.filter((r) => r.hasCurrent).length, [preview]);
  const willApplyCount = useMemo(() => preview.filter((r) => r.willApply).length, [preview]);

  // Current effective prices per product: catalog default, the template list's
  // price (reference), the applied box override, plus the default + applied vial
  // price. Searchable by product name or SKU/slug, and paginated.
  const currentRows = useMemo(() => {
    const q = prodSearch.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.slug ?? '').toLowerCase().includes(q),
      )
      .map((p) => {
        const ov = overrideByProduct.get(p.id);
        const hasOverride = ov !== undefined;
        const vialOv = overrideVialByProduct.get(p.id);
        const hasVialOverride = vialOv !== undefined;
        const defVial = catalogVialOf(p);
        const tpl = templateBox.get(p.id);
        return {
          id: p.id,
          name: p.name,
          sku: p.sku || p.slug,
          defaultPrice: p.price,
          templatePrice: tpl ?? null,
          appliedPrice: hasOverride ? ov! : p.price,
          hasOverride,
          defaultVial: defVial,
          appliedVial: hasVialOverride ? vialOv! : defVial,
          hasVialOverride,
          hidden: hiddenSet.has(p.id) || (hasOverride && ov === 0),
        };
      });
  }, [products, overrideByProduct, overrideVialByProduct, templateBox, hiddenSet, prodSearch]);

  // Whether any product has a template-list reference price (drives the column).
  const hasTemplateColumn = templateBox.size > 0;

  const prodTotalPages = Math.max(1, Math.ceil(currentRows.length / PROD_PAGE_SIZE));
  const prodSafePage = Math.min(prodPage, prodTotalPages - 1);
  const prodPageRows = currentRows.slice(prodSafePage * PROD_PAGE_SIZE, (prodSafePage + 1) * PROD_PAGE_SIZE);
  useEffect(() => { setProdPage(0); }, [prodSearch]);

  const switchSourceKind = (kind: SourceKind) => {
    setSourceKind(kind);
    setSelectedId('');
    setSourceCustomerId('');
    setItems([]);
    // Copying a customer defaults to their own vial prices; a price list has none
    // of its own, so it defaults to the catalog vial.
    setVialBasis(kind === 'customer' ? 'source_vial' : 'catalog_vial');
  };

  const handleApply = async () => {
    if (!hasSource) return;
    setApplying(true);
    try {
      const res = await fetch('/api/admin/pricing/apply-transformed', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          target_customer_id: customer.id,
          source_type: sourceKind,
          source_id: sourceKind === 'pricelist' ? selectedId : sourceCustomerId,
          multiplier_pct: multiplierPct,
          convert_to_usd: convertActive,
          cad_per_usd: cadPerUsd,
          round_to: roundTo,
          round_dir: roundDir,
          vial_basis: vialBasis,
          vial_multiplier_pct: vialMultiplierPct,
          vial_round_to: vialRoundTo,
          vial_round_dir: vialRoundDir,
          mode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to apply prices');

      const sourceLabel =
        sourceKind === 'pricelist'
          ? (lists.find((l) => l.id === selectedId)?.name ?? 'price list')
          : (customers.find((c) => c.id === sourceCustomerId) ? customerName(customers.find((c) => c.id === sourceCustomerId)!) : 'customer');
      // Only a faithful, untransformed price-list copy is tracked as "Applied".
      setAppliedList(
        !transformed && sourceKind === 'pricelist'
          ? { id: selectedId, name: sourceLabel }
          : null,
      );
      const roundNote = roundTo ? ` · round ${roundDir === 'up' ? '↑' : '↓'} ${roundTo === 9 ? '$9-ends' : `$${roundTo}`}` : '';
      const detail = transformed
        ? ` (${multiplierLabel}${convertActive ? ` · →USD @ ${cadPerUsd}` : ''}${roundNote})`
        : '';
      const msg = `Applied "${sourceLabel}"${detail} — ${json.applied} price${json.applied !== 1 ? 's' : ''} set${json.skipped ? `, ${json.skipped} kept` : ''} in ${json.result_currency}`;
      toast.success(msg);
      // Refresh overrides so a second apply reflects the new state (keep the full
      // rows: box price, vial price, and visibility).
      const ovRes = await fetch(`/api/admin/price-overrides?customer_id=${customer.id}`, { headers: await authHeaders() });
      if (ovRes.ok) {
        const { overrides: ov } = await ovRes.json();
        setOverrides((ov || []).map((o: any) => ({
          product_id: o.product_id,
          override_price: o.override_price != null ? Number(o.override_price) : null,
          vial_override_price: o.vial_override_price != null ? Number(o.vial_override_price) : null,
          is_visible: o.is_visible !== false,
        })));
      }
      onApplied?.(msg);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to apply prices');
    }
    setApplying(false);
  };

  const wrapperClass = variant === 'card'
    ? 'bg-white'
    : 'border border-line rounded-xl p-4 bg-surface/40';

  return (
    <div className={wrapperClass}>
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="w-4 h-4 text-bronze" />
        <h3 className="text-sm font-semibold text-ink">Price List</h3>
        {appliedList && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bronze/10 text-bronze">
            Applied: {appliedList.name}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-ink-muted">Loading pricing…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>
              This customer has{' '}
              <span className="font-semibold text-ink tabular-nums">{customPriceCount}</span> custom price{customPriceCount !== 1 ? 's' : ''}.
            </span>
            <Link
              href={`/admin/pricing/customer/${customer.id}`}
              className="inline-flex items-center gap-1 text-bronze hover:text-bronze/80 font-medium"
            >
              Edit individually <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {/* Current prices — default vs. applied, searchable + paginated */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Tag className="w-3.5 h-3.5 text-ink-muted" />
              <span className="text-xs font-medium text-ink">Current prices</span>
              <span className="ml-auto text-[11px] text-ink-muted tabular-nums">{currentRows.length} products</span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
              <input
                type="text"
                placeholder="Search by product or SKU..."
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-surface border border-line rounded-lg text-xs text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>
            <div className="border border-line rounded-lg overflow-hidden">
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
                    {/* Grouped header: box (case) prices vs. single-vial prices. */}
                    <tr className="bg-surface border-b border-line/70">
                      <th rowSpan={2} className="px-3 py-2 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider align-bottom">Product</th>
                      <th colSpan={hasTemplateColumn ? 3 : 2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Box (case)</th>
                      <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-indigo-500 uppercase tracking-wider border-l border-line">Vial</th>
                    </tr>
                    <tr className="bg-surface border-b border-line">
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Default</th>
                      {hasTemplateColumn && (
                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider" title={templateName ? `Price list: ${templateName}` : 'Applied price list'}>Template</th>
                      )}
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Applied</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider border-l border-line">Default</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Applied</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {prodPageRows.length === 0 ? (
                      <tr><td colSpan={hasTemplateColumn ? 6 : 5} className="px-3 py-6 text-center text-xs text-ink-muted">No products found</td></tr>
                    ) : (
                      prodPageRows.map((r) => (
                        <tr key={r.id} className={r.hasOverride || r.hasVialOverride ? 'bg-bronze/5' : ''}>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-ink truncate max-w-[150px]">{r.name}</span>
                              {r.hidden && (
                                <span title="Hidden from this customer" className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600">
                                  <EyeOff className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            {r.sku && <div className="text-[10px] text-ink-muted font-mono">{r.sku}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-ink-muted text-right tabular-nums">${r.defaultPrice.toFixed(2)}</td>
                          {hasTemplateColumn && (
                            <td className="px-3 py-1.5 text-xs text-ink-muted text-right tabular-nums">
                              {r.templatePrice != null ? `$${r.templatePrice.toFixed(2)}` : <span className="text-ink-muted/50">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <span className={`text-xs font-semibold ${r.hasOverride ? 'text-bronze' : 'text-ink-muted'}`}>
                              ${r.appliedPrice.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-ink-muted text-right tabular-nums border-l border-line/60">${r.defaultVial.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <span className={`text-xs font-semibold ${r.hasVialOverride ? 'text-indigo-600' : 'text-ink-muted'}`}>
                              ${r.appliedVial.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards (below lg) — Box + Vial price sections. ADR 0007. */}
              <ul className="lg:hidden divide-y divide-line/50">
                {prodPageRows.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-ink-muted">No products found</li>
                ) : prodPageRows.map((r) => (
                  <li key={r.id} className={`px-3 py-2.5 ${r.hasOverride || r.hasVialOverride ? 'bg-bronze/5' : ''}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-ink font-medium">{r.name}</span>
                      {r.hidden && (
                        <span title="Hidden from this customer" className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600">
                          <EyeOff className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    {r.sku && <div className="text-[10px] text-ink-muted font-mono">{r.sku}</div>}
                    <div className="mt-1.5 grid grid-cols-2 gap-3 text-[11px]">
                      <div className="space-y-0.5">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">Box (case)</div>
                        <div className="flex justify-between gap-2"><span className="text-ink-muted">Default</span><span className="tabular-nums text-ink-muted">${r.defaultPrice.toFixed(2)}</span></div>
                        {hasTemplateColumn && (
                          <div className="flex justify-between gap-2"><span className="text-ink-muted">Template</span><span className="tabular-nums text-ink-muted">{r.templatePrice != null ? `$${r.templatePrice.toFixed(2)}` : '—'}</span></div>
                        )}
                        <div className="flex justify-between gap-2"><span className="text-ink-muted">Applied</span><span className={`font-semibold tabular-nums ${r.hasOverride ? 'text-bronze' : 'text-ink'}`}>${r.appliedPrice.toFixed(2)}</span></div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-indigo-500">Vial</div>
                        <div className="flex justify-between gap-2"><span className="text-ink-muted">Default</span><span className="tabular-nums text-ink-muted">${r.defaultVial.toFixed(2)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-ink-muted">Applied</span><span className={`font-semibold tabular-nums ${r.hasVialOverride ? 'text-indigo-600' : 'text-ink'}`}>${r.appliedVial.toFixed(2)}</span></div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {currentRows.length > PROD_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-line bg-surface/50">
                  <span className="text-[10px] text-ink-muted tabular-nums">
                    {prodSafePage * PROD_PAGE_SIZE + 1}–{Math.min(currentRows.length, (prodSafePage + 1) * PROD_PAGE_SIZE)} of {currentRows.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setProdPage((p) => Math.max(0, p - 1))}
                      disabled={prodSafePage === 0}
                      className="inline-flex items-center justify-center w-6 h-6 rounded border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] text-ink-muted tabular-nums px-1">{prodSafePage + 1}/{prodTotalPages}</span>
                    <button
                      type="button"
                      onClick={() => setProdPage((p) => (p + 1 < prodTotalPages ? p + 1 : p))}
                      disabled={prodSafePage + 1 >= prodTotalPages}
                      className="inline-flex items-center justify-center w-6 h-6 rounded border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Source: a saved price list, or another customer's current prices. */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1.5">Build &amp; apply prices from</label>
            <div className="inline-flex rounded-lg border border-line bg-surface p-1 mb-2">
              {([
                { value: 'pricelist', label: 'Price list', icon: ListChecks },
                { value: 'customer', label: 'A customer', icon: Users },
              ] as const).map(({ value, label, icon: Icon }) => {
                const active = sourceKind === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => switchSourceKind(value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                );
              })}
            </div>

            {sourceKind === 'pricelist' ? (
              <>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                >
                  <option value="">Select a price list…</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}{l.is_active ? ' (active)' : ''} · {l.item_count} products
                    </option>
                  ))}
                </select>
                {lists.length === 0 && (
                  <p className="mt-1 text-xs text-ink-muted">No price lists exist yet — create one under Pricing → Price Lists.</p>
                )}
              </>
            ) : (
              <>
                <select
                  value={sourceCustomerId}
                  onChange={(e) => setSourceCustomerId(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                >
                  <option value="">Select a customer to copy from…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerName(c)} · {c.price_currency}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">Copies that customer&apos;s current custom prices.</p>
              </>
            )}
          </div>

          {hasSource && (
            <>
              {/* Currency convert — shared across box + vial (CAD sources). */}
              {sourceCurrency === 'CAD' ? (
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-ink-muted" />
                      <span className="text-xs font-medium text-ink">Convert CAD → USD</span>
                      <span className="text-[10px] text-ink-muted">· applies to box &amp; vial</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={convertToUsd}
                      onClick={() => setConvertToUsd((v) => !v)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${convertToUsd ? 'bg-ink' : 'bg-line'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${convertToUsd ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  {convertToUsd && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <label className="text-[11px] text-ink-muted whitespace-nowrap">CAD per USD</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rateInput}
                        onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setRateInput(e.target.value); }}
                        className="w-24 px-2.5 py-1.5 bg-surface border border-line rounded-lg text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-bronze/40"
                      />
                      <span className="text-[11px] text-ink-muted">USD = CAD ÷ {cadPerUsd || DEFAULT_CAD_PER_USD}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted inline-flex items-center gap-1.5">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Source is priced in USD — currency conversion isn&apos;t applied.
                </p>
              )}

              {/* Box + vial each get their own multiplier + rounding. */}
              <div className="grid gap-3 md:grid-cols-2">
                {/* Box (case) price */}
                <div className="rounded-lg border border-line bg-white p-3 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Box className="w-3.5 h-3.5 text-ink-muted" />
                    <span className="text-xs font-semibold text-ink">Box (case) price</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-ink-muted">Adjust</span>
                      <span className="text-[10px] text-ink-muted">0% = unchanged</span>
                    </div>
                    <AdjustPresets scalePct={multiplierPct} onSelect={setMultiplierPct} />
                  </div>
                  <RoundControl roundTo={roundTo} roundDir={roundDir} onRoundTo={setRoundTo} onRoundDir={setRoundDir} example={47} />
                </div>

                {/* Vial price */}
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <FlaskConical className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-xs font-semibold text-ink">Vial price</span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-medium text-ink-muted mb-1.5">From</span>
                    <div className="flex flex-wrap gap-1.5">
                      {VIAL_BASIS_OPTIONS[sourceKind].map(({ value, label }) => {
                        const active = vialBasis === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setVialBasis(value)}
                            aria-pressed={active}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                              active ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-ink-muted border-line hover:border-indigo-300'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-ink-muted">{VIAL_BASIS_HELP[vialBasis]}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-ink-muted">Adjust</span>
                      <span className="text-[10px] text-ink-muted">0% = unchanged</span>
                    </div>
                    <AdjustPresets scalePct={vialMultiplierPct} onSelect={setVialMultiplierPct} />
                  </div>
                  <RoundControl roundTo={vialRoundTo} roundDir={vialRoundDir} onRoundTo={setVialRoundTo} onRoundDir={setVialRoundDir} example={12} />
                </div>
              </div>

              {/* Conflict-aware mode selection */}
              {conflicts > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2 mb-2.5">
                    <ShieldQuestion className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      This customer already has <span className="font-semibold">{conflicts}</span> custom price{conflicts !== 1 ? 's' : ''} for products in this source.
                      Choose which wins:
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      { value: 'override', title: 'Source wins', desc: 'Overwrite the customer’s existing prices' },
                      { value: 'keep_existing', title: 'Keep existing', desc: 'Only set products with no custom price' },
                    ] as const).map((opt) => {
                      const active = mode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMode(opt.value)}
                          className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                            active ? 'border-bronze bg-white ring-1 ring-bronze/30' : 'border-line bg-white/60 hover:border-ink/20'
                          }`}
                        >
                          <div className="font-semibold text-ink flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5" /> {opt.title}
                          </div>
                          <div className="text-ink-muted mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Preview */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-ink inline-flex items-center gap-1.5">
                    Preview
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${outCurrency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-surface text-ink-muted border border-line'}`}>
                      {outCurrency}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {loadingPreview ? 'Loading…' : `${willApplyCount} of ${preview.length} will change`}
                  </span>
                </div>
                <div className="border border-line rounded-lg overflow-hidden">
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full min-w-[460px]">
                      <thead className="sticky top-0 z-10">
                        {/* Grouped header: box (case) vs. single-vial prices. */}
                        <tr className="bg-surface border-b border-line/70">
                          <th rowSpan={2} className="px-3 py-2 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider align-bottom">Product</th>
                          <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Box (case)</th>
                          <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-indigo-500 uppercase tracking-wider border-l border-line">Vial</th>
                        </tr>
                        <tr className="bg-surface border-b border-line">
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Current</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">New</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider border-l border-line">Current</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">New</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {loadingPreview ? (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-ink-muted">Loading preview…</td></tr>
                        ) : preview.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-ink-muted">This source has no products.</td></tr>
                        ) : (
                          preview.map((r) => (
                            <tr key={r.id} className={r.willApply ? 'bg-bronze/5' : 'opacity-60'}>
                              <td className="px-3 py-1.5 text-xs text-ink">{r.name}</td>
                              <td className="px-3 py-1.5 text-xs text-ink-muted text-right tabular-nums">
                                {r.current !== null ? `$${r.current.toFixed(2)}` : <span className="text-ink-muted/60">${r.defaultPrice.toFixed(2)}</span>}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                {r.boxChanged ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-bronze">
                                    <ArrowRight className="w-3 h-3" />${r.next.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-ink-muted">kept</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-ink-muted text-right tabular-nums border-l border-line/60">
                                {r.currentVial !== null ? `$${r.currentVial.toFixed(2)}` : <span className="text-ink-muted/60">—</span>}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                {r.nextVial === null ? (
                                  <span className="text-ink-muted/60">—</span>
                                ) : r.vialChanged ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-indigo-600">
                                    <ArrowRight className="w-3 h-3" />${r.nextVial.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-ink-muted">kept</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleApply}
                disabled={applying || willApplyCount === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {applying
                  ? 'Applying…'
                  : willApplyCount === 0
                    ? 'Nothing to apply'
                    : `Apply to customer (${willApplyCount} price${willApplyCount !== 1 ? 's' : ''} in ${outCurrency})`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
