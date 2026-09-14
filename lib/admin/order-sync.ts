import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CLIENT_EMAIL, DEFAULT_CLIENT_PHONE } from "@/lib/admin/send-packing-list";

/** A client (end-recipient) row shape as read from customer_clients. */
export interface ClientRow {
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Build the order/Easyship shipping_address for a client shipment: the parcel —
 * and the Easyship record built from it — goes to the CLIENT's address and is
 * addressed under the CLIENT's own name and contact info. Email and phone are
 * optional on the client, so they fall back to the customer's, then the house
 * default. The client's name falls back to the customer's only when the client
 * record carries no name (so the courier label always has a recipient).
 */
export function buildClientShipAddress(
  client: ClientRow,
  opts: {
    customerName?: string | null;
    customerFirst?: string | null;
    customerLast?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
  },
): Record<string, any> {
  // Prefer the client's own name; fall back to the customer's (name field, then
  // the split full name) only when the client has none on file.
  let firstName = (client.first_name ?? "").trim();
  let lastName = (client.last_name ?? "").trim();
  if (!firstName && !lastName) {
    firstName = (opts.customerFirst ?? "").trim();
    lastName = (opts.customerLast ?? "").trim();
    if (!firstName && !lastName && opts.customerName) {
      const [f, ...rest] = opts.customerName.trim().split(/\s+/).filter(Boolean);
      firstName = f ?? "";
      lastName = rest.join(" ");
    }
  }
  return {
    firstName,
    lastName,
    address: client.address ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    postalCode: client.postal_code ?? "",
    country: client.country || "CA",
    phone: (client.phone?.trim() || opts.customerPhone?.trim() || DEFAULT_CLIENT_PHONE) ?? DEFAULT_CLIENT_PHONE,
    email: (client.email?.trim() || opts.customerEmail?.trim() || DEFAULT_CLIENT_EMAIL) ?? DEFAULT_CLIENT_EMAIL,
  };
}

// Order statuses that mean "not yet fulfilled" — safe to remap from the
// invoice. We never move a shipped/delivered/cancelled order backwards.
const PRE_FULFILLMENT = new Set([
  "pending",
  "pending_invoice",
  "received",
  "confirmed",
  "processing",
]);

/**
 * Push the invoice's contents down onto its linked order so the admin/orders
 * record stays in sync (the invoice is the source of truth). Syncs line items,
 * total, contact, fulfillment method, and a mapped status; and, for a client
 * shipment, repoints the shipping address to the client. Best-effort: never
 * throws — logs and returns.
 */
export async function syncOrderFromInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  try {
    const { data: inv } = await supabase
      .from("invoices")
      .select(`
        id, order_id, customer_id, customer_name, customer_email, customer_phone,
        total, status, fulfillment_type, ships_to_client, client_id,
        client:customer_clients!client_id (first_name, last_name, address, city, state, postal_code, country, phone, email),
        line_items:invoice_line_items (product_id, description, qty, unit_price)
      `)
      .eq("id", invoiceId)
      .single();

    if (!inv?.order_id) return;

    const { data: order } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", inv.order_id)
      .single();
    if (!order) return;

    const lines = (inv.line_items ?? []) as Array<{
      product_id: string | null;
      description: string;
      qty: number;
      unit_price: number;
    }>;

    const items = lines.map((l) => ({
      name: l.description,
      quantity: l.qty,
      price: Number(l.unit_price),
    }));

    const update: Record<string, any> = {
      customer_id: inv.customer_id,
      email: inv.customer_email,
      items,
      total: Number(inv.total),
      fulfillment_type: inv.fulfillment_type,
      notes: inv.fulfillment_type === "pickup" ? "PICKUP" : null,
    };

    // Only remap the order status when it hasn't been fulfilled yet. A
    // cancelled invoice leaves the order's status untouched rather than
    // pushing it forward to "processing".
    if (PRE_FULFILLMENT.has(order.status) && inv.status !== "cancelled") {
      update.status = inv.status === "draft" ? "pending_invoice" : "processing";
    }

    // For a client shipment, keep the order shipping to the client's address.
    // For a regular invoice we leave the order's address untouched (it may have
    // been set manually or already fed to Easyship).
    if (inv.fulfillment_type === "shipment" && inv.ships_to_client && inv.client) {
      update.shipping_address = buildClientShipAddress(inv.client as ClientRow, {
        customerName: inv.customer_name,
        customerPhone: inv.customer_phone,
        customerEmail: inv.customer_email,
      });
    }

    await supabase.from("orders").update(update).eq("id", inv.order_id);

    // Rebuild order_items to mirror the invoice's lines (the order detail page
    // reads this table, not the items JSONB).
    await supabase.from("order_items").delete().eq("order_id", inv.order_id);
    if (lines.length > 0) {
      await supabase.from("order_items").insert(
        lines.map((l) => ({
          order_id: inv.order_id,
          product_name: l.description,
          product_id: l.product_id ? String(l.product_id) : null,
          quantity: l.qty,
          price_at_time: l.unit_price,
          strength: null,
        })),
      );
    }
  } catch (e) {
    console.error("syncOrderFromInvoice failed:", e);
  }
}
