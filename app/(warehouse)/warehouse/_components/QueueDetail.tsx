'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Truck,
  Store,
  Package,
  MapPin,
  Globe,
  Info,
  Phone,
  Mail,
  CheckCircle2,
  Loader2,
  ExternalLink,
  PackageCheck,
  UserCheck,
  Tag,
  CheckSquare,
  Square,
  Camera,
  Upload,
  X,
  PackageX,
  Check,
  Download,
  Eye,
  AlertTriangle,
  Trash2,
  RotateCcw,
  FileText,
  Users,
  Box,
  FlaskConical,
  Tags,
} from 'lucide-react';
import type { FulfillmentStatus } from '@/lib/supabase';
import {
  sourceLabel,
  sourceBadgeClasses,
  STEALTH_HEALTH_MISSING_INFO_TOOLTIP,
} from '@/lib/orderSource';
import {
  type QueueItem,
  type NotificationKind,
  stepsFor,
  statusLabel,
  isComplete,
  currentStepIndex,
  formatWhen,
  timeAgo,
  saveChecklist,
  fulfillLine,
  backorderLine,
  uploadPackedPhoto,
  deletePackedPhoto,
  openInvoicePdf,
  setQueueRemoved,
  markInvoiceReady,
  sendPackingList,
} from '@/lib/warehouse/api';

interface Props {
  item: QueueItem | null;
  canSendEmails: boolean;
  onAdvance: (id: string, next: FulfillmentStatus) => Promise<void>;
  onNotify: (item: QueueItem, kind: NotificationKind) => void;
  onRefresh: () => Promise<void> | void;
}

