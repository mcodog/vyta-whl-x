'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Package,
  PackageCheck,
  PackageX,
  Camera,
  Upload,
  X,
  Check,
  CheckCircle2,
  CheckSquare,
  Square,
  Loader2,
  UserCheck,
  Box,
  FlaskConical,
  Users,
  MapPin,
} from 'lucide-react';
import {
  type QueueItem,
  stepsFor,
  statusLabel,
  isComplete,
  currentStepIndex,
  formatWhen,
  getQueueItem,
  saveChecklist,
  fulfillLine,
  backorderLine,
  uploadPackedPhoto,
  deletePackedPhoto,
  updateFulfillmentStatus,
} from '@/lib/warehouse/api';
import type { FulfillmentStatus } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

interface Props {
  invoiceId: string;
  /** Only admins/warehouse may take actions; others (e.g. affiliates) see read-only. */
  canAct?: boolean;
  /** Called after a mutation so the parent invoice can refresh if it wants. */
  onChanged?: () => void;
}

/**
 * Fulfillment panel for the admin invoice detail page. Mirrors what warehouse
 * accounts see in the fulfillment queue — packed photos, per-line
 * fulfill/backorder, the handling checklist and status advancement — so admins
 * can view and drive fulfillment without leaving the invoice.
 *
 * Its data is fetched lazily (separate from the main invoice load) so it never
 * slows the invoice page's first paint; photos are lazy-loaded images.
 */
