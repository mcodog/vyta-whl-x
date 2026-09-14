import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { checkLowStockForProducts } from "@/lib/admin/low-stock";
import { autoBuyLabelForPaidInvoice } from "@/lib/shipping/auto-shipment";
import { sendPaymentReceivedSMTP } from "@/lib/email-smtp";

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

const ALLOWED_METHODS = new Set(["card", "e-transfer", "cash", "crypto", "other"]);

// POST /api/admin/invoices/:id/payments — admin only
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId, email: actorEmail } = await getAuth(request);
  if (!canCreate(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id: invoiceId } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
  }
  const method = String(body.method ?? "");
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: `Invalid method '${method}'` }, { status: 400 });
  }

  // Fetch invoice + existing payments for overpayment guard
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, payments (amount)")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const paidSoFar = (invoice.payments ?? []).reduce(
    (s: number, p: any) => s + Number(p.amount),
    0,
  );
  const due = Number(invoice.total) - paidSoFar;
  // Overpayment guard: round to two decimals to avoid float jitter
  if (Number(amount.toFixed(2)) > Number(due.toFixed(2)) + 0.001) {
    return NextResponse.json(
      { error: `Amount $${amount.toFixed(2)} exceeds the $${due.toFixed(2)} still due on this invoice` },
      { status: 422 },
    );
  }

  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      amount,
      method,
      reference_note: body.reference_note ?? null,
      paid_at: body.paid_at ?? new Date().toISOString(),
      recorded_by: userId,
    })
    .select()
    .single();
  if (payErr || !payment) {
    // A check-constraint violation here means the database's allowed methods
    // have drifted behind ALLOWED_METHODS above (e.g. 'crypto' before
    // invoice-payment-crypto-method-migration.sql has been run). Raw Postgres
    // text tells the admin nothing actionable, so name the cause instead.
    if (payErr?.code === "23514") {
      return NextResponse.json(
        {
          error: `The database rejected the '${method}' payment method. Run the pending payments migration (invoice-payment-crypto-method-migration.sql) to allow it.`,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: payErr?.message ?? "Insert failed" }, { status: 500 });
  }

  // Recompute invoice status
  const newPaidTotal = paidSoFar + amount;
  let nextStatus = invoice.status;
  if (newPaidTotal + 0.001 >= Number(invoice.total)) {
    nextStatus = "paid";
  } else if (newPaidTotal > 0) {
    nextStatus = "partial";
  }
  if (nextStatus !== invoice.status) {
    await supabase.from("invoices").update({ status: nextStatus }).eq("id", invoiceId);
  }

  // When the invoice becomes fully paid, decrement product stock for its line
  // items. The DB function is idempotent, so the once-paid guard is belt-and-
  // suspenders against double decrements.
  if (nextStatus === "paid") {
    const { error: stockErr } = await supabase.rpc("adjust_stock_for_invoice", { p_invoice_id: invoiceId });
    if (stockErr) console.error("Stock adjustment failed for invoice", invoiceId, stockErr);
    const { data: liRows } = await supabase
      .from("invoice_line_items")
      .select("product_id")
      .eq("invoice_id", invoiceId);
    const ids = (liRows ?? []).map((r: any) => r.product_id).filter(Boolean);
    await checkLowStockForProducts(supabase, ids).catch((e) => console.error("low-stock check failed:", e));

    // Auto-buy the Easyship label now that the order is paid (when enabled in
    // Settings). Runs after the response so the admin isn't blocked on the
    // courier API; best-effort and self-logging.
    after(() => autoBuyLabelForPaidInvoice(supabase, invoiceId));
  }

  // --------------------------------------------------------------------------
  // Customer payment-confirmation email.
  //
  // Driven by the admin's toggle in the record-payment confirmation modal
  // (`send_email`) rather than firing automatically on the paid transition, so
  // the admin decides — per payment — whether the customer is notified. Sent
  // synchronously (not in an after() hook) so we can persist and return whether
  // it actually went out, and surface "sent / not sent" back in the UI.
  // --------------------------------------------------------------------------
  const wantEmail = body.send_email === true;
  const recipient = (invoice.customer_email as string | null)?.trim() || null;

  let emailRequested = false;
  let emailSentAt: string | null = null;
  let emailError: string | null = null;
  let emailTo: string | null = null;
  // Who triggered the send — recorded only when a send is requested, so an
  // untracked/skipped payment doesn't falsely attribute a sender.
  let emailSentBy: string | null = null;
  let emailSentByEmail: string | null = null;

  if (wantEmail) {
    emailRequested = true;
    emailTo = recipient;
    emailSentBy = userId;
    emailSentByEmail = actorEmail;
    if (!recipient) {
      emailError = "No customer email on file";
    } else {
      // Prefer the linked order's number in the copy, matching the previous
      // auto-send behaviour ("your e-Transfer landed / order is processing").
      let orderNumber = invoice.invoice_number as string;
      if (invoice.order_id) {
        const { data: ord } = await supabase
          .from("orders")
          .select("order_number")
          .eq("id", invoice.order_id)
          .maybeSingle();
        if (ord?.order_number) orderNumber = ord.order_number;
      }
      const result = await sendPaymentReceivedSMTP({
        to: recipient,
        orderNumber,
        customerName: (invoice.customer_name as string) ?? undefined,
      }).catch((e: any) => ({ success: false as const, error: e?.message ?? "Send failed" }));
      if (result.success) {
        emailSentAt = new Date().toISOString();
      } else {
        emailError = result.error ?? "Send failed";
        console.error("payment-received email failed for invoice", invoiceId, emailError);
      }
    }
  }

  // Record the email outcome on the payment so Payment History can show whether
  // the customer was notified. Best-effort: never fail the recorded payment
  // over a bookkeeping update (e.g. columns missing on a pre-migration DB).
  const { data: updatedPayment, error: emailTrackErr } = await supabase
    .from("payments")
    .update({
      email_requested: emailRequested,
      email_sent_at: emailSentAt,
      email_error: emailError,
      email_to: emailTo,
      email_sent_by: emailSentBy,
      email_sent_by_email: emailSentByEmail,
    })
    .eq("id", payment.id)
    .select()
    .single();
  if (emailTrackErr) console.error("payment email-status update failed:", emailTrackErr);

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.payment",
    entity_type: "invoice",
    entity_id: invoiceId,
    payload: {
      amount,
      method,
      status_after: nextStatus,
      email_requested: emailRequested,
      email_sent: !!emailSentAt,
    },
  });

  return NextResponse.json(
    {
      payment: updatedPayment ?? payment,
      email: {
        requested: emailRequested,
        sent: !!emailSentAt,
        error: emailError,
        to: emailTo,
        by: emailSentByEmail,
      },
    },
    { status: 201 },
  );
}