export default function QueueDetail({ item, canSendEmails, onAdvance, onNotify, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);

  // ----- Per-invoice local UI state (seeded from the selected item) --------
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [lineBusy, setLineBusy] = useState<Record<string, 'fulfill' | 'backorder' | null>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState<'view' | 'download' | null>(null);
  const [readying, setReadying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [packingBusy, setPackingBusy] = useState(false);
  const [packingSentTo, setPackingSentTo] = useState<string | null>(null);
  // "Clear from queue" — reveals a required-note form before removing the order.
  const [clearing, setClearing] = useState(false);
  const [clearNote, setClearNote] = useState('');
  const [clearBusy, setClearBusy] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const itemId = item?.id ?? null;

  // Reset ephemeral state when a different order is selected.
  useEffect(() => {
    setChecked(new Set(item?.handling_checklist ?? []));
    setQtyDraft({});
    setLineBusy({});
    setErrMsg(null);
    setPackingSentTo(null);
    setClearing(false);
    setClearNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (!item) {
    return (
      <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center px-6">
        <PackageCheck className="w-10 h-10 text-line mb-3" />
        <p className="text-sm font-medium text-ink">Select an order</p>
        <p className="text-xs text-ink-muted mt-1">
          Pick an order from the queue to see packing and handling instructions.
        </p>
      </div>
    );
  }

  const isShipment = item.fulfillment_type === 'shipment';
  const steps = stepsFor(item.fulfillment_type);
  const currentIdx = currentStepIndex(item.fulfillment_status);
  const done = isComplete(item.fulfillment_status);

  const nextStatus: FulfillmentStatus | null = done
    ? null
    : item.fulfillment_status === 'pending'
      ? 'packed'
      : isShipment
        ? 'shipped'
        : 'picked_up';
  const nextLabel =
    nextStatus === 'packed'
      ? 'Mark Packed'
      : nextStatus === 'shipped'
        ? 'Mark Shipped'
        : nextStatus === 'picked_up'
          ? 'Mark Picked Up'
          : null;

  const advance = async () => {
    if (!nextStatus) return;
    setBusy(true);
    try {
      await onAdvance(item.id, nextStatus);
    } finally {
      setBusy(false);
    }
  };

  // Open the full invoice (same document as Admin → Invoices) in a new tab.
  // `download` triggers the print / save-as-PDF dialog; otherwise it just
  // opens the invoice for viewing.
  const openInvoice = async (download: boolean) => {
    setErrMsg(null);
    setInvoiceBusy(download ? 'download' : 'view');
    try {
      await openInvoicePdf(item.id, download);
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not open the invoice');
    } finally {
      setInvoiceBusy(null);
    }
  };

  // Take a draft out of "draft" status so it can be fulfilled.
  const markReady = async () => {
    setErrMsg(null);
    setReadying(true);
    try {
      await markInvoiceReady(item.id);
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not mark the invoice ready');
    } finally {
      setReadying(false);
    }
  };

  // Send (or re-send) the Packing List to the customer's client.
  const sendPackList = async () => {
    setErrMsg(null);
    setPackingBusy(true);
    try {
      const res = await sendPackingList(item.id);
      setPackingSentTo(res.to);
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not send the packing list');
    } finally {
      setPackingBusy(false);
    }
  };

  // Clear the order out of the active queue with a required explanation. Moves
  // it to the "Fulfilled / Removed" view, where the note is shown.
  const submitClear = async () => {
    const note = clearNote.trim();
    if (!note) return;
    setErrMsg(null);
    setClearBusy(true);
    try {
      await setQueueRemoved(item.id, true, note);
      setClearing(false);
      setClearNote('');
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not clear the order from the queue');
    } finally {
      setClearBusy(false);
    }
  };

  // Remove from / restore to the active queue.
  const toggleRemoved = async () => {
    setErrMsg(null);
    setRemoving(true);
    try {
      await setQueueRemoved(item.id, !item.removed_from_queue);
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not update the queue');
    } finally {
      setRemoving(false);
    }
  };

  const isDraft = item.status === 'draft';

  // ----- Handling checklist -------------------------------------------------
  const toggleChecklist = async (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
    try {
      await saveChecklist(item.id, [...next]);
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not save the checklist');
      // Revert on failure.
      setChecked(new Set(checked));
    }
  };

  // ----- Per-line fulfill / backorder --------------------------------------
  const remainingOf = (li: QueueItem['line_items'][number]) =>
    Math.max(0, li.qty - li.qty_fulfilled - li.qty_backordered);

  const draftFor = (li: QueueItem['line_items'][number]) => {
    const rem = remainingOf(li);
    const d = qtyDraft[li.id];
    if (d == null) return rem;
    return Math.max(1, Math.min(d, rem || 1));
  };

  const handleFulfill = async (li: QueueItem['line_items'][number]) => {
    const rem = remainingOf(li);
    if (rem <= 0) return;
    const add = draftFor(li);
    setErrMsg(null);
    setLineBusy((p) => ({ ...p, [li.id]: 'fulfill' }));
    try {
      // qty_fulfilled is absolute on the server; add to the current value.
      await fulfillLine(item.id, li.id, li.qty_fulfilled + add);
      await onRefresh();
      setQtyDraft((p) => ({ ...p, [li.id]: undefined as any }));
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not mark fulfilled');
    } finally {
      setLineBusy((p) => ({ ...p, [li.id]: null }));
    }
  };

  const handleBackorder = async (li: QueueItem['line_items'][number]) => {
    const rem = remainingOf(li);
    if (rem <= 0) return;
    const add = draftFor(li);
    setErrMsg(null);
    setLineBusy((p) => ({ ...p, [li.id]: 'backorder' }));
    try {
      await backorderLine(item.id, li.id, add);
      await onRefresh();
      setQtyDraft((p) => ({ ...p, [li.id]: undefined as any }));
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not create backorder');
    } finally {
      setLineBusy((p) => ({ ...p, [li.id]: null }));
    }
  };

  // ----- Packed photos ------------------------------------------------------
  const onPickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrMsg(null);
    setPhotoBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadPackedPhoto(item.id, file);
      }
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Photo upload failed');
    } finally {
      setPhotoBusy(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const onRemovePhoto = async (path: string) => {
    setRemovingPhoto(path);
    try {
      await deletePackedPhoto(item.id, path);
      await onRefresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not remove photo');
    } finally {
      setRemovingPhoto(null);
    }
  };

  const photos = item.packed_photos ?? [];
  const addr = item.shipping_address ?? {};
  // A Stealth Health (PuraMass hosted-checkout) order: fulfilled here, but the
  // customer/shipping details and pricing live on Stealth Health's side, so some
  // normal invoice fields are intentionally blank (explained via tooltips).
  const isStealthHealth = item.source === 'stealth_health';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-5 border-b border-line">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                  isShipment ? 'bg-blue-500/10 text-blue-600' : 'bg-amber-500/10 text-amber-700'
                }`}
              >
                {isShipment ? <Truck className="w-3.5 h-3.5" /> : <Store className="w-3.5 h-3.5" />}
                {isShipment ? 'Shipment' : 'Self-Pickup'}
              </span>
              {item.status === 'draft' && (
                <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700">
                  Draft
                </span>
              )}
              {item.invoice_number ? (
                <span className="font-mono text-sm font-semibold text-ink">{item.invoice_number}</span>
              ) : (
                <span className="font-mono text-sm font-semibold text-ink-muted">No invoice #</span>
              )}
              {isStealthHealth && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${sourceBadgeClasses(item.source)}`}
                  title={STEALTH_HEALTH_MISSING_INFO_TOOLTIP}
                >
                  <Globe className="w-3 h-3" /> {sourceLabel(item.source)}
                </span>
              )}
              {item.order_number && (
                <span className="font-mono text-xs text-ink-muted">{item.order_number}</span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  item.with_labels ? 'bg-vital/10 text-vital' : 'bg-ink/5 text-ink-muted'
                }`}
                title={
                  item.with_labels
                    ? 'Ships with product labels on the vials'
                    : 'Ships without product labels'
                }
              >
                <Tags className="w-3 h-3" /> {item.with_labels ? 'With labels' : 'Without labels'}
              </span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-ink">{item.customer_name || 'Guest'}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-ink-muted mt-1">
              {item.customer_email && (
                <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{item.customer_email}</span>
              )}
              {item.customer_phone && (
                <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{item.customer_phone}</span>
              )}
            </div>
            {isStealthHealth && (
              <div
                className="mt-1.5 inline-flex items-start gap-1.5 text-[11px] text-violet-600 cursor-help"
                title={STEALTH_HEALTH_MISSING_INFO_TOOLTIP}
              >
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  Customer &amp; shipping details are managed by Stealth Health —
                  that&apos;s why some fields are blank.
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => openInvoice(false)}
                disabled={invoiceBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-xs font-semibold text-ink hover:bg-surface transition-colors disabled:opacity-50"
                title="View the full invoice (same as Admin → Invoices)"
              >
                {invoiceBusy === 'view' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                View Invoice
              </button>
              <button
                type="button"
                onClick={() => openInvoice(true)}
                disabled={invoiceBusy !== null}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white text-xs font-semibold text-ink hover:bg-surface border-l border-line transition-colors disabled:opacity-50"
                title="Download the invoice (print / save as PDF)"
              >
                {invoiceBusy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Download
              </button>
            </div>
            <button
              type="button"
              onClick={toggleRemoved}
              disabled={removing}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                item.removed_from_queue
                  ? 'border-line bg-white text-ink hover:border-ink/30'
                  : 'border-red-200 bg-white text-red-600 hover:bg-red-50'
              }`}
              title={item.removed_from_queue ? 'Restore this order to the active queue' : 'Remove this order from the active queue'}
            >
              {removing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : item.removed_from_queue ? (
                <RotateCcw className="w-3.5 h-3.5" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {item.removed_from_queue ? 'Restore to queue' : 'Remove from queue'}
            </button>
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-indigo-500/10 text-indigo-600'
              }`}
            >
              {done && <CheckCircle2 className="w-3.5 h-3.5" />}
              {statusLabel(item.fulfillment_status)}
            </span>
            <div className="text-sm font-bold text-ink tabular-nums">${item.total.toFixed(2)}</div>
            <div className="text-xs text-ink-muted">{item.item_count} item{item.item_count === 1 ? '' : 's'}</div>
          </div>
        </div>
      </div>

      {/* Destination */}
      <div className="px-5 py-3 bg-surface/50 border-b border-line text-sm">
        {isShipment ? (
          <div className="flex items-start gap-2 text-ink-muted">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-ink" />
            <div>
              {addr.address ? (
                <span className="text-ink">
                  {addr.address}, {addr.city} {addr.state} {addr.postalCode}, {addr.country}
                </span>
              ) : isStealthHealth ? (
                <span
                  className="inline-flex items-center gap-1.5 text-violet-600 cursor-help"
                  title={STEALTH_HEALTH_MISSING_INFO_TOOLTIP}
                >
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Shipping address managed by Stealth Health
                </span>
              ) : (
                'No shipping address on file'
              )}
              {item.tracking_number && (
                <div className="text-xs mt-0.5">
                  {item.carrier || 'Tracking'}: <span className="font-mono text-ink">{item.tracking_number}</span>
                  {item.tracking_url && (
                    <a href={item.tracking_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 ml-1 text-indigo-600 hover:underline">
                      track <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
              <div className="text-xs mt-1 inline-flex items-center gap-1.5">
                <Tag className={`w-3 h-3 ${item.has_label ? 'text-emerald-500' : 'text-amber-500'}`} />
                {item.has_label ? (
                  <span className="text-emerald-600 font-medium">
                    Shipping label ready
                    {item.label_url && (
                      <a href={item.label_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 ml-1 text-indigo-600 hover:underline">
                        view <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="text-amber-700">No shipping label yet — create one from the order page.</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-700">
            <Store className="w-4 h-4 shrink-0" />
            Customer collects in person — hold at the pickup counter.
          </div>
        )}
      </div>

      {/* Draft warning — must be marked ready before it can be fulfilled */}
      {isDraft && (
        <div className="mx-5 mt-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs text-amber-800 font-medium">
                This invoice is still a <strong>draft</strong>.
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Drafts can't be packed or shipped. Mark it ready to move it into the active queue and fulfill it.
              </p>
              <button
                type="button"
                onClick={markReady}
                disabled={readying}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {readying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Mark invoice as ready
              </button>
            </div>
          </div>
        </div>
      )}

      {errMsg && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {errMsg}
        </div>
      )}

      {/* Cleared-from-queue note — shown in the "Fulfilled / Removed" view when
          the order was cleared with an explanation. */}
      {item.removed_from_queue && item.removed_note && (
        <div className="mx-5 mt-3 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
          <div className="flex items-start gap-2">
            <Trash2 className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-red-800">
                Cleared from queue
                {item.removed_by_name ? ` by ${item.removed_by_name}` : ''}
                {item.removed_at ? ` · ${formatWhen(item.removed_at)}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-red-700 whitespace-pre-wrap break-words">
                {item.removed_note}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Items — each line can be marked Fulfilled or Backordered (by quantity) */}
      <div className="px-5 py-4 border-b border-line">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Items to pack
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              item.with_labels ? 'bg-vital/10 text-vital' : 'bg-ink/5 text-ink-muted'
            }`}
          >
            <Tags className="w-3 h-3" />
            {item.with_labels ? 'Apply product labels' : 'No product labels'}
          </span>
        </div>
        <ul className="space-y-2">
          {item.line_items.map((li) => {
            const rem = remainingOf(li);
            const lineDone = rem <= 0;
            const fullyFulfilled = li.qty_fulfilled >= li.qty;
            const busyKind = lineBusy[li.id] ?? null;
            return (
              <li
                key={li.id}
                className={`rounded-lg border p-2.5 transition-colors ${
                  lineDone ? 'border-line bg-surface/60 opacity-60' : 'border-line bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`text-sm ${lineDone ? 'text-ink-muted line-through' : 'text-ink'}`}>
                      {li.description}
                    </div>
                    {li.sku && (
                      <div className="font-mono text-[11px] text-ink-muted mt-0.5">{li.sku}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-ink-muted tabular-nums">Ordered ×{li.qty}</span>
                      {li.price_type === 'box' ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted tabular-nums"
                          title={`Sold by the box — ${li.vials_per_box} vials per box`}
                        >
                          <Box className="w-2.5 h-2.5" /> Box · {li.vials_per_box}/box · {li.qty * li.vials_per_box} vials
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 tabular-nums"
                          title="Sold by the single vial"
                        >
                          <FlaskConical className="w-2.5 h-2.5" /> Vial
                        </span>
                      )}
                      {li.qty_fulfilled > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 tabular-nums">
                          <Check className="w-2.5 h-2.5" /> Fulfilled ×{li.qty_fulfilled}
                        </span>
                      )}
                      {li.qty_backordered > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 tabular-nums">
                          <PackageX className="w-2.5 h-2.5" /> Backordered ×{li.qty_backordered}
                        </span>
                      )}
                    </div>
                  </div>
                  {fullyFulfilled && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  )}
                </div>

                {!lineDone && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                      Qty
                      <input
                        type="number"
                        min={1}
                        max={rem}
                        value={draftFor(li)}
                        onChange={(e) =>
                          setQtyDraft((p) => ({ ...p, [li.id]: parseInt(e.target.value, 10) || 1 }))
                        }
                        className="w-14 px-2 py-1 rounded-md border border-line bg-surface text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                      />
                      <span className="text-ink-muted">/ {rem}</span>
                    </label>
                    <button
                      onClick={() => handleFulfill(li)}
                      disabled={!!busyKind}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busyKind === 'fulfill' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Fulfilled
                    </button>
                    <button
                      onClick={() => handleBackorder(li)}
                      disabled={!!busyKind}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      {busyKind === 'backorder' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageX className="w-3.5 h-3.5" />}
                      Backorder
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-ink-muted">
          Backordered items move to a single non-payable backorder invoice linked to this order.
        </p>
      </div>

      {/* Handling checklist — tick off each step; state is saved per order */}
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
          {isShipment ? 'Shipment handling' : 'Pickup handling'}
        </div>
        <ul className="space-y-2">
          {steps.map((step, i) => {
            const isChecked = checked.has(step.key);
            const stepCurrent = i === currentIdx && !done;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => toggleChecklist(step.key)}
                  className={`w-full text-left flex items-start gap-2.5 rounded-lg p-2 transition-colors ${
                    isChecked ? 'bg-emerald-50/60' : stepCurrent ? 'bg-indigo-50/50' : 'hover:bg-surface'
                  }`}
                >
                  {isChecked ? (
                    <CheckSquare className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <Square className={`w-4 h-4 mt-0.5 shrink-0 ${stepCurrent ? 'text-indigo-500' : 'text-line'}`} />
                  )}
                  <div>
                    <div className={`text-sm font-medium ${isChecked ? 'text-ink-muted line-through' : 'text-ink'}`}>
                      {i + 1}. {step.label}
                    </div>
                    <div className="text-xs text-ink-muted">{step.detail}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Photo of packed products */}
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Photo of packed products
        </div>
        <p className="text-xs text-ink-muted mb-3">
          Capture or upload a photo of the sealed package as a record of what was sent.
        </p>

        {/* Hidden inputs: one opens the camera (mobile/iPad), one the file picker */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPickPhotos(e.target.files)}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onPickPhotos(e.target.files)}
        />

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={photoBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink text-white hover:bg-ink/90 disabled:opacity-50"
          >
            {photoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Take photo
          </button>
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={photoBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-line text-ink hover:border-ink/20 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" /> Upload image
          </button>
        </div>

        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <div key={p.path} className="relative group aspect-square rounded-lg overflow-hidden border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img src={p.url} alt="Packed product" className="w-full h-full object-cover" />
                </a>
                <button
                  onClick={() => onRemovePhoto(p.path)}
                  disabled={removingPhoto === p.path}
                  className="absolute top-1 right-1 inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                  title="Remove photo"
                >
                  {removingPhoto === p.path ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attribution — who packed / shipped and when */}
      {(item.packed_at || item.fulfilled_at) && (
        <div className="px-5 pb-2 pt-3 space-y-1">
          {item.packed_at && (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <PackageCheck className="w-3.5 h-3.5 text-ink-muted" />
              Packed{item.packed_by_name ? ` by ${item.packed_by_name}` : ''} · {formatWhen(item.packed_at)}
            </div>
          )}
          {item.fulfilled_at && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
              <UserCheck className="w-3.5 h-3.5" />
              {isShipment ? 'Shipped' : 'Picked up'}
              {item.fulfilled_by_name ? ` by ${item.fulfilled_by_name}` : ''} · {formatWhen(item.fulfilled_at)}
            </div>
          )}
        </div>
      )}

      {/* Customer notifications */}
      {canSendEmails && item.fulfillment_status !== 'pending' && (
        <div className="px-5 py-4 border-t border-line">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
            Notify customer
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onNotify(item, 'packed')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-line text-ink hover:border-ink/20"
            >
              <Mail className="w-3.5 h-3.5" />
              {isShipment ? 'Packed email' : 'Ready-for-pickup email'}
              {item.packed_emailed_at && (
                <span className="text-emerald-600">· sent {timeAgo(item.packed_emailed_at)}</span>
              )}
            </button>
            {done && (
              <button
                onClick={() => onNotify(item, 'shipped')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-line text-ink hover:border-ink/20"
              >
                <Mail className="w-3.5 h-3.5" />
                {isShipment ? 'Shipping notification' : 'Pickup confirmation'}
                {item.shipped_emailed_at && (
                  <span className="text-emerald-600">· sent {timeAgo(item.shipped_emailed_at)}</span>
                )}
              </button>
            )}
          </div>
          {isShipment && !item.tracking_number && (
            <p className="mt-2 text-[11px] text-amber-700">
              No tracking number yet — the shipping email will say tracking will follow.
            </p>
          )}
        </div>
      )}

      {/* Client packing list — this order ships to the customer's client, who
          receives only a Packing List (no pricing). Auto-sent on Shipped; can
          be sent/re-sent manually here. */}
      {item.ships_to_client && (
        <div className="px-5 py-4 border-t border-line">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Client packing list
          </div>
          {(item.client_name || item.client_address) && (
            <p className="text-xs text-ink-muted mb-2">
              Ships to{' '}
              <span className="text-ink font-medium">{item.client_name || 'client'}</span>
              {item.client_address ? ` · ${item.client_address}` : ''}
            </p>
          )}
          {(() => {
            const sentAt = packingSentTo ? new Date().toISOString() : item.packing_list_emailed_at;
            const sent = !!sentAt;
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={sendPackList}
                    disabled={packingBusy || !canSendEmails}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-line text-ink hover:border-ink/20 disabled:opacity-50"
                    title={
                      canSendEmails
                        ? 'Email the packing list to the client'
                        : "You don't have permission to send emails"
                    }
                  >
                    {packingBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    {sent ? 'Re-send packing list' : 'Send packing list'}
                  </button>
                  {sent && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                      <Check className="w-3 h-3" /> Sent {timeAgo(sentAt)}
                      {packingSentTo ? ` · ${packingSentTo}` : ''}
                    </span>
                  )}
                </div>
                {!sent && (
                  <p className="mt-2 text-[11px] text-ink-muted">
                    The packing list is sent automatically when this order is marked shipped.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Action */}
      <div className="px-5 py-4 mt-auto">
        {done ? (
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
            {isShipment ? 'Shipped' : 'Picked up'} — fulfillment complete
          </div>
        ) : isDraft ? (
          <button
            onClick={markReady}
            disabled={readying}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50"
            title="This draft must be marked ready before it can be fulfilled"
          >
            {readying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Mark ready to fulfill
          </button>
        ) : (
          <div className="space-y-3">
            {nextStatus === 'shipped' && !item.has_label && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <Tag className="w-3 h-3 flex-shrink-0" />
                No courier label generated yet — you&apos;ll be asked to confirm shipping without one.
              </p>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <button
                onClick={advance}
                disabled={busy || clearBusy}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {nextLabel}
              </button>
              {/* Clear the order out of the queue instead of fulfilling it —
                  requires a short note, then it moves to Fulfilled / Removed. */}
              <button
                type="button"
                onClick={() => setClearing((v) => !v)}
                disabled={busy || clearBusy}
                aria-expanded={clearing}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-red-600 border border-red-200 hover:bg-red-50 text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50 transition-colors"
                title="Remove this order from the queue with a note explaining why"
              >
                <Trash2 className="w-4 h-4" />
                Clear from queue
              </button>
            </div>

            {clearing && (
              <div className="p-3 rounded-lg border border-red-200 bg-red-50/60">
                <label
                  htmlFor="clear-note"
                  className="block text-[11px] font-semibold uppercase tracking-wider text-red-700 mb-1.5"
                >
                  Reason for clearing <span className="font-normal normal-case">(required)</span>
                </label>
                <textarea
                  id="clear-note"
                  value={clearNote}
                  onChange={(e) => setClearNote(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Why is this order being cleared from the queue? e.g. cancelled by customer, duplicate order, on hold…"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-red-400/40 resize-y"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={submitClear}
                    disabled={clearBusy || !clearNote.trim()}
                    className="inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg px-4 py-2 disabled:opacity-50 transition-colors"
                  >
                    {clearBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Confirm & clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClearing(false);
                      setClearNote('');
                    }}
                    disabled={clearBusy}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-white text-ink border border-line hover:border-ink/20 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
