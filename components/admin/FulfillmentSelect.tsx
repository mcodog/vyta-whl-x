'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ChevronDown, Check, Clock, PackageCheck, Truck, Store, MapPin,
} from 'lucide-react';
import type { FulfillmentStatus } from '@/lib/supabase';

interface StatusMeta {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Trigger chip classes (bg + border) and its text colour. */
  chip: string;
  text: string;
}

const STATUS_META: Record<FulfillmentStatus, StatusMeta> = {
  pending: { label: 'To pack', Icon: Clock, chip: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  packed: { label: 'Packed', Icon: PackageCheck, chip: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
  shipped: { label: 'Shipped', Icon: Truck, chip: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  picked_up: { label: 'Picked up', Icon: Store, chip: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  dropped_off: { label: 'Dropped off', Icon: MapPin, chip: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
};

interface MenuPos {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

/**
 * A custom (non-native) fulfillment-status picker used in the invoices table's
 * Shipping column. Replaces the classic `<select>` with a chip trigger + portal
 * dropdown that matches the admin design system (ink/bronze/line/surface tokens)
 * and closes on outside-click / Escape.
 *
 * The menu renders in a portal with fixed positioning so it is never clipped by
 * the `overflow-hidden` table it sits inside.
 */
export default function FulfillmentSelect({
  value,
  isPickup,
  disabled = false,
  onChange,
  ariaLabel,
}: {
  value: FulfillmentStatus;
  isPickup: boolean;
  disabled?: boolean;
  onChange: (status: FulfillmentStatus) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Options depend on the fulfillment type: pickup orders resolve to "picked up",
  // shipments to "shipped" / "dropped off".
  const options: FulfillmentStatus[] = isPickup
    ? ['pending', 'packed', 'picked_up']
    : ['pending', 'packed', 'shipped', 'dropped_off'];

  const computePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 176);
    const MENU_MAX_H = 240;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < Math.min(MENU_MAX_H, 200) && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: openUp ? r.top : r.bottom, left, width, openUp });
  };

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

  const meta = STATUS_META[value] ?? STATUS_META.pending;

  const menu = open && pos ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
      }}
      className={`z-[60] ${pos.openUp ? 'mb-1' : 'mt-1'}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: pos.openUp ? 4 : -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        className="origin-top bg-white border border-line rounded-xl shadow-xl overflow-hidden"
      >
        <ul className="py-1">
          {options.map((s) => {
            const m = STATUS_META[s];
            const active = s === value;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => { onChange(s); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-left hover:bg-surface transition-colors ${
                    active ? 'bg-bronze/5' : ''
                  }`}
                >
                  <span className={`flex items-center justify-center w-6 h-6 rounded-lg border ${m.chip} ${m.text}`}>
                    <m.Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 font-medium text-ink">{m.label}</span>
                  {active
                    ? <Check className="w-4 h-4 text-bronze flex-shrink-0" />
                    : <span className="w-4 flex-shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg border text-xs font-medium transition-all hover:brightness-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-bronze/40 disabled:opacity-50 disabled:cursor-not-allowed ${meta.chip} ${meta.text}`}
      >
        <meta.Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="whitespace-nowrap">{meta.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </>
  );
}
