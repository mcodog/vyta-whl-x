import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { plainTextToHtml } from "@/lib/invoice-email-templates";

// Minimal {{var}} substitution (the invoice renderTemplate is typed to invoice
// merge vars, so we use our own for fulfillment vars like {{tracking_number}}).
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, k: string) => vars[k] ?? "");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Kind = "packed" | "shipped";

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: c } = await supabase
    .from("customers")
    .select("role, email, can_send_fulfillment_emails")
    .eq("id", user.id)
    .single();
  const role = c?.role || "customer";
  const canSend = role === "admin" || (role === "warehouse" && !!c?.can_send_fulfillment_emails);
  return { userId: user.id, role, email: c?.email ?? user.email ?? "", canSend };
}

// Default subject/body per fulfillment method + kind. Uses {{merge}} vars.
function defaultTemplate(kind: Kind, isPickup: boolean): { subject: string; body: string } {
  if (kind === "packed") {
    return isPickup
      ? {
          subject: "Your PuraMass order {{order_number}} is ready for pickup",
          body:
            "Hi {{customer_first_name}},\n\nGood news — your order {{order_number}} is packed and ready for collection. Come by at your convenience and quote your order number.\n\n— PuraMass",
        }
      : {
          subject: "Your PuraMass order {{order_number}} is packed",
          body:
            "Hi {{customer_first_name}},\n\nYour order {{order_number}} has been packed and is on its way out the door. We'll send tracking as soon as it ships.\n\n— PuraMass",
        };
  }
  // shipped
  return isPickup
    ? {
        subject: "Thanks for collecting your PuraMass order {{order_number}}",
        body:
          "Hi {{customer_first_name}},\n\nThis confirms your order {{order_number}} has been collected. Thanks for choosing PuraMass!\n\n— PuraMass",
      }
    : {
        subject: "Your PuraMass order {{order_number}} has shipped",
        body:
          "Hi {{customer_first_name}},\n\nYour order {{order_number}} is on its way via {{carrier}}.\n\nTracking number: {{tracking_number}}\n{{tracking_url}}\n\n— PuraMass",
      };
}

function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.protonmail.ch",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

function buildFrom() {
  const name = process.env.SMTP_FROM_NAME || "PuraMass";
  const addr = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "info@aminocan.com";
  return `${name} <${addr}>`;
}

// POST /api/warehouse/queue/:id/notify
// Send (or preview) the "packed/ready" or "shipped" customer notification.
// Admins always; warehouse staff only when granted can_send_fulfillment_emails.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!auth.canSend) {
    return NextResponse.json({ error: "You don't have permission to send emails" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const kind: Kind = body.kind === "shipped" ? "shipped" : "packed";
  const preview = body.preview === true;

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, order_id, customer_name, customer_email, fulfillment_type,
      customer:customers!customer_id (first_name, last_name, email),
      order:orders!order_id (order_number, tracking_number, carrier, tracking_url)
    `)
    .eq("id", id)
    .single();
  if (invErr || !inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const order: any = (inv as any).order ?? {};
  const cust: any = (inv as any).customer ?? {};
  const isPickup = inv.fulfillment_type === "pickup";

  const to: string = (body.to?.trim?.() || inv.customer_email || cust.email || "").trim();
  if (!to) {
    return NextResponse.json({ error: "No customer email. Provide a recipient." }, { status: 400 });
  }

  const firstName =
    (inv.customer_name ? inv.customer_name.split(" ")[0] : null) || cust.first_name || "there";
  const vars: Record<string, string> = {
    customer_first_name: firstName,
    order_number: order.order_number || inv.invoice_number,
    invoice_number: inv.invoice_number,
    tracking_number: order.tracking_number || "(will follow)",
    carrier: order.carrier || "courier",
    tracking_url: order.tracking_url || "",
  };

  const def = defaultTemplate(kind, isPickup);
  // Honour client overrides (from the editable preview); fall back to defaults.
  const subject = render(typeof body.subject === "string" && body.subject.trim() ? body.subject : def.subject, vars);
  const text = render(typeof body.body === "string" && body.body.trim() ? body.body : def.body, vars);

  if (preview) {
    // Hand back the rendered defaults (or echoed overrides) for the modal.
    return NextResponse.json({
      to,
      subject,
      body: text,
      default_subject: render(def.subject, vars),
      default_body: render(def.body, vars),
    });
  }

  // A "shipped" email for a courier shipment must carry a real tracking number
  // — otherwise the customer gets "tracking: (will follow)" that never follows.
  // Pickups don't ship, so they're exempt. Staff can force-send in the rare case
  // they'll supply tracking another way.
  if (kind === "shipped" && !isPickup && !order.tracking_number && body.allow_without_tracking !== true) {
    return NextResponse.json(
      {
        error:
          "No tracking number is available yet for this shipment. Wait for the courier label/tracking, or force-send without tracking.",
        code: "tracking_missing",
      },
      { status: 409 },
    );
  }

  let messageId: string | null = null;
  let success = false;
  let errorMessage: string | null = null;
  try {
    const info = await buildTransport().sendMail({
      from: buildFrom(),
      to,
      subject,
      text,
      html: plainTextToHtml(text),
    });
    messageId = info.messageId ?? null;
    success = true;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "Send failed";
    console.error("Fulfillment notification send failed:", e);
  }

  await supabase.from("fulfillment_email_log").insert({
    invoice_id: id,
    order_id: inv.order_id,
    kind,
    to_email: to,
    subject,
    message_id: messageId,
    success,
    error: errorMessage,
    sent_by: auth.userId,
    sent_by_email: auth.email,
  });

  if (!success) {
    return NextResponse.json({ error: errorMessage || "Send failed" }, { status: 500 });
  }

  await supabase
    .from("invoices")
    .update(kind === "packed"
      ? { packed_emailed_at: new Date().toISOString() }
      : { shipped_emailed_at: new Date().toISOString() })
    .eq("id", id);

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: "fulfillment.email_sent",
    entity_type: "invoice",
    entity_id: id,
    payload: { kind, to },
  });

  return NextResponse.json({ ok: true, to, kind, message_id: messageId });
}
