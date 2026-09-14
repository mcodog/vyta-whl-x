'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  X,
  Printer,
  Package,
  Loader2,
  Pencil,
  Save,
  Truck,
  Settings,
  AlertCircle,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import {
  getLabelReadiness,
  updateOrderShippingAddress,
  createOrderShipment,
  buyOrderLabel,
  openOrderLabel,
  getOrderShippingRates,
  type LabelReadiness,
  type OrderCourierRate,
} from '@/lib/admin/api';

interface Props {
  orderId: string;
  /** Called after a shipment/label change so the parent can refresh the order. */
  onChanged?: () => void | Promise<void>;
}

type DestForm = LabelReadiness['destination'];

const COUNTRIES = [
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'United States' },
];

export default function ShippingLabelPanel({ orderId, onChanged }: Props) {
  const [readiness, setReadiness] = useState<LabelReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DestForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [rates, setRates] = useState<OrderCourierRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  // Per-shipment options: courier handover (who hands the parcel over) and
  // whether to insure the declared value. Drop-off is the default.
  const [handover, setHandover] = useState<'pickup' | 'dropoff'>('dropoff');
  const [insured, setInsured] = useState(false);

  const load = useCallback(async () => {
    const res = await getLabelReadiness(orderId);
    if (res.success && res.data) {
      setReadiness(res.data);
      setForm((prev) => prev ?? res.data!.destination);
    } else {
      setError(res.error || 'Failed to load shipping readiness');
    }
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch live courier options once a destination exists and no shipment has
  // been created yet, so the admin can pick a courier before creating one.
  const hasShipment = readiness?.shipment.hasShipment;
  const isPickup = readiness?.isPickup;
  const destPostal = readiness?.destination.postalCode;
  useEffect(() => {
    if (!readiness || isPickup || hasShipment || !destPostal) {
      setRates([]);
      return;
    }
    let cancelled = false;
    setRatesLoading(true);
    getOrderShippingRates(orderId).then((r) => {
      if (cancelled) return;
      setRates(r.rates);
      // Never auto-pick a courier — the admin must choose one explicitly.
      setRatesLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, hasShipment, isPickup, destPostal]);

  const refresh = async () => {
    setLoading(true);
    await load();
    await onChanged?.();
  };

  const startEdit = () => {
    if (readiness) setForm(readiness.destination);
    setEditing(true);
    setError('');
  };

  // Fill any blank destination fields from the linked customer on file. Doesn't
  // overwrite values you've already entered.
  const smartFill = () => {
    const s = readiness?.suggested;
    if (!s) return;
    setForm((f) => {
      const base = f ?? readiness!.destination;
      const next = { ...base };
      (Object.keys(s) as (keyof DestForm)[]).forEach((k) => {
        if (!next[k] && s[k]) next[k] = s[k];
      });
      return next;
    });
  };

  const handleSaveAddress = async () => {
    if (!form) return;
    setSaving(true);
    setError('');
    const res = await updateOrderShippingAddress(orderId, form);
    if (!res.success) {
      setError(res.error || 'Failed to save address');
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
    await load();
    await onChanged?.();
  };

  const handleCreateShipment = async () => {
    setCreating(true);
    setError('');
    const res = await createOrderShipment(orderId, selectedCourierId || undefined, {
      insured,
      handover,
    });
    if (!res.success) setError(res.error || 'Failed to create shipment');
    setCreating(false);
    await load();
    await onChanged?.();
  };

  const handleBuyLabel = async () => {
    setBuying(true);
    setError('');
    const res = await buyOrderLabel(orderId);
    if (!res.success) setError(res.error || 'Failed to buy label');
    setBuying(false);
    await load();
    await onChanged?.();
  };

  const handlePrint = async () => {
    setError('');
    const res = await openOrderLabel(orderId);
    if (!res.success) setError(res.error || 'Label not available yet');
  };

  const card = 'bg-white rounded-xl border border-line p-5';

  if (loading && !readiness) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-4 h-4 text-ink-muted" />
          <h2 className="font-semibold text-ink">Shipping Label</h2>
        </div>
        <p className="text-sm text-ink-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking requirements…
        </p>
      </div>
    );
  }

  if (!readiness) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-4 h-4 text-ink-muted" />
          <h2 className="font-semibold text-ink">Shipping Label</h2>
        </div>
        <p className="text-sm text-red-500">{error || 'Unable to load shipping requirements.'}</p>
      </div>
    );
  }

  if (readiness.isPickup) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-4 h-4 text-ink-muted" />
          <h2 className="font-semibold text-ink">Shipping Label</h2>
        </div>
        <p className="text-sm text-ink-muted">
          This is a <span className="font-medium text-ink">local pickup</span> order — no shipping
          label is required.
        </p>
      </div>
    );
  }

  const { shipment, checks, ready } = readiness;
  const settingsChecks = checks.filter((c) => c.category === 'settings');
  const destChecks = checks.filter((c) => c.category === 'destination');
  const parcelChecks = checks.filter((c) => c.category === 'parcel');
  const passed = checks.filter((c) => c.ok).length;
  const settingsFailing = settingsChecks.some((c) => !c.ok);

  const Row = ({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) => (
    <li className="flex items-start gap-2.5 py-1">
      <span
        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
          ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-500'
        }`}
      >
        {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      </span>
      <span className="text-sm leading-tight">
        <span className={ok ? 'text-ink' : 'text-ink font-medium'}>{label}</span>
        {!ok && hint && <span className="block text-[11px] text-ink-muted mt-0.5">{hint}</span>}
      </span>
    </li>
  );

  const field = (
    key: keyof DestForm,
    label: string,
    opts: { wide?: boolean; type?: string } = {},
  ) => (
    <div className={opts.wide ? 'sm:col-span-2' : ''}>
      <label className="block text-[11px] font-medium text-ink-muted mb-1">{label}</label>
      <input
        type={opts.type || 'text'}
        value={form?.[key] ?? ''}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
      />
    </div>
  );

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-ink-muted" />
          <h2 className="font-semibold text-ink">Shipping Label</h2>
        </div>
        <button
          onClick={refresh}
          title="Refresh"
          className="text-ink-muted hover:text-ink transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Shipment already exists → label actions */}
      {shipment.hasShipment ? (
        <div className="space-y-2">
          <div className="text-xs text-ink-muted space-y-0.5">
            <p>
              Shipment: <span className="font-mono text-ink">{shipment.shipmentId}</span>
            </p>
            {shipment.carrier && (
              <p>
                Carrier: <span className="text-ink">{shipment.carrier}</span>
              </p>
            )}
            {shipment.trackingNumber && (
              <p>
                Tracking: <span className="font-mono text-ink">{shipment.trackingNumber}</span>
              </p>
            )}
            {shipment.labelState && (
              <p className="capitalize">
                Label:{' '}
                <span className="text-ink">{String(shipment.labelState).replace(/_/g, ' ')}</span>
              </p>
            )}
          </div>

          {shipment.labelState === 'generated' ? (
            <button
              onClick={handlePrint}
              className="w-full px-3 py-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4" /> Print label
            </button>
          ) : shipment.labelState === 'pending' ? (
            <button
              onClick={handleBuyLabel}
              disabled={buying}
              className="w-full px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Label generating — refresh
            </button>
          ) : (
            <button
              onClick={handleBuyLabel}
              disabled={buying}
              className="w-full px-3 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Buy &amp; print label
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-ink-muted">
              {passed}/{checks.length} requirements met
            </span>
            {ready ? (
              <span className="text-xs font-medium text-emerald-600 inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Ready
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-600 inline-flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Action needed
              </span>
            )}
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden mb-4">
            <div
              className={`h-full transition-all ${ready ? 'bg-emerald-500' : 'bg-vital'}`}
              style={{ width: `${(passed / Math.max(checks.length, 1)) * 100}%` }}
            />
          </div>

          {/* Settings checks */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Account / Settings</p>
            <ul className="space-y-0.5">
              {settingsChecks.map((c) => (
                <Row key={c.key} ok={c.ok} label={c.label} hint={c.hint} />
              ))}
            </ul>
            {settingsFailing && (
              <Link
                href="/admin/settings"
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-vital hover:text-vital/80"
              >
                <Settings className="w-3.5 h-3.5" /> Open Shipping settings
              </Link>
            )}
          </div>

          {/* Destination checks + inline editor */}
          <div className="mb-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                Destination address
              </p>
              {!editing && (
                <div className="flex items-center gap-3">
                  {readiness.suggested && (
                    <button
                      onClick={() => { startEdit(); smartFill(); }}
                      title="Fill blank fields from the customer on file"
                      className="text-xs text-vital hover:text-vital/80 inline-flex items-center gap-1"
                    >
                      <Wand2 className="w-3 h-3" /> Smart fill
                    </button>
                  )}
                  <button
                    onClick={startEdit}
                    className="text-xs text-vital hover:text-vital/80 inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                </div>
              )}
            </div>

            {!editing ? (
              <ul className="space-y-0.5">
                {destChecks.map((c) => (
                  <Row key={c.key} ok={c.ok} label={c.label} hint={c.hint} />
                ))}
              </ul>
            ) : (
              <div className="bg-surface/60 border border-line rounded-lg p-3 mt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {field('firstName', 'First name')}
                  {field('lastName', 'Last name')}
                  {field('phone', 'Phone', { type: 'tel' })}
                  {field('email', 'Email', { type: 'email' })}
                  {field('address', 'Street address', { wide: true })}
                  {field('city', 'City')}
                  {field('state', 'Province / State')}
                  {field('postalCode', 'Postal code')}
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">Country</label>
                    <select
                      value={form?.country ?? 'CA'}
                      onChange={(e) => setForm((f) => (f ? { ...f, country: e.target.value } : f))}
                      className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {readiness.suggested && (
                  <button
                    onClick={smartFill}
                    type="button"
                    className="mt-3 w-full px-3 py-2 bg-vital/10 border border-vital/20 text-vital rounded-lg text-sm font-medium hover:bg-vital/20 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Wand2 className="w-4 h-4" /> Smart fill from customer
                  </button>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleSaveAddress}
                    disabled={saving}
                    className="flex-1 px-3 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save address
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="px-3 py-2 bg-surface border border-line text-ink rounded-lg text-sm hover:bg-line/20 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Parcel / order checks */}
          {parcelChecks.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Parcel</p>
              <ul className="space-y-0.5">
                {parcelChecks.map((c) => (
                  <Row key={c.key} ok={c.ok} label={c.label} hint={c.hint} />
                ))}
              </ul>
            </div>
          )}

          {/* Courier selection */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Courier</p>
            {ratesLoading ? (
              <p className="text-xs text-ink-muted flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading courier options…
              </p>
            ) : rates.length > 0 ? (
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              >
                <option value="">Select a courier…</option>
                {rates.map((r) => (
                  <option key={r.courierId} value={r.courierId}>
                    {r.courier} — ${r.cost.toFixed(2)} {r.currency}
                    {r.minDays && r.maxDays ? ` · ${r.minDays}-${r.maxDays} days` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-ink-muted">
                No live courier rates yet — Easyship will pick a courier automatically.
              </p>
            )}
          </div>

          {/* Courier handover — who hands the parcel to the courier. */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Handover</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'dropoff', label: 'We drop off' },
                { value: 'pickup', label: 'Courier pickup' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setHandover(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    handover === opt.value
                      ? 'bg-vital/5 text-ink border-vital/40'
                      : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Insurance — cover the declared value. */}
          <button
            type="button"
            role="switch"
            aria-checked={insured}
            onClick={() => setInsured((v) => !v)}
            className={`w-full mb-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              insured
                ? 'bg-vital/5 text-ink border-vital/40'
                : 'bg-surface text-ink-muted border-line hover:border-ink/20'
            }`}
          >
            <span className="flex items-center gap-2 text-left">
              <Package className={`w-4 h-4 flex-shrink-0 ${insured ? 'text-vital' : 'text-ink-muted'}`} />
              <span>
                Insure shipment
                <span className="block text-[11px] font-normal text-ink-muted">
                  Cover the parcel&apos;s declared value.
                </span>
              </span>
            </span>
            <span
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                insured ? 'bg-vital' : 'bg-line'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  insured ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>

          {/* Create shipment — gated on readiness and an explicit courier
              choice (when live rates are available to choose from). */}
          <button
            onClick={handleCreateShipment}
            disabled={!ready || creating || (rates.length > 0 && !selectedCourierId)}
            title={
              ready
                ? rates.length > 0 && !selectedCourierId
                  ? 'Select a courier first'
                  : 'Create the Easyship shipment'
                : 'Complete the checklist above first'
            }
            className="w-full px-3 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            Create shipment &amp; label
          </button>
          {!ready ? (
            <p className="text-[11px] text-ink-muted text-center mt-1.5">
              Complete every requirement above to enable label creation.
            </p>
          ) : rates.length > 0 && !selectedCourierId ? (
            <p className="text-[11px] text-ink-muted text-center mt-1.5">
              Select a courier above to enable label creation.
            </p>
          ) : null}
        </>
      )}

      {error && (
        <p className="text-[11px] text-red-500 mt-2 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
