import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import {
  listEasyshipShipments,
  type EasyshipShipmentRecord,
} from '@/lib/shipping/easyship';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Admin-only guard (assistants are read-only and can't run the sync). */
async function verifyAdmin(req: NextRequest): Promise<{ ok: boolean; userId: string | null }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { ok: false, userId: null };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { ok: false, userId: null };
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = customer?.role || 'customer';
  if (!canAccessAdmin(role) || role === 'assistant') return { ok: false, userId: user.id };
  return { ok: true, userId: user.id };
}

/** Normalise a name for matching: lowercased, whitespace-collapsed, trimmed. */
function normName(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface CandidateInvoice {
  id: string;
  invoice_number: string | null;
  name: string;
  issue_date: string | null;
  order_id: string;
}

/** A proposed shipment → invoice match returned in the preview. */
interface SyncMatch extends EasyshipShipmentRecord {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceName: string;
  /** More than one invoice shared the name — the best (newest) was chosen. */
  ambiguous: boolean;
  candidateCount: number;
}

/**
 * POST /api/admin/invoices/easyship-sync
 *
 * Two modes on one route:
 *  - Preview: body `{ date: "YYYY-MM-DD" }` → fetches Easyship shipments created
 *    on/after `date`, matches them to invoices by customer name, and returns the
 *    proposed matches + the unmatched shipments. Writes nothing.
 *  - Apply: body `{ apply: [{ invoiceId, shipmentId, ... }] }` → attaches each
 *    confirmed shipment onto the invoice's linked order (shipment id, tracking,
 *    label). Only orders without an existing shipment are touched.
 */
export async function POST(req: NextRequest) {
  const { ok, userId } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  if (Array.isArray(body?.apply)) {
    return applyMatches(body.apply, userId);
  }

  return previewMatches(typeof body?.date === 'string' ? body.date : '');
}

/** Build the preview: fetch shipments, match to unshipped invoices by name. */
async function previewMatches(date: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);

  const { records, error: easyshipError } = await listEasyshipShipments(day);

  const db = getSupabase();
  // Candidate invoices: bound to a shipment-type order that doesn't already have
  // an Easyship shipment attached (the "new ones" this sync fills in).
  const { data: rows, error: dbError } = await db
    .from('invoices')
    .select(
      `id, invoice_number, customer_name, issue_date, fulfillment_type,
       customer:customers!customer_id (first_name, last_name),
       order:orders!order_id (id, easyship_shipment_id, fulfillment_type, notes)`,
    )
    .order('issue_date', { ascending: false });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Index eligible invoices by normalised customer name.
  const byName = new Map<string, CandidateInvoice[]>();
  for (const row of rows ?? []) {
    const order: any = (row as any).order;
    if (!order?.id) continue; // no linked order to attach onto
    if (order.easyship_shipment_id) continue; // already has a shipment
    const fulfillment = (row as any).fulfillment_type ?? order.fulfillment_type;
    if (fulfillment === 'pickup' || order.notes === 'PICKUP') continue; // pickup, no label
    const customer: any = (row as any).customer;
    const name =
      (row as any).customer_name ||
      (customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') : '') ||
      '';
    const key = normName(name);
    if (!key) continue;
    const cand: CandidateInvoice = {
      id: (row as any).id,
      invoice_number: (row as any).invoice_number ?? null,
      name: name.trim(),
      issue_date: (row as any).issue_date ?? null,
      order_id: order.id,
    };
    const list = byName.get(key);
    if (list) list.push(cand);
    else byName.set(key, [cand]);
  }

  const matches: SyncMatch[] = [];
  const unmatched: EasyshipShipmentRecord[] = [];

  for (const rec of records) {
    const key = normName(rec.destinationName);
    const candidates = key ? byName.get(key) : undefined;
    if (!candidates || candidates.length === 0) {
      unmatched.push(rec);
      continue;
    }
    // Prefer the newest invoice when a name maps to several.
    const best = [...candidates].sort(
      (a, b) => new Date(b.issue_date ?? 0).getTime() - new Date(a.issue_date ?? 0).getTime(),
    )[0];
    matches.push({
      ...rec,
      invoiceId: best.id,
      invoiceNumber: best.invoice_number,
      invoiceName: best.name,
      ambiguous: candidates.length > 1,
      candidateCount: candidates.length,
    });
  }

  return NextResponse.json({
    date: day,
    fetched: records.length,
    easyshipError: records.length === 0 ? easyshipError : null,
    matches,
    unmatched,
  });
}

interface ApplyItem {
  invoiceId: string;
  shipmentId: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingStatus?: string | null;
  labelState?: string | null;
  labelUrl?: string | null;
  courier?: string | null;
}

/** Attach confirmed shipments onto each invoice's linked order. */
async function applyMatches(items: unknown[], userId: string | null) {
  const db = getSupabase();
  let applied = 0;
  let failed = 0;
  const skipped: Array<{ invoiceId: string; reason: string }> = [];

  for (const raw of items) {
    const item = raw as ApplyItem;
    if (!item || typeof item.invoiceId !== 'string' || typeof item.shipmentId !== 'string') {
      failed++;
      continue;
    }

    const { data: invoice } = await db
      .from('invoices')
      .select('id, order_id')
      .eq('id', item.invoiceId)
      .maybeSingle();
    if (!invoice?.order_id) {
      skipped.push({ invoiceId: item.invoiceId, reason: 'Invoice has no linked order' });
      continue;
    }

    const { data: order } = await db
      .from('orders')
      .select('id, easyship_shipment_id')
      .eq('id', invoice.order_id)
      .maybeSingle();
    if (!order) {
      skipped.push({ invoiceId: item.invoiceId, reason: 'Linked order not found' });
      continue;
    }
    if (order.easyship_shipment_id) {
      skipped.push({ invoiceId: item.invoiceId, reason: 'Order already has a shipment' });
      continue;
    }

    // Guard against binding the same Easyship shipment to two different orders.
    const { data: clash } = await db
      .from('orders')
      .select('id')
      .eq('easyship_shipment_id', item.shipmentId)
      .maybeSingle();
    if (clash && clash.id !== order.id) {
      skipped.push({ invoiceId: item.invoiceId, reason: 'Shipment already attached elsewhere' });
      continue;
    }

    const updates: Record<string, unknown> = {
      easyship_shipment_id: item.shipmentId,
      updated_at: new Date().toISOString(),
    };
    if (item.trackingNumber) updates.tracking_number = item.trackingNumber;
    if (item.trackingUrl) updates.tracking_url = item.trackingUrl;
    if (item.trackingStatus) updates.tracking_status = item.trackingStatus;
    if (item.courier) updates.carrier = item.courier;
    if (item.labelState) updates.label_state = item.labelState;
    if (item.labelUrl) updates.label_url = item.labelUrl;

    const { error: updErr } = await db.from('orders').update(updates).eq('id', order.id);
    if (updErr) {
      console.error('easyship-sync apply update failed:', updErr);
      failed++;
      continue;
    }

    applied++;
    await logAuditServer(db, {
      actor_id: userId,
      action: 'invoice.easyship_sync',
      entity_type: 'invoice',
      entity_id: item.invoiceId,
      payload: {
        order_id: order.id,
        easyship_shipment_id: item.shipmentId,
        tracking_number: item.trackingNumber ?? null,
        label_state: item.labelState ?? null,
      },
    });
  }

  return NextResponse.json({ applied, failed, skipped });
}
