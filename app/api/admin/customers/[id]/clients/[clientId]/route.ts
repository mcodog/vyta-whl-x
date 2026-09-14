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

// Fields an editor may change on a saved client. Anything else in the body
// (id, customer_id, timestamps) is ignored so a client can't be re-parented.
const EDITABLE = [
  "first_name",
  "last_name",
  "address",
  "city",
  "state",
  "postal_code",
  "country",
  "phone",
  "email",
] as const;

/** Invoice numbers listed back to the user when a client can't be deleted. */
const USAGE_SAMPLE = 5;

/**
 * The invoices that still ship to this client — the guard against deleting one.
 * `count` is the true total; `invoices` only a sample to show the user.
 *
 * Shared by GET (which warns before the user commits) and DELETE (which
 * enforces it), so the warning and the refusal can never disagree.
 */
async function clientInvoiceUsage(clientId: string) {
  const { data, count, error } = await supabase
    .from("invoices")
    .select("id, invoice_number", { count: "exact" })
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(USAGE_SAMPLE);
  return { invoices: data ?? [], count: count ?? (data?.length ?? 0), error };
}

// GET /api/admin/customers/:id/clients/:clientId — a saved client plus how many
// invoices ship to them.
//
// The invoice form calls this when its delete confirmation opens, so a client
// that can't be removed says so up front (with the invoices to fix) instead of
// failing once the user has already committed to deleting.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; clientId: string }> },
) {
  const { id, clientId } = await ctx.params;
  const auth = await authorizeForCustomer(supabase, request, id);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: client } = await supabase
    .from("customer_clients")
    .select("*")
    .eq("id", clientId)
    .eq("customer_id", id)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found for this customer" }, { status: 404 });
  }

  const usage = await clientInvoiceUsage(clientId);
  if (usage.error) {
    return NextResponse.json({ error: usage.error.message }, { status: 500 });
  }

  return NextResponse.json({
    client,
    usage: { count: usage.count, invoices: usage.invoices },
  });
}

// PATCH /api/admin/customers/:id/clients/:clientId — edit a saved client.
//
// Only the keys present in the body are touched, so a partial edit never wipes
// fields the caller didn't send. `address` is the one required column: it may be
// updated but not blanked.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; clientId: string }> },
) {
  const { id, clientId } = await ctx.params;
  const auth = await authorizeForCustomer(supabase, request, id);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // The client must belong to this customer — scoping the lookup by customer_id
  // stops an authorized caller from editing another customer's client by id.
  const { data: existing } = await supabase
    .from("customer_clients")
    .select("id")
    .eq("id", clientId)
    .eq("customer_id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Client not found for this customer" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, string | null> = {};
  for (const key of EDITABLE) {
    if (!(key in (body ?? {}))) continue;
    patch[key] = clean(body[key]);
  }

  if ("address" in patch && !patch.address) {
    return NextResponse.json({ error: "Client address is required" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // The table has no updated_at trigger, so stamp it here.
  const { data: client, error } = await supabase
    .from("customer_clients")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("customer_id", id)
    .select()
    .single();
  if (error || !client) {
    return NextResponse.json({ error: error?.message ?? "Could not update client" }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: "customer.client_update",
    entity_type: "customer",
    entity_id: id,
    payload: { client_id: clientId, fields: Object.keys(patch) },
  });

  return NextResponse.json({ client });
}

// DELETE /api/admin/customers/:id/clients/:clientId — drop a saved client from
// the customer's address book.
//
// Refused while any invoice still ships to this client. The invoice reads the
// recipient live through its client_id FK (ON DELETE SET NULL), so deleting a
// client in use would blank the ship-to on those invoices — losing where a
// pending parcel goes and who the packing list was addressed to.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; clientId: string }> },
) {
  const { id, clientId } = await ctx.params;
  const auth = await authorizeForCustomer(supabase, request, id);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Scope the lookup by customer_id so an authorized caller can't delete
  // another customer's client by id.
  const { data: existing } = await supabase
    .from("customer_clients")
    .select("id")
    .eq("id", clientId)
    .eq("customer_id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Client not found for this customer" }, { status: 404 });
  }

  // Re-checked here even though the form warns first: the two calls are
  // seconds apart and an invoice can start shipping to this client in between.
  const usage = await clientInvoiceUsage(clientId);
  if (usage.error) {
    return NextResponse.json({ error: usage.error.message }, { status: 500 });
  }
  if (usage.count > 0) {
    const shown = usage.invoices
      .slice(0, 3)
      .map((i: { invoice_number: string }) => i.invoice_number);
    const rest = usage.count - shown.length;
    const suffix = rest > 0 ? ` and ${rest} more` : "";
    return NextResponse.json(
      {
        error:
          `${usage.count} invoice${usage.count === 1 ? "" : "s"} ship to this client ` +
          `(${shown.join(", ")}${suffix}). Point those invoices elsewhere before deleting.`,
        usage: { count: usage.count, invoices: usage.invoices },
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("customer_clients")
    .delete()
    .eq("id", clientId)
    .eq("customer_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: "customer.client_delete",
    entity_type: "customer",
    entity_id: id,
    payload: { client_id: clientId },
  });

  return NextResponse.json({ ok: true });
}
