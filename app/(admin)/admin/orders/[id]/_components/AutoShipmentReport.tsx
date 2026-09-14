'use client';

import React from 'react';
import { Bot, Check, X, Clock, Minus, AlertCircle } from 'lucide-react';
import type { AutoShipmentLog } from '@/lib/admin/api';

interface Props {
  order: any;
  logs: AutoShipmentLog[];
}

type RowState = 'success' | 'failed' | 'pending' | 'none';

function StatePill({ state, label }: { state: RowState; label: string }) {
  const map: Record<RowState, string> = {
    success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    failed: 'bg-red-500/10 text-red-700 border-red-500/20',
    pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    none: 'bg-line/40 text-ink-muted border-line',
  };
  const icon = {
    success: <Check className="w-3 h-3" />,
    failed: <X className="w-3 h-3" />,
    pending: <Clock className="w-3 h-3" />,
    none: <Minus className="w-3 h-3" />,
  }[state];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${map[state]}`}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * Per-order report of the automatic Easyship flow: did the draft shipment and
 * the shipping label get created automatically, and if not, exactly why. This
 * runs server-side and never affects the customer — it's purely for the admin
 * looking at this order. Shows the latest outcome of each stage plus the full
 * attempt history.
 */
export default function AutoShipmentReport({ order, logs }: Props) {
  const latest = (stage: 'shipment' | 'label') =>
    logs.find((l) => l.stage === stage) ?? null;

  const shipmentLog = latest('shipment');
  const labelLog = latest('label');

  // Resolve the display state for each stage from the live order fields first,
  // then fall back to the recorded log outcome.
  const shipmentState: RowState = order.easyship_shipment_id
    ? 'success'
    : shipmentLog
      ? shipmentLog.ok
        ? 'success'
        : 'failed'
      : 'none';

  const labelStateRaw = String(order.label_state || '');
  const labelState: RowState =
    labelStateRaw === 'generated'
      ? 'success'
      : labelStateRaw === 'pending'
        ? 'pending'
        : labelStateRaw === 'failed'
          ? 'failed'
          : labelLog
            ? labelLog.ok
              ? 'success'
              : 'failed'
            : 'none';

  const shipmentLabelText =
    shipmentState === 'success'
      ? 'Created automatically'
      : shipmentState === 'failed'
        ? 'Auto-create failed'
        : 'Not auto-created';

  const labelLabelText =
    labelState === 'success'
      ? 'Bought automatically'
      : labelState === 'pending'
        ? 'Generating'
        : labelState === 'failed'
          ? 'Auto-buy failed'
          : 'Not auto-bought';

  const hasAnyActivity = logs.length > 0 || order.auto_shipment_status;
  const anyFailed = shipmentState === 'failed' || labelState === 'failed';

  return (
    <div className="bg-white rounded-xl border border-line p-5">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-4 h-4 text-ink-muted" />
        <h2 className="font-semibold text-ink">Automatic shipping</h2>
      </div>
      <p className="text-[11px] text-ink-muted mb-4">
        Server-side automation — this never affects the customer at checkout.
      </p>

      {!hasAnyActivity ? (
        <p className="text-sm text-ink-muted">
          No automatic shipment activity for this order yet. Automation runs only when
          it&apos;s enabled in{' '}
          <span className="font-medium text-ink">Settings → Automatic shipments</span>.
        </p>
      ) : (
        <>
          {/* Stage summary */}
          <div className="space-y-2.5 mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Shipment record</p>
                {shipmentState === 'failed' && shipmentLog?.error && (
                  <p className="text-xs text-red-700 mt-0.5 break-words">{shipmentLog.error}</p>
                )}
                {shipmentState === 'success' && shipmentLog?.courier && (
                  <p className="text-[11px] text-ink-muted mt-0.5">via {shipmentLog.courier}</p>
                )}
              </div>
              <StatePill state={shipmentState} label={shipmentLabelText} />
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Shipping label</p>
                {labelState === 'failed' && labelLog?.error && (
                  <p className="text-xs text-red-700 mt-0.5 break-words">{labelLog.error}</p>
                )}
                {labelState === 'pending' && (
                  <p className="text-[11px] text-ink-muted mt-0.5">
                    Label is generating — refresh shortly.
                  </p>
                )}
              </div>
              <StatePill state={labelState} label={labelLabelText} />
            </div>
          </div>

          {/* Remediation hint when something failed */}
          {anyFailed && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">
                The customer was not affected. Fix the issue above (e.g. add a missing
                phone number via <span className="font-medium">Edit</span> in the Shipping
                Label panel) and retry there.
              </p>
            </div>
          )}

          {/* Attempt history */}
          {logs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1.5">
                Attempt history
              </p>
              <ul className="space-y-1.5">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={`mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        l.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-500'
                      }`}
                    >
                      {l.ok ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ink capitalize">
                        {l.stage === 'label' ? 'Label purchase' : 'Shipment creation'}
                      </span>{' '}
                      <span className={l.ok ? 'text-emerald-700' : 'text-red-700'}>
                        {l.ok ? 'succeeded' : 'failed'}
                      </span>
                      {!l.ok && l.error && (
                        <span className="block text-ink-muted break-words">{l.error}</span>
                      )}
                    </span>
                    <span className="text-ink-muted whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
