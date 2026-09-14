import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canEdit } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { sendOrderConfirmation, sendShippingNotification } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, userId: null, email: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, userId: null, email: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role, email")
    .eq("id", user.id)
    .single();
  return {
    role: (customer?.role || "customer") as "customer" | "warehouse" | "assistant" | "admin",
    userId: user.id,
    email: (customer?.email ?? user.email ?? null) as string | null,
  };
}

// The two customer notifications the invoice screen can send, mapped to the
// invoice columns that record who/when each was last sent.
const KINDS = {
  order_confirmation: {
    at: "order_confirmation_emailed_at",
    by: "order_confirmation_emailed_by",
    byEmail: "order_confirmation_emailed_by_email",
    action: "invoice.email.order_confirmation",
  },
  shipping_notification: {
    at: "shipping_notification_emailed_at",
    by: "shipping_notification_emailed_by",
    byEmail: "shipping_notification_emailed_by_email",
    action: "invoice.email.shipping_notification",
  },
} as const;

type Kind = keyof typeof KINDS;

/**
 * POST /api/admin/invoices/:id/notify — admin only.
 *
 * Sends the customer an order-confirmation or shipping-notification email from
 * the invoice screen and records who sent it and when, so the "Email Customer"
 * panel can show "Sent {when} by {who}". This replaces the previous
 * unauthenticated /api/email call for these two actions, which left no record.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId, email: actorEmail } = await getAuth(request);
  if (!canEdit(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id: invoiceId } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const kind = String(body.kind ?? "") as Kind;
  if (!(kind in KINDS)) {
    return NextResponse.json({ error: `Invalid kind '${body.kind}'` }, { status: 400 });
  }
  const cols = KINDS[kind];

  const { data: invoice } = await supabase
    .from("invoices")
    .select(`
      *,
      customer:customers!customer_id (first_name, last_name, email),
      order:orders!order_id (order_number, tracking_number),
      line_items:invoice_line_items (description, qty, unit_price)
    `)
    .eq("id", invoiceId)
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const to = (invoice.customer?.email ?? invoice.customer_email ?? "").trim();
  if (!to) {
    return NextResponse.json({ error: "No customer email on file" }, { status: 422 });
  }

  const customerName =
    (invoice.customer
      ? `${invoice.customer.first_name ?? ""} ${invoice.customer.last_name ?? ""}`.trim()
      : invoice.customer_name) || "Customer";
  const orderNumber = invoice.order?.order_number || invoice.invoice_number;

  let result: { success: boolean; id?: string | null; error?: string };
  if (kind === "order_confirmation") {
    const items = (invoice.line_items ?? []).map((li: any) => ({
      name: li.description,
      quantity: li.qty,
      price: Number(li.unit_price),
    }));
    result = await sendOrderConfirmation({
      to,
      customerName,
      orderNumber,
      items,
      subtotal: Number(invoice.subtotal),
      shipping: Number(invoice.shipping_cost),
      total: Number(invoice.total),
      currency: invoice.currency || "CAD",
    });
  } else {
    const trackingNumber =
      (typeof body.trackingNumber === "string" && body.trackingNumber.trim()) ||
      invoice.order?.tracking_number ||
      "Pending";
    result = await sendShippingNotification({ to, customerName, orderNumber, trackingNumber });
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to send email" },
      { status: 502 },
    );
  }

  const sentAt = new Date().toISOString();
  const { error: stampErr } = await supabase
    .from("invoices")
    .update({
      [cols.at]: sentAt,
      [cols.by]: userId,
      [cols.byEmail]: actorEmail,
    })
    .eq("id", invoiceId);
  // The email is already out — a failed bookkeeping stamp shouldn't 500 the
  // send, just log it (e.g. columns missing on a pre-migration database).
  if (stampErr) console.error("notify stamp failed for invoice", invoiceId, stampErr);

  await logAuditServer(supabase, {
    actor_id: userId,
    action: cols.action,
    entity_type: "invoice",
    entity_id: invoiceId,
    payload: { to, kind },
  });

  return NextResponse.json({
    success: true,
    kind,
    to,
    sent_at: sentAt,
    by: actorEmail,
  });
}
