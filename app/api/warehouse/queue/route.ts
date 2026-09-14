import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Warehouse staff (and admins) may read the fulfillment queue. Everything here
// flows through the service-role client, so the role check IS the access
// boundary — keep it strict.
export async function verifyWarehouse(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, role: "customer" as const, userId: null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, role: "customer" as const, userId: null };
    const { data: customer } = await supabase
      .from("customers")
      .select("role, can_send_fulfillment_emails")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    // Admins can always email customers; warehouse staff only when granted.
    const canSendEmails =
      role === "admin" || (role === "warehouse" && !!customer?.can_send_fulfillment_emails);
    return {
      authorized: role === "warehouse" || role === "admin",
      role,
      canSendEmails,
      userId: user.id,
    };
  } catch {
    return { authorized: false, role: "customer" as const, canSendEmails: false, userId: null };
  }
}

// Column selection shared by the queue list and the single-invoice lookup so
// both return an identically-shaped item.
export const QUEUE_SELECT = `
      id, invoice_number, order_id, customer_id, customer_name, customer_email, customer_phone,
      total, status, source, with_labels, fulfillment_type, fulfillment_status, created_at,
      packed_at, fulfilled_at, packed_emailed_at, shipped_emailed_at,
      ships_to_client, client_id, packing_list_emailed_at,
      removed_from_queue, removed_at, removed_note,
      handling_checklist, packed_photos,
      customer:customers!customer_id (first_name, last_name, email, phone),
      client:customer_clients!client_id (first_name, last_name, address, city, state, postal_code, country, phone, email),
      packer:customers!packed_by (first_name, last_name),
      fulfiller:customers!fulfilled_by (first_name, last_name),
      remover:customers!removed_by (first_name, last_name),
      order:orders!order_id (id, order_number, status, fulfillment_type, tracking_number, carrier, tracking_url, shipping_address, label_state, label_url),
      line_items:invoice_line_items (id, description, qty, qty_fulfilled, qty_backordered, price_type, product:products (sku, vials_per_box))
    `;

// Map a raw invoice row (selected via QUEUE_SELECT) into the client-facing
// QueueItem shape. Shared by the list GET and the single-invoice GET.
export function mapQueueRow(row: any) {
  const customerName =
    row.customer_name ??
    (row.customer
      ? [row.customer.first_name, row.customer.last_name].filter(Boolean).join(" ")
      : null);
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    order_id: row.order_id,
    order_number: row.order?.order_number ?? null,
    order_status: row.order?.status ?? null,
    tracking_number: row.order?.tracking_number ?? null,
    tracking_url: row.order?.tracking_url ?? null,
    carrier: row.order?.carrier ?? null,
    shipping_address: row.order?.shipping_address ?? null,
    label_state: row.order?.label_state ?? null,
    label_url: row.order?.label_url ?? null,
    has_label: row.order?.label_state === "generated",
    customer_name: customerName,
    customer_email: row.customer_email ?? row.customer?.email ?? null,
    customer_phone: row.customer_phone ?? row.customer?.phone ?? null,
    total: Number(row.total),
    status: row.status,
    // Origin of the invoice: 'stealth_health' for PuraMass hosted-checkout
    // orders (drives the queue badge + missing-info tooltips), null otherwise.
    source: row.source ?? null,
    // Whether the order ships with product labels applied to the vials — set on
    // the invoice ("With labels" toggle) and surfaced here so the packer knows
    // whether to label. Distinct from the Easyship shipping label (has_label).
    with_labels: row.with_labels !== false,
    fulfillment_type: row.fulfillment_type,
    fulfillment_status: row.fulfillment_status,
    packed_at: row.packed_at,
    packed_by_name: row.packer
      ? [row.packer.first_name, row.packer.last_name].filter(Boolean).join(" ")
      : null,
    fulfilled_at: row.fulfilled_at,
    fulfilled_by_name: row.fulfiller
      ? [row.fulfiller.first_name, row.fulfiller.last_name].filter(Boolean).join(" ")
      : null,
    packed_emailed_at: row.packed_emailed_at,
    shipped_emailed_at: row.shipped_emailed_at,
    ships_to_client: !!row.ships_to_client,
    packing_list_emailed_at: row.packing_list_emailed_at,
    client_name: row.client
      ? [row.client.first_name, row.client.last_name].filter(Boolean).join(" ") || null
      : null,
    client_email: row.client?.email ?? null,
    client_address: row.client
      ? [row.client.address, row.client.city, row.client.state, row.client.postal_code, row.client.country]
          .filter(Boolean)
          .join(", ") || null
      : null,
    removed_from_queue: !!row.removed_from_queue,
    removed_at: row.removed_at,
    // Reason captured when the order was cleared from the queue, plus who
    // cleared it — surfaced in the "Fulfilled / Removed" view.
    removed_note: row.removed_note ?? null,
    removed_by_name: row.remover
      ? [row.remover.first_name, row.remover.last_name].filter(Boolean).join(" ") || null
      : null,
    item_count: (row.line_items ?? []).reduce(
      (s: number, li: any) => s + Number(li.qty ?? 0),
      0,
    ),
    line_items: (row.line_items ?? []).map((li: any) => ({
      id: li.id,
      description: li.description,
      sku: li.product?.sku ?? null,
      qty: Number(li.qty ?? 0),
      qty_fulfilled: Number(li.qty_fulfilled ?? 0),
      qty_backordered: Number(li.qty_backordered ?? 0),
      // Whether this line was priced/sold as a box (pack of N vials) or a
      // single vial, and how many vials one box contains — so the packer
      // knows a box line's "×2" means 2 boxes, not 2 vials.
      price_type: li.price_type === "vial" ? "vial" : "box",
      vials_per_box: Number(li.product?.vials_per_box ?? 10),
    })),
    handling_checklist: Array.isArray(row.handling_checklist) ? row.handling_checklist : [],
    packed_photos: Array.isArray(row.packed_photos) ? row.packed_photos : [],
    created_at: row.created_at,
  };
}

