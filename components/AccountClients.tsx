'use client';

import React, { useEffect, useState } from 'react';
import { Users, MapPin, Truck, Package, Clock, CheckCircle, ExternalLink, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Client {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
}

interface Shipment {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  total: number;
  issue_date: string | null;
  created_at: string;
  fulfillment_status: string | null;
  fulfillment_type: string | null;
  client_id: string | null;
  tracking: {
    order_number: string | null;
    status: string | null;
    tracking_number: string | null;
    tracking_status: string | null;
    tracking_url: string | null;
    carrier: string | null;
  } | null;
}

// Customer-facing display for a shipment's fulfillment stage. Kept local because
// these are the warehouse fulfillment_status values (pending → packed → shipped/
// picked_up/dropped_off), distinct from the storefront order statuses.
function fulfillmentDisplay(status: string | null): { label: string; color: string; Icon: LucideIcon } {
  switch (status) {
    case 'packed':
      return { label: 'Packed', color: 'text-blue-700 bg-blue-50 border-blue-100', Icon: Package };
    case 'shipped':
      return { label: 'Shipped', color: 'text-indigo-700 bg-indigo-50 border-indigo-100', Icon: Truck };
    case 'picked_up':
      return { label: 'Picked up', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', Icon: CheckCircle };
    case 'dropped_off':
      return { label: 'Dropped off', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', Icon: CheckCircle };
    default:
      return { label: 'Preparing', color: 'text-amber-700 bg-amber-50 border-amber-100', Icon: Clock };
  }
}

function clientName(c: Client): string {
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return name || 'Unnamed client';
}

function clientLocation(c: Client): string {
  return [c.city, c.state, c.country].filter(Boolean).join(', ');
}

function shipmentDate(s: Shipment): string {
  const iso = s.issue_date || s.created_at;
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * "Ship-to Clients" card on the customer account dashboard. A reseller customer
 * places orders that ship to their own clients (end-recipients); this surfaces
 * those clients and the status of each shipment sent to them, mirroring the data
 * admins/affiliates already see — without exposing anything but the customer's
 * own records. Renders nothing for customers who have no ship-to clients, so a
 * regular customer's dashboard is unchanged.
 */
export default function AccountClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await fetch('/api/customers/clients', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setClients(Array.isArray(data.clients) ? data.clients : []);
          setShipments(Array.isArray(data.shipments) ? data.shipments : []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show for non-reseller customers — keep their dashboard as-is.
  if (loading || clients.length === 0) return null;

  const byClient = new Map<string, Shipment[]>();
  for (const s of shipments) {
    if (!s.client_id) continue;
    const list = byClient.get(s.client_id) ?? [];
    list.push(s);
    byClient.set(s.client_id, list);
  }

  return (
    <div className="mt-4 sm:mt-6 md:mt-8 bg-white rounded-xl border border-vital-200 overflow-hidden">
      <div className="p-4 sm:p-5 md:p-6 border-b border-vital-100">
        <h2 className="text-base sm:text-lg font-bold text-ink flex items-center gap-2">
          <Users className="w-4 sm:w-5 h-4 sm:h-5 text-vital-600" />
          Ship-to Clients
        </h2>
        <p className="text-[11px] sm:text-xs text-ink-muted mt-1">
          Recipients your orders ship to, and the status of each shipment sent to them.
        </p>
      </div>

      <div className="divide-y divide-vital-100">
        {clients.map((client) => {
          const clientShipments = byClient.get(client.id) ?? [];
          return (
            <div key={client.id} className="p-3 sm:p-4 md:p-5">
              <div className="flex items-start gap-2 sm:gap-3">
                <div className="w-8 h-8 rounded-lg bg-vital-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-ink-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink text-xs sm:text-sm truncate">
                      {clientName(client)}
                    </p>
                    {clientShipments.length > 0 && (
                      <span className="text-[10px] sm:text-xs text-ink-light flex-shrink-0 tabular-nums">
                        {clientShipments.length} shipment{clientShipments.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5 truncate">
                    {client.address}
                    {clientLocation(client) ? ` · ${clientLocation(client)}` : ''}
                  </p>

                  {clientShipments.length === 0 ? (
                    <p className="text-[10px] sm:text-xs text-ink-light mt-2">No shipments yet</p>
                  ) : (
                    <div className="mt-2 sm:mt-3 space-y-2">
                      {clientShipments.map((s) => {
                        const f = fulfillmentDisplay(s.fulfillment_status);
                        const trackingUrl = s.tracking?.tracking_url || null;
                        return (
                          <div
                            key={s.id}
                            className="flex items-center justify-between gap-2 sm:gap-3 rounded-lg border border-vital-100 bg-vital-50/50 px-2.5 sm:px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-[11px] sm:text-xs font-medium text-vital-800 truncate">
                                {s.invoice_number}
                              </p>
                              <p className="text-[10px] sm:text-[11px] text-ink-light mt-0.5">
                                {shipmentDate(s)}
                                {s.tracking?.carrier ? ` · ${s.tracking.carrier}` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-medium border ${f.color}`}
                              >
                                <f.Icon className="w-3 h-3" />
                                <span>{f.label}</span>
                              </span>
                              {trackingUrl && (
                                <a
                                  href={trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold text-vital-600 hover:text-vital-700"
                                >
                                  Track
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
