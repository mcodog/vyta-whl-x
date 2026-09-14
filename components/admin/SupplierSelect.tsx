'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Sparkles, Truck, Building2 } from 'lucide-react';

export interface SupplierChoice {
  supplier_id: string;
  supplier_name: string;
  price: number;
  lead_time_days: number | null;
  /** Cheapest supplier that explicitly prices this product. */
  is_cheapest: boolean;
  /** Whether the supplier has an explicit price (vs. falling back to catalog). */
  has_price: boolean;
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

/**
 * A custom (non-native) supplier picker used per line item on a prepaid invoice.
 * Shows the chosen supplier + its unit cost, a "Cheapest" badge, lead time, and
 * flags when the pick isn't the cheapest option. Matches the admin design system
 * (ink/vital/line/surface tokens) and closes on outside-click / Escape.
 *
 * The options menu renders in a portal with fixed positioning so it is never
 * clipped by the `overflow-hidden` cards/tables it sits inside.
 */
export default function SupplierSelect({
  value,
  options,
  onChange,
  currency = 'CAD',
  disabled = false,
  placeholder = 'Select supplier…',
}: {
  value: string | null;
  options: SupplierChoice[];
  onChange: (supplierId: string) => void;
  currency?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_MAX_H = 288; // matches max-h below (18rem)

  const computePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 248);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < Math.min(MENU_MAX_H, 220) && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: openUp ? r.top : r.bottom, left, width, openUp });
  };

  // Compute the anchor position when the menu opens. The menu stays unrendered
  // until `pos` is set, so it never flashes in the wrong spot.
  useEffect(() => {
    if (open) computePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Any scroll of an ancestor (capture phase) or resize re-anchors the menu.
    const reposition = () => computePos();
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const selected = options.find((o) => o.supplier_id === value) ?? null;
  const cheapest = options.find((o) => o.is_cheapest) ?? null;
  const money = (n: number) => `${currency === 'USD' ? 'US$' : '$'}${Number(n ?? 0).toFixed(2)}`;
  const notCheapest = !!selected && !!cheapest && selected.supplier_id !== cheapest.supplier_id;

  const menu = open && pos ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
      }}
      className={`z-[60] ${pos.openUp ? 'mb-1' : 'mt-1'} bg-white border border-line rounded-lg shadow-xl overflow-hidden`}
    >
      {options.length === 0 ? (
        <div className="px-3 py-3 text-xs text-ink-muted">No suppliers configured.</div>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {options.map((o) => {
            const active = o.supplier_id === value;
            return (
              <li key={o.supplier_id}>
                <button
                  type="button"
                  onClick={() => { onChange(o.supplier_id); setOpen(false); }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-surface transition-colors ${
                    active ? 'bg-vital/5' : ''
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-4 flex-shrink-0 ${active ? 'text-vital' : 'text-transparent'}`}>
                      <Check className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-ink font-medium truncate">{o.supplier_name}</span>
                        {o.is_cheapest && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
                            <Sparkles className="w-2.5 h-2.5" /> Cheapest
                          </span>
                        )}
                        {!o.has_price && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-ink-muted">
                            catalog price
                          </span>
                        )}
                      </span>
                      {o.lead_time_days != null && (
                        <span className="flex items-center gap-1 text-[11px] text-ink-muted mt-0.5">
                          <Truck className="w-3 h-3" /> ~{o.lead_time_days}d lead time
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-ink whitespace-nowrap">
                    {money(o.price)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          selected
            ? 'bg-white border-line hover:border-ink/20'
            : 'bg-amber-50 border-amber-200 hover:border-amber-300'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className={`w-4 h-4 flex-shrink-0 ${selected ? 'text-vital' : 'text-amber-500'}`} />
          <span className="min-w-0">
            {selected ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-ink font-medium truncate min-w-0">{selected.supplier_name}</span>
                {selected.is_cheapest && (
                  <span className="inline-flex flex-shrink-0 items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 whitespace-nowrap">
                    <Sparkles className="w-2.5 h-2.5" /> Cheapest
                  </span>
                )}
              </span>
            ) : (
              <span className="text-amber-700">{placeholder}</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {selected && (
            <span className={`tabular-nums text-xs font-semibold ${notCheapest ? 'text-amber-600' : 'text-ink-muted'}`}>
              {money(selected.price)}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {menu}
    </div>
  );
}
