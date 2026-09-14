'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Radio, Truck, Store, Mail, X, PackageCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import FulfillmentEmailModal from '@/components/FulfillmentEmailModal';
import CollapsibleAlert from './CollapsibleAlert';
import { useUserRole } from '@/app/(admin)/admin/layout';
import type { NotificationKind } from '@/lib/warehouse/api';

interface Event {
  key: string;
  id: string; // invoice id
  invoice_number: string;
  customer_name: string | null;
  fulfillment_type: 'shipment' | 'pickup';
  fulfillment_status: string;
  at: number;
}

const ACTIVE = new Set(['packed', 'shipped', 'picked_up']);

function label(status: string): string {
  if (status === 'packed') return 'packed';
  if (status === 'shipped') return 'shipped';
  if (status === 'picked_up') return 'picked up';
  return status;
}

// Live banner on the admin dashboard: when a warehouse account marks an order
// packed/shipped/picked-up, it appears here in real time with a one-click
// "Notify customer" action (admins can always send). Only admins can send
// emails, so this is hidden for assistants.
export default function FulfillmentAlerts() {
  const role = useUserRole();
  const toast = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [notify, setNotify] = useState<{ id: string; kind: NotificationKind; type: 'shipment' | 'pickup' } | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (role !== 'admin') return;
    const channel = supabase
      .channel('admin-fulfillment')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'invoices' },
        (payload) => {
          const n = payload.new as any;
          if (!n || !ACTIVE.has(n.fulfillment_status)) return;
          const key = `${n.id}:${n.fulfillment_status}`;
          if (seen.current.has(key)) return;
          seen.current.add(key);
          const ev: Event = {
            key,
            id: n.id,
            invoice_number: n.invoice_number,
            customer_name: n.customer_name ?? null,
            fulfillment_type: n.fulfillment_type === 'pickup' ? 'pickup' : 'shipment',
            fulfillment_status: n.fulfillment_status,
            at: Date.now(),
          };
          setEvents((prev) => [ev, ...prev].slice(0, 8));
          toast.info(
            `${ev.customer_name || ev.invoice_number} — order ${label(n.fulfillment_status)}`,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, toast]);

  if (role !== 'admin' || events.length === 0) return null;

  const dismiss = (key: string) => setEvents((prev) => prev.filter((e) => e.key !== key));

  return (
    <>
      <CollapsibleAlert
        tone="indigo"
        icon={
          <div className="w-9 h-9 bg-vital/10 rounded-lg flex items-center justify-center shrink-0">
            <PackageCheck className="w-5 h-5 text-vital" />
          </div>
        }
        title={<h2 className="text-base font-bold text-ink">Fulfillment activity</h2>}
        badge={
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
            <Radio className="w-3 h-3" /> Live
          </span>
        }
        subtitle={
          <p className="text-xs text-ink-muted">
            {events.length} recent order {events.length === 1 ? 'update' : 'updates'}
          </p>
        }
        summary={
          <ul className="space-y-1.5">
            {events.slice(0, 4).map((e) => (
              <li key={e.key} className="flex items-center gap-2 min-w-0 text-xs">
                <span className="font-medium text-ink truncate">{e.customer_name || 'Guest'}</span>
                <span className="text-ink-muted">— {label(e.fulfillment_status)}</span>
                <span className="font-mono text-ink-muted shrink-0">{e.invoice_number}</span>
              </li>
            ))}
            {events.length > 4 && (
              <li className="text-xs text-ink-muted">+{events.length - 4} more — click to expand</li>
            )}
          </ul>
        }
      >
        <ul className="divide-y divide-line/50">
          {events.map((e) => {
            const isShipment = e.fulfillment_type === 'shipment';
            const kind: NotificationKind = e.fulfillment_status === 'packed' ? 'packed' : 'shipped';
            return (
              <li key={e.key} className="px-5 py-3 flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-md shrink-0 bg-surface text-ink-muted">
                  {isShipment ? <Truck className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">
                    <span className="font-medium">{e.customer_name || 'Guest'}</span>
                    {' '}— order <span className="font-semibold">{label(e.fulfillment_status)}</span>
                    <span className="ml-1.5 font-mono text-xs text-ink-muted">{e.invoice_number}</span>
                  </div>
                </div>
                <button
                  onClick={() => setNotify({ id: e.id, kind, type: e.fulfillment_type })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-ink text-white hover:bg-ink/90 shrink-0"
                >
                  <Mail className="w-3.5 h-3.5" /> Notify customer
                </button>
                <button onClick={() => dismiss(e.key)} className="text-ink-muted hover:text-ink shrink-0" aria-label="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsibleAlert>

      {notify && (
        <FulfillmentEmailModal
          invoiceId={notify.id}
          kind={notify.kind}
          fulfillmentType={notify.type}
          onClose={() => setNotify(null)}
        />
      )}
    </>
  );
}
