import type { SupabaseClient } from "@supabase/supabase-js";

export type CallerRole = "customer" | "affiliate" | "assistant" | "admin";

export interface InvoiceCaller {
  id: string;
  role: CallerRole;
}

/**
 * Resolve the calling user (and their role) from the request's Bearer token.
 * Shared by the invoice routes so affiliate scoping stays consistent.
 */
export async function getInvoiceCaller(
  supabase: SupabaseClient,
  request: Request,
): Promise<InvoiceCaller | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, role: (customer?.role || "customer") as CallerRole };
}

/** IDs of the customers bound to an affiliate (used to scope invoice queries). */
export async function affiliateCustomerIds(
  supabase: SupabaseClient,
  affiliateId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("affiliate_id", affiliateId);
  return (data ?? []).map((c: { id: string }) => c.id);
}

/**
 * The affiliate's own sales_persons record id, if any. Invoices an affiliate
 * creates are linked to them through this sales person (e.g. name-only
 * invoices that have no customer_id), so scoping has to account for it.
 */
export async function affiliateSalesPersonId(
  supabase: SupabaseClient,
  affiliateId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("sales_persons")
    .select("id")
    .eq("user_id", affiliateId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * When an invoice ties a customer to a sales person, make that customer show up
 * as the sales person's customer — i.e. bind them to the affiliate behind that
 * sales person (customers.affiliate_id + default_sales_person_id), so they
 * appear in that affiliate's dashboard count and customer list.
 *
 * Best-effort and conservative: only binds when the sales person maps to an
 * affiliate account and the customer isn't already bound to an affiliate (never
 * reassigns another affiliate's customer), and never binds the affiliate to
 * themselves.
 */
export async function bindCustomerToSalesPersonAffiliate(
  supabase: SupabaseClient,
  customerId: string | null | undefined,
  salesPersonId: string | null | undefined,
): Promise<void> {
  if (!customerId || !salesPersonId) return;
  try {
    const { data: sp } = await supabase
      .from("sales_persons")
      .select("user_id")
      .eq("id", salesPersonId)
      .maybeSingle();
    const affiliateUserId: string | null = sp?.user_id ?? null;
    if (!affiliateUserId || affiliateUserId === customerId) return;

    // Only affiliates have a client portal to surface the customer on.
    const { data: aff } = await supabase
      .from("customers")
      .select("role")
      .eq("id", affiliateUserId)
      .maybeSingle();
    if (aff?.role !== "affiliate") return;

    const { data: cust } = await supabase
      .from("customers")
      .select("affiliate_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust || cust.affiliate_id) return; // missing, or already bound elsewhere

    await supabase
      .from("customers")
      .update({ affiliate_id: affiliateUserId, default_sales_person_id: salesPersonId })
      .eq("id", customerId);

    // Keep the customer's sales-team roster in step with the default we just
    // set — but only when they have no team yet. An admin-curated team (and its
    // rates) is never rewritten by a binding side-effect.
    const { data: existingTeam } = await supabase
      .from("customer_sales_persons")
      .select("id")
      .eq("customer_id", customerId)
      .limit(1);
    if ((existingTeam ?? []).length === 0) {
      const { data: rate } = await supabase
        .from("sales_persons")
        .select("commission_rate")
        .eq("id", salesPersonId)
        .maybeSingle();
      await supabase.from("customer_sales_persons").insert({
        customer_id: customerId,
        sales_person_id: salesPersonId,
        commission_rate: Number(rate?.commission_rate) || 0,
        position: 0,
      });
    }
  } catch (e) {
    console.error("bindCustomerToSalesPersonAffiliate failed:", e);
  }
}

/**
 * Whether an affiliate may access a specific invoice — true when the invoice
 * is linked to a customer bound to that affiliate, or when the affiliate is
 * credited on it as a sales person (covers invoices created with just a
 * customer name and no customer_id, and invoices they merely co-sold).
 */
export async function affiliateCanAccessInvoice(
  supabase: SupabaseClient,
  affiliateId: string,
  invoiceId: string,
): Promise<boolean> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("customer_id, sales_person_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return false;

  const spId = await affiliateSalesPersonId(supabase, affiliateId);
  if (spId) {
    if (inv.sales_person_id === spId) return true;
    // Credited on the roster without being the primary.
    const { data: seat } = await supabase
      .from("invoice_sales_persons")
      .select("id")
      .eq("invoice_id", invoiceId)
      .eq("sales_person_id", spId)
      .maybeSingle();
    if (seat) return true;
  }

  if (inv.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("affiliate_id")
      .eq("id", inv.customer_id)
      .maybeSingle();
    if (cust && cust.affiliate_id === affiliateId) return true;
  }

  return false;
}
