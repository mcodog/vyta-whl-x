'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, FileText, FileSpreadsheet, Loader2, Settings2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import type { PricelistExportFormat } from '@/lib/admin/pricelist-columns';
import PriceListExportModal from './PriceListExportModal';
import { exportQuery, loadPrefs, type PricelistExportPrefs } from './pricelistExportPrefs';

type Format = PricelistExportFormat;

/** Width of the format menu, in px — also used to place it. */
const MENU_WIDTH = 240;

/**
 * "Download" control for one price list. Opens a small menu with the two
 * formats and streams the file from /api/admin/pricelists/[id]/export:
 *   • PDF   — the branded, shareable price list.
 *   • Excel — the working sheet (catalog price + change), re-importable.
 *   • Customize — pick the columns and document details first.
 * Both quick actions use the choices last saved in the Customize menu, so a
 * customized download stays customized. `pricelistId` may be "default" for the
 * pinned catalog-prices record.
 */
export default function PriceListDownloadButton({
  pricelistId,
  name,
  variant = 'button',
  className = '',
}: {
  pricelistId: string;
  /** Used for the toast copy only; the file name comes from the server. */
  name: string;
  /** 'icon' is the compact table-row control; 'button' the full-width one. */
  variant?: 'button' | 'icon';
  className?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  // Menu placement, computed from the trigger. The menu is position:fixed
  // because the Price Lists table sits in an overflow-hidden card that would
  // otherwise clip an absolutely-positioned dropdown.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-aligned to the trigger, kept inside the viewport.
      const left = Math.max(
        8,
        Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      );
      setPos({ top: rect.bottom + 8, left });
    }
    setOpen(true);
  };

  // Close the menu on an outside click, Escape, or once the page moves under it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Read the server's file name so the download matches the emailed/printed one.
  const fileNameFrom = (disposition: string | null, format: Format): string => {
    const match = disposition?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? `price-list.${format}`;
  };

  const download = async (format: Format, prefs: PricelistExportPrefs = loadPrefs()) => {
    setBusy(format);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(
        `/api/admin/pricelists/${encodeURIComponent(pricelistId)}/export?${exportQuery(prefs, format)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      if (!res.ok) throw new Error('Could not generate the file');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFrom(res.headers.get('Content-Disposition'), format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the browser has picked the blob up — revoking in the same
      // tick can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(`Downloaded "${name}" as ${format === 'pdf' ? 'PDF' : 'Excel'}`);
      setOpen(false);
      setCustomizing(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate the file');
    } finally {
      setBusy(null);
    }
  };

  const busyAny = busy !== null;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={busyAny}
        aria-expanded={open}
        title={`Download "${name}"`}
        aria-label={`Download "${name}"`}
        className={
          variant === 'icon'
            ? 'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink hover:bg-line/20 transition-colors disabled:opacity-50'
            : 'inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-line bg-white text-ink text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50'
        }
      >
        {busyAny ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {variant === 'button' && (
          <>
            Download
            <ChevronDown
              className={`w-3.5 h-3.5 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </button>

      {open && pos && (
        <div
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="fixed z-50 rounded-xl border border-line bg-white shadow-xl p-2"
        >
          <p className="px-2 pt-1 pb-2 text-xs text-ink-muted">Download this price list</p>
          <button
            type="button"
            onClick={() => download('pdf')}
            disabled={busyAny}
            className="w-full inline-flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-ink hover:bg-surface transition-colors disabled:opacity-50 text-left"
          >
            {busy === 'pdf' ? (
              <Loader2 className="w-4 h-4 animate-spin text-bronze" />
            ) : (
              <FileText className="w-4 h-4 text-bronze" />
            )}
            <span>
              PDF
              <span className="block text-xs text-ink-muted">Branded, ready to share</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => download('xlsx')}
            disabled={busyAny}
            className="w-full inline-flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-ink hover:bg-surface transition-colors disabled:opacity-50 text-left"
          >
            {busy === 'xlsx' ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            )}
            <span>
              Excel
              <span className="block text-xs text-ink-muted">With catalog price and change</span>
            </span>
          </button>

          <div className="mt-1 pt-1 border-t border-line">
            <button
              type="button"
              onClick={() => { setOpen(false); setCustomizing(true); }}
              className="w-full inline-flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-ink hover:bg-surface transition-colors text-left"
            >
              <Settings2 className="w-4 h-4 text-ink-muted" />
              <span>
                Customize…
                <span className="block text-xs text-ink-muted">Columns, name, details</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {customizing && (
        <PriceListExportModal
          name={name}
          busy={busy}
          onDownload={(format, prefs) => download(format, prefs)}
          onClose={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}