// GET /api/warehouse/queue
// Invoices to fulfil (drafts included), newest first, with their fulfillment
// method, workflow status, and the originating order (if any).
export async function GET(request: NextRequest) {
  const { authorized, role, canSendEmails } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const fulfillmentStatus = params.get("fulfillment_status"); // pending|packed|shipped|picked_up
  const fulfillmentType = params.get("fulfillment_type"); // shipment|pickup

  let query = supabase
    .from("invoices")
    .select(QUEUE_SELECT)
    // Drafts are included so the warehouse can see/prep them; the summary below
    // still excludes drafts from the "to fulfil" counts.
    //
    // `pending_payment` is different: it is a hosted-checkout invoice whose
    // customer has NOT paid yet (an abandoned checkout stays here forever).
    // Packing one would ship goods against money that never arrived, so it is
    // excluded from the queue outright rather than merely uncounted. It enters
    // the queue the moment the payment webhook flips it to `paid`.
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false });

  if (fulfillmentStatus) query = query.eq("fulfillment_status", fulfillmentStatus);
  if (fulfillmentType) query = query.eq("fulfillment_type", fulfillmentType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map(mapQueueRow);

  // The "expired" (aged) threshold, in days, that the queue uses to hide old
  // straggler cards by default. Configured in admin settings; falls back to 3
  // when the column/row is missing (e.g. migration not yet run).
  let expiredDays = 3;
  const { data: settingsRow } = await supabase
    .from("site_settings")
    .select("fulfillment_expired_days")
    .single();
  if (
    settingsRow?.fulfillment_expired_days != null &&
    Number.isInteger(Number(settingsRow.fulfillment_expired_days)) &&
    Number(settingsRow.fulfillment_expired_days) > 0
  ) {
    expiredDays = Number(settingsRow.fulfillment_expired_days);
  }

  // Summary counts for the dashboard cards (active = not yet shipped/picked up).
  const summary = items.reduce(
    (acc, it) => {
      acc.total += 1;
      // Drafts aren't ready to be worked yet, and removed invoices are out of
      // the active queue — keep both out of the "to fulfil" counts. Unpaid
      // hosted-checkout invoices never reach here (filtered from the query
      // above), but the status test is belt-and-braces.
      if (
        it.status !== "draft" &&
        it.status !== "pending_payment" &&
        !it.removed_from_queue &&
        (it.fulfillment_status === "pending" || it.fulfillment_status === "packed")
      ) {
        acc.toFulfill += 1;
        if (it.fulfillment_type === "shipment") acc.shipments += 1;
        else acc.pickups += 1;
      }
      return acc;
    },
    { total: 0, toFulfill: 0, shipments: 0, pickups: 0 },
  );

  return NextResponse.json({
    items,
    summary,
    expired_days: expiredDays,
    viewer: { role, can_send_emails: canSendEmails },
  });
}