export default function FulfillmentPanel({ invoiceId, canAct = true, onChanged }: Props) {
  const toast = useToast();
  const [item, setItem] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [lineBusy, setLineBusy] = useState<Record<string, 'fulfill' | 'backorder' | null>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const { item: fetched } = await getQueueItem(invoiceId);
      setItem(fetched);
      setChecked(new Set(fetched.handling_checklist ?? []));
      setNotFound(false);
    } catch (e: any) {
      // 404 = no fulfillment record yet (e.g. never spawned an order). Treat as
      // "nothing to show" rather than an error.
      if (String(e?.message ?? '').toLowerCase().includes('not found')) setNotFound(true);
      else setErrMsg(e?.message ?? 'Could not load fulfillment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setErrMsg(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  const remainingOf = (li: QueueItem['line_items'][number]) =>
    Math.max(0, li.qty - li.qty_fulfilled - li.qty_backordered);

  const draftFor = (li: QueueItem['line_items'][number]) => {
    const rem = remainingOf(li);
    const d = qtyDraft[li.id];
    if (d == null) return rem;
    return Math.max(1, Math.min(d, rem || 1));
  };

  const toggleChecklist = async (key: string) => {
    if (!item || !canAct) return;
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
    try {
      await saveChecklist(item.id, [...next]);
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not save the checklist');
      setChecked(new Set(checked));
    }
  };

  const handleFulfill = async (li: QueueItem['line_items'][number]) => {
    if (!item) return;
    const rem = remainingOf(li);
    if (rem <= 0) return;
    const add = draftFor(li);
    setErrMsg(null);
    setLineBusy((p) => ({ ...p, [li.id]: 'fulfill' }));
    try {
      await fulfillLine(item.id, li.id, li.qty_fulfilled + add);
      await refresh();
      setQtyDraft((p) => ({ ...p, [li.id]: undefined as any }));
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not mark fulfilled');
    } finally {
      setLineBusy((p) => ({ ...p, [li.id]: null }));
    }
  };

  const handleBackorder = async (li: QueueItem['line_items'][number]) => {
    if (!item) return;
    const rem = remainingOf(li);
    if (rem <= 0) return;
    const add = draftFor(li);
    setErrMsg(null);
    setLineBusy((p) => ({ ...p, [li.id]: 'backorder' }));
    try {
      await backorderLine(item.id, li.id, add);
      await refresh();
      setQtyDraft((p) => ({ ...p, [li.id]: undefined as any }));
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not create backorder');
    } finally {
      setLineBusy((p) => ({ ...p, [li.id]: null }));
    }
  };

  const onPickPhotos = async (files: FileList | null) => {
    if (!item || !files || files.length === 0) return;
    setErrMsg(null);
    setPhotoBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadPackedPhoto(item.id, file);
      }
      await refresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Photo upload failed');
    } finally {
      setPhotoBusy(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const onRemovePhoto = async (path: string) => {
    if (!item) return;
    setRemovingPhoto(path);
    try {
      await deletePackedPhoto(item.id, path);
      await refresh();
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Could not remove photo');
    } finally {
      setRemovingPhoto(null);
    }
  };

  // Directly set the shipping/fulfillment status from the dropdown — mirrors the
  // invoice list's Shipping column. Emits a success/error toast either way.
  const handleStatusChange = async (next: FulfillmentStatus) => {
    if (!item || next === item.fulfillment_status) return;
    setErrMsg(null);
    setSavingStatus(true);
    try {
      await updateFulfillmentStatus(item.id, next);
      await refresh();
      toast.success(`Shipping status set to “${statusLabel(next)}”`);
    } catch (e: any) {
      const msg = e?.message ?? 'Could not update shipping status';
      setErrMsg(msg);
      toast.error(msg);
    } finally {
      setSavingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-line p-5">
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-bronze" /> Fulfillment
        </h3>
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading fulfillment…
        </div>
      </div>
    );
  }

  // No fulfillment record (unusual) — don't render an empty card.
  if (notFound || !item) return null;

  const isShipment = item.fulfillment_type === 'shipment';
  const steps = stepsFor(item.fulfillment_type);
  const currentIdx = currentStepIndex(item.fulfillment_status);
  const done = isComplete(item.fulfillment_status);
  const isDraft = item.status === 'draft';
  const photos = item.packed_photos ?? [];

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-bronze" /> Fulfillment
        </h3>
        <span
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
            done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-indigo-500/10 text-indigo-600'
          }`}
        >
          {done && <CheckCircle2 className="w-3.5 h-3.5" />}
          {statusLabel(item.fulfillment_status)}
        </span>
      </div>

      {errMsg && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {errMsg}
        </div>
      )}

      {isDraft && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          This invoice is still a draft — mark it ready (set status to Sent) before packing or shipping.
        </div>
      )}

      {/* Ship to (client) — this order ships to the customer's client, who
          receives only a Packing List. Surfaced here so the packer sees the
          real destination without leaving the fulfillment view. */}
      {item.ships_to_client && (
        <div className="mx-5 mt-3 rounded-lg border border-bronze/30 bg-bronze/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" /> Ship to
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bronze/15 text-bronze">
              <Users className="w-2.5 h-2.5" /> Client
            </span>
          </div>
          <div className="text-sm text-ink space-y-0.5">
            {item.client_name && <p className="font-medium">{item.client_name}</p>}
            {item.client_address && <p>{item.client_address}</p>}
            {item.client_email && <p className="text-ink-muted break-all">{item.client_email}</p>}
            {!item.client_name && !item.client_address && (
              <p className="text-ink-muted">Client on file — details unavailable.</p>
            )}
          </div>
          <p className="text-[11px] text-ink-muted mt-1.5">
            The client receives a Packing List only (no pricing).
          </p>
        </div>
      )}

      {/* Items — per-line fulfill / backorder */}
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Items to pack
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
                  lineDone ? 'border-line bg-surface/60 opacity-70' : 'border-line bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`text-sm ${lineDone ? 'text-ink-muted line-through' : 'text-ink'}`}>
                      {li.description}
                    </div>
                    {li.sku && <div className="font-mono text-[11px] text-ink-muted mt-0.5">{li.sku}</div>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-ink-muted tabular-nums">Ordered ×{li.qty}</span>
                      {li.price_type === 'box' ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-600 tabular-nums">
                          <Box className="w-2.5 h-2.5" /> Box · {li.vials_per_box}/box · {li.qty * li.vials_per_box} vials
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 tabular-nums">
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
                  {fullyFulfilled && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
                </div>

                {!lineDone && canAct && (
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
                        className="w-14 px-2 py-1 rounded-md border border-line bg-surface text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-bronze/40"
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
      </div>

      {/* Handling checklist */}
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
          {isShipment ? 'Shipment handling' : 'Pickup handling'}
        </div>
        <ul className="space-y-1.5">
          {steps.map((step, i) => {
            const isChecked = checked.has(step.key);
            const stepCurrent = i === currentIdx && !done;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => toggleChecklist(step.key)}
                  disabled={!canAct}
                  className={`w-full text-left flex items-start gap-2.5 rounded-lg p-2 transition-colors disabled:cursor-default ${
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

      {/* Packed photos */}
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Photo of packed products
        </div>
        <p className="text-xs text-ink-muted mb-3">
          A record of what was sent — captured by the warehouse when packing.
        </p>

        {canAct && (
          <>
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
          </>
        )}

        {photos.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <div key={p.path} className="relative group aspect-square rounded-lg overflow-hidden border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img src={p.url} alt="Packed product" loading="lazy" className="w-full h-full object-cover" />
                </a>
                {canAct && (
                  <button
                    onClick={() => onRemovePhoto(p.path)}
                    disabled={removingPhoto === p.path}
                    className="absolute top-1 right-1 inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                    title="Remove photo"
                  >
                    {removingPhoto === p.path ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          !canAct && <p className="text-xs text-ink-muted">No photos uploaded yet.</p>
        )}
      </div>

      {/* Attribution */}
      {(item.packed_at || item.fulfilled_at) && (
        <div className="px-5 py-3 space-y-1 border-b border-line">
          {item.packed_at && (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <PackageCheck className="w-3.5 h-3.5" />
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

      {/* Shipping status — set directly, mirroring the invoice list's Shipping
          column. Any status can be picked (including stepping back to correct a
          mistake); each change fires a success/error toast. */}
      <div className="px-5 py-4">
        {canAct ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="fulfillment-status-select"
              className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
            >
              Shipping status
            </label>
            <div className="flex items-center gap-2">
              <select
                id="fulfillment-status-select"
                value={item.fulfillment_status}
                disabled={savingStatus || isDraft}
                title={isDraft ? 'Mark the invoice ready (Sent) before fulfilling' : undefined}
                onChange={(e) => handleStatusChange(e.target.value as FulfillmentStatus)}
                aria-label="Shipping status"
                className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50 cursor-pointer"
              >
                <option value="pending">To pack</option>
                <option value="packed">Packed</option>
                {isShipment ? (
                  <>
                    <option value="shipped">Shipped</option>
                    <option value="dropped_off">Dropped off</option>
                  </>
                ) : (
                  <option value="picked_up">Picked up</option>
                )}
              </select>
              {savingStatus && <Loader2 className="w-4 h-4 animate-spin text-bronze" />}
              {done && !savingStatus && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            </div>
            {isDraft && (
              <p className="text-xs text-ink-muted">
                Mark the invoice ready (set status to Sent) before fulfilling.
              </p>
            )}
          </div>
        ) : (
          done && (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
              {isShipment ? 'Shipped' : 'Picked up'} — fulfillment complete
            </div>
          )
        )}
      </div>
    </div>
  );
}
