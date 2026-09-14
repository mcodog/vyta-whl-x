import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { renderPackingListPdf, type PackingListData } from "@/lib/admin/packing-list-pdf";

// Re-exported from the shared, dependency-free module so existing importers keep
// working while the shipping lib can use the same defaults.
export { DEFAULT_CLIENT_EMAIL, DEFAULT_CLIENT_PHONE } from "@/lib/shipping/contact-defaults";

export interface SendPackingListOptions {
  /** Actor for the audit/log columns (null for an automatic send). */
  userId?: string | null;
  userEmail?: string | null;
  /** Explicit recipient override (else resolved from client → customer → default). */
  toOverride?: string | null;
  /** True when triggered automatically (e.g. on shipped) rather than by a click. */
  auto?: boolean;
}

export interface SendPackingListResult {
  success: boolean;
  to?: string;
  error?: string;
  /** Set when the invoice isn't a client shipment (nothing to send). */
  skipped?: boolean;
}

/**
 * Generate and email the Packing List for an invoice to the customer's client.
 * The client receives ONLY this document (never the invoice). Shared by the
 * warehouse manual-send endpoint and the automatic send when an invoice is
 * marked shipped.
 */
export async function sendPackingList(
  supabase: SupabaseClient,
  invoiceId: string,
  opts: SendPackingListOptions = {},
): Promise<SendPackingListResult> {
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, order_id, ships_to_client, client_id,
      customer_name, customer_email, notes,
      customer:customers!customer_id (first_name, last_name, email),
      client:customer_clients!client_id (
        first_name, last_name, address, city, state, postal_code, country, phone, email
      ),
      order:orders!order_id (order_number, carrier, tracking_number, tracking_url),
      line_items:invoice_line_items (description, qty, product:products (sku))
    `)
    .eq("id", invoiceId)
    .single();

  if (invErr || !inv) return { success: false, error: "Invoice not found" };
  if (!inv.ships_to_client || !inv.client_id || !inv.client) {
    return { success: false, skipped: true, error: "This invoice does not ship to a client" };
  }

  const client: any = inv.client;
  const customer: any = inv.customer ?? {};
  const order: any = inv.order ?? {};

  // Recipient name is the customer's (the parcel is addressed under them);
  // the address is the client's.
  const recipientName =
    inv.customer_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() ||
    "Customer";

  // Where the Packing List email goes: explicit override → client's email →
  // customer's email → the default client inbox.
  const to =
    (opts.toOverride?.trim() || "") ||
    (client.email?.trim() || "") ||
    (inv.customer_email?.trim() || "") ||
    (customer.email?.trim() || "") ||
    DEFAULT_CLIENT_EMAIL;

  const data: PackingListData = {
    invoice_number: inv.invoice_number,
    order_number: order.order_number ?? null,
    issue_date: new Date().toISOString(),
    recipient_name: recipientName,
    ship_to: {
      address: client.address ?? null,
      city: client.city ?? null,
      state: client.state ?? null,
      postal_code: client.postal_code ?? null,
      country: client.country ?? null,
    },
    tracking: {
      carrier: order.carrier ?? null,
      number: order.tracking_number ?? null,
      url: order.tracking_url ?? null,
    },
    line_items: (inv.line_items ?? []).map((li: any) => ({
      sku: li.product?.sku ?? null,
      description: li.description,
      qty: Number(li.qty ?? 0),
    })),
    notes: inv.notes ?? null,
  };

  let pdf: Buffer;
  try {
    pdf = await renderPackingListPdf(data);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed to render packing list";
    console.error("renderPackingListPdf failed:", e);
    return { success: false, error };
  }

  const ref = order.order_number || inv.invoice_number;
  const trackingBlock = order.tracking_number
    ? `<p style="font-size:14px;color:#07203A;margin:0 0 8px;">
         Carrier: <strong>${order.carrier || "Courier"}</strong><br/>
         Tracking: <span style="font-family:monospace;">${order.tracking_number}</span>
         ${order.tracking_url ? `<br/><a href="${order.tracking_url}" style="color:#438B9E;">Track your shipment</a>` : ""}
       </p>`
    : `<p style="font-size:14px;color:#5B7A8C;margin:0 0 8px;">Tracking details will follow shortly.</p>`;

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="padding:32px 24px;text-align:center;border-bottom:1px solid #DCE7EB;">
        <h1 style="font-size:24px;font-weight:700;letter-spacing:5px;color:#07203A;margin:0;">VYTA</h1>
        <p style="font-size:10px;letter-spacing:4px;color:#438B9E;margin:6px 0 0;">BIOSCIENCES</p>
      </div>
      <div style="padding:32px 24px;">
        <h2 style="font-size:20px;font-weight:600;color:#07203A;margin:0 0 8px;">Your shipment is on its way</h2>
        <p style="font-size:14px;color:#5B7A8C;margin:0 0 20px;">
          A packing list for shipment <strong>${ref}</strong> is attached.
        </p>
        <div style="background:#F7FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
          ${trackingBlock}
        </div>
        <p style="font-size:12px;color:#8FA9B6;margin:0;">The attached PDF lists the contents of your parcel.</p>
      </div>
      <div style="padding:24px;text-align:center;background:#F7FAFB;border-top:1px solid #DCE7EB;">
        <p style="font-size:12px;color:#8FA9B6;margin:0;">VYTA Biosciences &bull; Canada</p>
      </div>
    </div>`;

  const sendResult = await sendEmail({
    to,
    subject: `Packing List — ${ref}`,
    html,
    attachments: [
      { filename: `packing-list-${ref}.pdf`, content: pdf, contentType: "application/pdf" },
    ],
  });

  // Record the send attempt (success or failure) in the shared fulfillment log.
  await supabase.from("fulfillment_email_log").insert({
    invoice_id: invoiceId,
    order_id: inv.order_id,
    kind: "packing_list",
    to_email: to,
    subject: `Packing List — ${ref}`,
    message_id: sendResult.id ?? null,
    success: sendResult.success,
    error: sendResult.error ?? null,
    sent_by: opts.userId ?? null,
    sent_by_email: opts.userEmail ?? null,
  });

  if (!sendResult.success) {
    return { success: false, to, error: sendResult.error ?? "Send failed" };
  }

  await supabase
    .from("invoices")
    .update({
      packing_list_emailed_at: new Date().toISOString(),
      packing_list_emailed_by: opts.userId ?? null,
      packing_list_emailed_to: to,
    })
    .eq("id", invoiceId);

  return { success: true, to };
}
