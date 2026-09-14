import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canDelete } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, userId: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  return {
    role: (customer?.role || "customer") as "customer" | "warehouse" | "assistant" | "admin",
    userId: user.id,
  };
}

// DELETE /api/admin/invoices/:id/payments/:paymentId — admin only.
//
// Reverses a recorded payment: removes the payment row, recomputes the
// invoice's status from what's left (paid → partial → sent), and — when the
// invoice drops out of "paid" — restores the stock that was decremented when it
// first went paid. The stock restore is guarded by the invoice's own
// `stock_adjusted` flag (via restore_stock_for_invoice), so it only ever gives
// back inventory the paid transition actually took, and never twice.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; paymentId: string }> },
) {
  const { role, userId } = await getAuth(request);
  if (!canDelete(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id: invoiceId, paymentId } = await ctx.params;

  // Load the invoice with all its payments so we can both validate the target
  // payment and recompute the status from the remaining ones.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, payments (id, amount, method)")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const payments = (invoice.payments ?? []) as Array<{ id: string; amount: number; method: string }>;
  const target = payments.find((p) => p.id === paymentId);
  if (!target) {
    return NextResponse.json({ error: "Payment not found on this invoice" }, { status: 404 });
  }

  // Remove the payment.
  const { error: delErr } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId)
    .eq("invoice_id", invoiceId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Recompute the paid total and derive the next status. Only invoices that are
  // in a payment-driven state (sent/partial/paid) are re-derived; draft and
  // cancelled are left untouched so reversing a stray payment can't silently
  // un-cancel or publish a draft.
  const total = Number(invoice.total);
  const newPaid = payments
    .filter((p) => p.id !== paymentId)
    .reduce((s, p) => s + Number(p.amount), 0);

  let nextStatus = invoice.status as string;
  if (invoice.status === "paid" || invoice.status === "partial" || invoice.status === "sent") {
    if (newPaid + 0.001 >= total) nextStatus = "paid";
    else if (newPaid > 0.001) nextStatus = "partial";
    else nextStatus = "sent";
  }
  if (nextStatus !== invoice.status) {
    await supabase.from("invoices").update({ status: nextStatus }).eq("id", invoiceId);
  }

  // Give back the stock the paid transition took, but only when the invoice is
  // no longer fully paid. restore_stock_for_invoice is a no-op unless
  // stock_adjusted = true, and it flips the flag, so a later re-payment will
  // re-decrement cleanly and stock can never be restored twice.
  let stockRestored = false;
  if (nextStatus !== "paid" && invoice.stock_adjusted === true) {
    const { error: restoreErr } = await supabase.rpc("restore_stock_for_invoice", {
      p_invoice_id: invoiceId,
    });
    if (restoreErr) {
      console.error("Stock restore failed for reversed invoice", invoiceId, restoreErr);
    } else {
      stockRestored = true;
    }
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.payment.reverse",
    entity_type: "invoice",
    entity_id: invoiceId,
    payload: {
      payment_id: paymentId,
      amount: Number(target.amount),
      method: target.method,
      status_after: nextStatus,
      stock_restored: stockRestored,
    },
  });

  return NextResponse.json({
    ok: true,
    reversed_payment: { id: target.id, amount: Number(target.amount), method: target.method },
    invoice: {
      id: invoiceId,
      status: nextStatus,
      total,
      amount_paid: newPaid,
      amount_due: Math.max(0, total - newPaid),
    },
    stock_restored: stockRestored,
  });
}
