import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import {
  authorizeForCustomer,
  cleanField as clean,
} from "@/lib/admin/customer-client-access";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// GET /api/admin/customers/:id/clients — the customer's saved clients.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeForCustomer(supabase, request, id);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await supabase
    .from("customer_clients")
    .select("*")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}

// POST /api/admin/customers/:id/clients — create a client. `address` required.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeForCustomer(supabase, request, id);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const address = clean(body?.address);
  if (!address) {
    return NextResponse.json({ error: "Client address is required" }, { status: 400 });
  }

  const { data: client, error } = await supabase
    .from("customer_clients")
    .insert({
      customer_id: id,
      first_name: clean(body?.first_name),
      last_name: clean(body?.last_name),
      address,
      city: clean(body?.city),
      state: clean(body?.state),
      postal_code: clean(body?.postal_code),
      country: clean(body?.country) ?? "CA",
      phone: clean(body?.phone),
      email: clean(body?.email),
    })
    .select()
    .single();
  if (error || !client) {
    return NextResponse.json({ error: error?.message ?? "Could not create client" }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: "customer.client_create",
    entity_type: "customer",
    entity_id: id,
    payload: { client_id: client.id },
  });

  return NextResponse.json({ client }, { status: 201 });
}
