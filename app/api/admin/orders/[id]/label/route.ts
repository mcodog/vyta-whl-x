import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import { getSupabase } from '@/lib/supabase';
import { getEasyshipShipmentLabel, fetchEasyshipDocument } from '@/lib/shipping/easyship';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/orders/[id]/label
 * Streams the Easyship label PDF for an order (the Easyship document URL needs
 * the API key, so we proxy it). Refreshes the URL from Easyship if not stored.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!canAccessAdmin(customer?.role || 'customer')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const db = getSupabase();
  const { data: order } = await db
    .from('orders')
    .select('id, easyship_shipment_id, label_url')
    .eq('id', id)
    .single();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  let labelUrl = order.label_url as string | null;

  // Refresh from Easyship if we don't have the URL yet (label may have just
  // finished generating).
  if (!labelUrl && order.easyship_shipment_id) {
    const info = await getEasyshipShipmentLabel(order.easyship_shipment_id);
    if (info.labelUrl) {
      labelUrl = info.labelUrl;
      await db
        .from('orders')
        .update({ label_url: info.labelUrl, label_state: info.labelState || 'generated' })
        .eq('id', order.id);
    }
  }

  if (!labelUrl) {
    return NextResponse.json({ error: 'Label not ready yet' }, { status: 409 });
  }

  const doc = await fetchEasyshipDocument(labelUrl);
  if (!doc) {
    return NextResponse.json({ error: 'Could not fetch label PDF' }, { status: 502 });
  }

  return new NextResponse(doc.buffer, {
    headers: {
      'Content-Type': doc.contentType || 'application/pdf',
      'Content-Disposition': 'inline; filename="label.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}
