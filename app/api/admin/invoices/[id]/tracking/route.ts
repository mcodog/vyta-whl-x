import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { affiliateCanAccessInvoice } from "@/lib/admin/invoice-access";
import { getEasyshipShipmentTracking } from "@/lib/shipping/easyship";

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
    role: (customer?.role || "customer") as "customer" | "affiliate" | "assistant" | "admin",
    userId: user.id,
  };
}

/**
 * GET /api/admin/invoices/:id/tracking
 *
 * Returns the tracking snapshot of the invoice's bound order. Pass `?refresh=1`
 * to pull a live update from Easyship first (when the order has a shipment);
 * live values are persisted back onto the order for admins (assistants are
 * read-only, so they still get the live read but nothing is written).
 *
 * Every response tells the caller whether an order even exists (`hasOrder`), so
 * the invoice page can fall back gracefully for legacy invoices with no order.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getAuth(request);
  if (role !== "admin" && role !== "assistant" && role !== "affiliate") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  if (role === "affiliate" && !(await affiliateCanAccessInvoice(supabase, userId!, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, order_id")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!invoice.order_id) {
    return NextResponse.json({ hasOrder: false, tracking: null });
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, tracking_number, tracking_status, tracking_url, carrier, easyship_shipment_id, label_state",
    )
    .eq("id", invoice.order_id)
    .maybeSingle();
  if (!order) {
    // The invoice points at an order that no longer exists — treat as no order.
    return NextResponse.json({ hasOrder: false, tracking: null });
  }

  let snapshot = {
    tracking_number: order.tracking_number ?? null,
    tracking_status: order.tracking_status ?? null,
    tracking_url: order.tracking_url ?? null,
    carrier: order.carrier ?? null,
    label_state: order.label_state ?? null,
  };
  let live = false;

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (refresh && order.easyship_shipment_id) {
    const info = await getEasyshipShipmentTracking(order.easyship_shipment_id);
    if (Object.keys(info).length > 0) {
      const merged = {
        tracking_number: info.trackingNumber ?? snapshot.tracking_number,
        tracking_status: info.trackingStatus ?? snapshot.tracking_status,
        tracking_url: info.trackingUrl ?? snapshot.tracking_url,
        carrier: info.carrier ?? snapshot.carrier,
        label_state: info.labelState ?? snapshot.label_state,
      };

      // Persist any changed fields (admins only — assistants/affiliates read).
      if (role === "admin") {
        const updates: Record<string, unknown> = {};
        if (info.trackingNumber && info.trackingNumber !== order.tracking_number) {
          updates.tracking_number = info.trackingNumber;
        }
        if (info.trackingStatus && info.trackingStatus !== order.tracking_status) {
          updates.tracking_status = info.trackingStatus;
        }
        if (info.trackingUrl && info.trackingUrl !== order.tracking_url) {
          updates.tracking_url = info.trackingUrl;
        }
        if (info.carrier && info.carrier !== order.carrier) {
          updates.carrier = info.carrier;
        }
        if (info.labelState && info.labelState !== order.label_state) {
          updates.label_state = info.labelState;
        }
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await supabase.from("orders").update(updates).eq("id", order.id);
        }
      }

      snapshot = merged;
      live = true;
    }
  }

  return NextResponse.json({
    hasOrder: true,
    order_id: order.id,
    order_number: order.order_number ?? null,
    order_status: order.status ?? null,
    hasShipment: Boolean(order.easyship_shipment_id),
    live,
    tracking: snapshot,
  });
}
