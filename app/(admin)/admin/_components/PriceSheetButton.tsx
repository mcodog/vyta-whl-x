'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileText, ChevronDown, Loader2, Package, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import Checkbox from '@/components/admin/Checkbox';
import PriceSheetEmailModal from './PriceSheetEmailModal';

/**
 * "Price list" control for a customer or sales person. Opens a small menu with
 * an Inventory toggle and two actions:
 *   • Download — fetches the print-ready price sheet (/api/admin/price-sheet)
 *     and opens it in a new tab where it auto-prints (browser "Save as PDF").
 *   • Preview & email — opens a modal that previews the real PDF and sends it
 *     as an attachment to editable recipients.
 * The two price columns (case and single vial) show the entity's own prices;
 * toggling Inventory adds the exact on-hand stock column and flows through to
 * both the download and email.
 */
export default function PriceSheetButton({
  type,
  id,
  defaultEmail = '',
  entityName = '',
  disabled = false,
  className = '',
}: {
  type: 'customer' | 'salesperson';
  id: string;
  /** Pre-fills the "To" field of the email modal (the entity in view). */
  defaultEmail?: string;
  /** Entity name used in the generated email subject/body and file name. */
  entityName?: string;
  disabled?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [withInventory, setWithInventory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleInventory = () => setWithInventory((v) => !v);

  const download = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams({ type, id, inventory: withInventory ? '1' : '0' });
      const res = await fetch(`/api/admin/price-sheet?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        toast.error('Could not generate the price list');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
      setOpen(false);
    } catch {
      toast.error('Could not generate the price list');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
      >
        <FileText className="w-4 h-4" /> Price list
        <ChevronDown className={`w-3.5 h-3.5 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-white shadow-xl p-3">
          <p className="text-xs text-ink-muted mb-3">
            This {type === 'customer' ? 'customer' : 'sales rep'}&apos;s price list
            (SKU, description, case price and vial price).
          </p>

          {/* Inventory toggle. The Checkbox is the real control and the label is
              a sibling button — no nested interactive elements — so a click on
              either the box or the text toggles exactly once. */}
          <div className="flex items-center gap-2.5 mb-3">
            <Checkbox checked={withInventory} onChange={toggleInventory} ariaLabel="Include inventory" />
            <button
              type="button"
              onClick={toggleInventory}
              className="inline-flex items-center gap-1.5 text-sm text-ink select-none"
            >
              <Package className="w-3.5 h-3.5 text-ink-muted" /> Include inventory
            </button>
          </div>

          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {busy ? 'Generating…' : 'Download PDF'}
          </button>

          <button
            type="button"
            onClick={() => { setOpen(false); setEmailOpen(true); }}
            className="inline-flex items-center justify-center gap-2 w-full mt-2 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm font-semibold hover:bg-surface transition-colors"
          >
            <Mail className="w-4 h-4 text-bronze" /> Preview &amp; email
          </button>
        </div>
      )}

      {emailOpen && (
        <PriceSheetEmailModal
          type={type}
          id={id}
          initialInventory={withInventory}
          defaultEmail={defaultEmail}
          entityName={entityName}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  );
}
