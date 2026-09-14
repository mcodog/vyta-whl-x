import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveStatus } from "@/lib/admin/invoice-status";
import type { InvoiceStatus } from "@/lib/supabase";
import type {
  DeletionKind,
  DeletionPlan,
  DeletionReview,
  ReviewInvoice,
  ReviewClient,
  ReviewCommission,
} from "@/lib/admin/deletion";

// Server-side engine for the pre-delete "review & decide" flow. Runs with a
// service-role client (bypasses RLS). Two entry points:
//   * gatherReview  — collect everything a person owns into one normalized shape
//   * executeDeletion — apply the admin's plan, then remove the person
//
// Ordering matters: any "reassign" re-points rows onto a guest placeholder
// BEFORE the person row is deleted, so the existing SET NULL / CASCADE foreign
// keys (and the trg_mark_invoices_customer_deleted trigger) only touch whatever
// the admin chose to leave detached.

const emptyMoney = () => ({ CAD: 0, USD: 0 });

function fullName(row: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
}

function mapInvoice(inv: any): ReviewInvoice {
  const paidRaw = (inv.payments ?? []).reduce(
    (s: number, p: { amount: number | null }) => s + (Number(p?.amount) || 0),
    0,
  );
  const total = Number(inv.total) || 0;
  const amountPaid = Math.min(paidRaw, total);
  return {
    id: inv.id,
    invoice_number: inv.invoice_number ?? null,
    status: inv.status,
    status_effective: effectiveStatus(inv.status as InvoiceStatus, inv.due_date),
    currency: inv.currency === "USD" ? "USD" : "CAD",
    total,
    amount_paid: amountPaid,
    amount_due: Math.max(0, total - amountPaid),
    issue_date: inv.issue_date ?? null,
  };
}

async function hasAuthUser(
  supabase: SupabaseClient,
  id: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(id);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function gatherReview(
  supabase: SupabaseClient,
  kind: DeletionKind,
  id: string,
): Promise<DeletionReview | null> {
  if (kind === "sales_person") return gatherSalesPersonReview(supabase, id);
  if (kind === "affiliate") return gatherAffiliateReview(supabase, id);
  return gatherCustomerReview(supabase, kind, id);
}

async function gatherCustomerReview(
  supabase: SupabaseClient,
  kind: DeletionKind,
  id: string,
): Promise<DeletionReview | null> {
  const { data: customer } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email")
    .eq("id", id)
    .maybeSingle();
  if (!customer) return null;

  const [invRes, clientsRes, ordersRes, spRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, status, currency, total, issue_date, due_date, non_payable, payments(amount)",
      )
      .eq("customer_id", id)
      .order("issue_date", { ascending: false })
      .limit(500),
    supabase
      .from("customer_clients")
      .select("id, first_name, last_name, address, city")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("orders").select("id").eq("customer_id", id),
    // A user may also be a sales person (shared identity) — surface their
    // commission rows so the review count is honest.
    supabase.from("sales_persons").select("id").eq("user_id", id).maybeSingle(),
  ]);

  const invoices = (invRes.data ?? []).map(mapInvoice);
  const invoiced = emptyMoney();
  const outstanding = emptyMoney();
  let payments = 0;
  for (const inv of invoices) {
    const cur = inv.currency as "CAD" | "USD";
    if (inv.status !== "cancelled") {
      invoiced[cur] += inv.total;
      if (inv.status_effective !== "paid") outstanding[cur] += inv.amount_due;
    }
    if (inv.amount_paid > 0) payments += 1;
  }

  const clients: ReviewClient[] = (clientsRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: fullName(c) || "(unnamed client)",
    address: c.address ?? null,
    city: c.city ?? null,
  }));

  let commissionCount = 0;
  if (spRes.data?.id) {
    const { count } = await supabase
      .from("sales_commissions")
      .select("id", { count: "exact", head: true })
      .eq("sales_person_id", spRes.data.id);
    commissionCount = count ?? 0;
  }

  const name = fullName(customer) || "(no name)";
  const email = customer.email ?? null;
  return {
    kind,
    id,
    name,
    email,
    label: email ? `${name} <${email}>` : name,
    hasLogin: await hasAuthUser(supabase, id),
    isAffiliate: false,
    isSalesPerson: !!spRes.data?.id,
    counts: {
      invoices: invoices.length,
      orders: ordersRes.data?.length ?? 0,
      clients: clients.length,
      commissions: commissionCount,
      payments,
    },
    money: { invoiced, outstanding, paidCommissions: 0 },
    invoices,
    clients,
    commissions: [],
  };
}

async function gatherSalesPersonReview(
  supabase: SupabaseClient,
  id: string,
): Promise<DeletionReview | null> {
  const { data: sp } = await supabase
    .from("sales_persons")
    .select("id, first_name, last_name, email, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!sp) return null;

  // Invoices they are credited on. The primary column only names one person, so
  // the roster is consulted too — a co-sold invoice is just as affected by the
  // deletion (its roster row cascades away with them).
  const { data: seatRows } = await supabase
    .from("invoice_sales_persons")
    .select("invoice_id")
    .eq("sales_person_id", id)
    .limit(500);
  const coSoldIds = [...new Set(((seatRows as any[]) ?? []).map((r) => String(r.invoice_id)))];
  const invoiceFilter = coSoldIds.length > 0
    ? `sales_person_id.eq.${id},id.in.(${coSoldIds.join(",")})`
    : `sales_person_id.eq.${id}`;

  const [invRes, comRes, affRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, status, currency, total, issue_date, due_date, payments(amount)",
      )
      .or(invoiceFilter)
      .order("issue_date", { ascending: false })
      .limit(500),
    supabase
      .from("sales_commissions")
      .select("id, amount, invoice_total, status, invoices(invoice_number)")
      .eq("sales_person_id", id)
      .order("created_at", { ascending: false }),
    sp.user_id
      ? supabase.from("affiliates").select("id").eq("id", sp.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const invoices = (invRes.data ?? []).map(mapInvoice);
  const invoiced = emptyMoney();
  for (const inv of invoices) {
    if (inv.status !== "cancelled") invoiced[inv.currency as "CAD" | "USD"] += inv.total;
  }

  const commissions: ReviewCommission[] = (comRes.data ?? []).map((c: any) => ({
    id: c.id,
    amount: Number(c.amount) || 0,
    base: Number(c.invoice_total) || 0,
    status: c.status,
    reference: c.invoices?.invoice_number ?? null,
  }));
  const paidCommissions = commissions
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + c.amount, 0);

  const name = fullName(sp) || "(no name)";
  const email = sp.email ?? null;
  return {
    kind: "sales_person",
    id,
    name,
    email,
    label: email ? `${name} <${email}>` : name,
    hasLogin: !!sp.user_id,
    isAffiliate: !!(affRes as any).data?.id,
    isSalesPerson: true,
    counts: {
      invoices: invoices.length,
      orders: 0,
      clients: 0,
      commissions: commissions.length,
      payments: 0,
    },
    money: { invoiced, outstanding: emptyMoney(), paidCommissions },
    invoices,
    clients: [],
    commissions,
  };
}

// An affiliate shares one auth UUID across affiliates / customers / sales_persons
// (ADR 0003), so deleting one removes the whole person. The review reuses the
// customer-side data (their own invoices / orders / ship-to clients) and adds
// the affiliate-specific rows: referral commissions and their downline (referred
// customers, which are kept and simply unlinked). Works even for a legacy
// affiliate that has no bound customers row.
async function gatherAffiliateReview(
  supabase: SupabaseClient,
  id: string,
): Promise<DeletionReview | null> {
  const [{ data: aff }, { data: customer }, { data: sp }] = await Promise.all([
    supabase.from("affiliates").select("id, first_name, last_name, email").eq("id", id).maybeSingle(),
    supabase.from("customers").select("id, first_name, last_name, email").eq("id", id).maybeSingle(),
    supabase.from("sales_persons").select("id").eq("user_id", id).maybeSingle(),
  ]);
  if (!aff && !customer) return null;

  const [invRes, clientsRes, ordersRes, refComRes, downlineRes, salesComRes] =
    await Promise.all([
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, status, currency, total, issue_date, due_date, payments(amount)",
        )
        .eq("customer_id", id)
        .order("issue_date", { ascending: false })
        .limit(500),
      supabase
        .from("customer_clients")
        .select("id, first_name, last_name, address, city")
        .eq("customer_id", id),
      supabase.from("orders").select("id").eq("customer_id", id),
      supabase
        .from("commissions")
        .select("id, amount, order_total, status, order_id")
        .eq("affiliate_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("customers").select("id", { count: "exact", head: true }).eq("affiliate_id", id),
      sp?.id
        ? supabase
            .from("sales_commissions")
            .select("id, amount, invoice_total, status, invoices(invoice_number)")
            .eq("sales_person_id", sp.id)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const invoices = (invRes.data ?? []).map(mapInvoice);
  const invoiced = emptyMoney();
  const outstanding = emptyMoney();
  let payments = 0;
  for (const inv of invoices) {
    const cur = inv.currency as "CAD" | "USD";
    if (inv.status !== "cancelled") {
      invoiced[cur] += inv.total;
      if (inv.status_effective !== "paid") outstanding[cur] += inv.amount_due;
    }
    if (inv.amount_paid > 0) payments += 1;
  }

  const clients: ReviewClient[] = (clientsRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: fullName(c) || "(unnamed client)",
    address: c.address ?? null,
    city: c.city ?? null,
  }));

  // Referral commissions (as an affiliate) + sales commissions (as a rep) — both
  // are removed with the person, so both belong in the review/snapshot.
  const referralCommissions: ReviewCommission[] = (refComRes.data ?? []).map((c: any) => ({
    id: c.id,
    amount: Number(c.amount) || 0,
    base: Number(c.order_total) || 0,
    status: c.status,
    reference: c.order_id ? String(c.order_id).slice(0, 8) : null,
  }));
  const salesCommissions: ReviewCommission[] = ((salesComRes as any).data ?? []).map((c: any) => ({
    id: c.id,
    amount: Number(c.amount) || 0,
    base: Number(c.invoice_total) || 0,
    status: c.status,
    reference: c.invoices?.invoice_number ?? null,
  }));
  const commissions = [...referralCommissions, ...salesCommissions];

  const src = customer ?? aff!;
  const name = fullName(src) || "(no name)";
  const email = src.email ?? null;
  return {
    kind: "affiliate",
    id,
    name,
    email,
    label: email ? `${name} <${email}>` : name,
    hasLogin: true,
    isAffiliate: true,
    isSalesPerson: !!sp?.id,
    counts: {
      invoices: invoices.length,
      orders: ordersRes.data?.length ?? 0,
      clients: clients.length,
      commissions: commissions.length,
      payments,
    },
    money: { invoiced, outstanding, paidCommissions: 0 },
    invoices,
    clients,
    commissions,
    downline: downlineRes.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export interface ExecuteOutcome {
  snapshotId: string | null;
  guestId: string | null;
}

async function saveSnapshot(
  supabase: SupabaseClient,
  review: DeletionReview,
  plan: DeletionPlan,
  actorId: string | null,
  guestId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("entity_deletion_snapshots")
    .insert({
      entity_type: review.kind,
      entity_id: review.id,
      entity_label: review.label,
      snapshot: review,
      counts: review.counts,
      disposition: plan,
      guest_customer_id: guestId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("saveSnapshot failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Create the login-less placeholder that inherits kept invoices/clients. */
async function createGuestPlaceholder(
  supabase: SupabaseClient,
  review: DeletionReview,
  plan: DeletionPlan,
): Promise<string | null> {
  const displayName = (plan.guestName || review.name || "Deleted customer").trim();
  // Split a supplied override name into first/last; otherwise keep the original.
  let first = displayName;
  let last: string | null = null;
  if (plan.guestName) {
    const parts = displayName.split(/\s+/);
    first = parts.shift() || displayName;
    last = parts.length ? parts.join(" ") : null;
  } else {
    // Preserve the original split for a natural-looking record.
    const parts = (review.name || "").split(/\s+/);
    first = parts.shift() || review.name || "Deleted";
    last = parts.length ? parts.join(" ") : null;
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      first_name: first || "Deleted",
      last_name: last,
      // Synthetic, collision-free address — the placeholder never logs in.
      email: `deleted+${review.id}@aminocan.local`,
      role: "customer",
      active: false,
      is_deleted_placeholder: true,
      placeholder_source_name: review.label,
      placeholder_created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createGuestPlaceholder failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function executeDeletion(
  supabase: SupabaseClient,
  kind: DeletionKind,
  id: string,
  plan: DeletionPlan,
  actorId: string | null,
): Promise<ExecuteOutcome> {
  const review = await gatherReview(supabase, kind, id);
  if (!review) throw new Error("Record not found");

  if (kind === "sales_person") {
    const snapshotId = plan.snapshot
      ? await saveSnapshot(supabase, review, plan, actorId, null)
      : null;
    // Repped invoices detach via the existing ON DELETE SET NULL; commission
    // rows CASCADE-delete (already captured in the snapshot above).
    const { error } = await supabase.from("sales_persons").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { snapshotId, guestId: null };
  }

  // customer | user ---------------------------------------------------------
  // Only mint a placeholder when a "reassign" choice actually has rows to move,
  // so deleting an empty customer never leaves a stray guest record behind.
  const needGuest =
    (plan.invoices === "reassign" && review.counts.invoices > 0) ||
    (plan.orders === "reassign" && review.counts.orders > 0) ||
    (plan.clients === "reassign" && review.counts.clients > 0);

  const guestId = needGuest
    ? await createGuestPlaceholder(supabase, review, plan)
    : null;

  const snapshotId = plan.snapshot
    ? await saveSnapshot(supabase, review, plan, actorId, guestId)
    : null;

  // Re-point BEFORE deleting the original so SET NULL / CASCADE + the invoice
  // snapshot trigger only touch what is intentionally left behind.
  if (guestId) {
    if (plan.invoices === "reassign") {
      await supabase.from("invoices").update({ customer_id: guestId }).eq("customer_id", id);
    }
    if (plan.orders === "reassign") {
      await supabase.from("orders").update({ customer_id: guestId }).eq("customer_id", id);
    }
    if (plan.clients === "reassign") {
      await supabase.from("customer_clients").update({ customer_id: guestId }).eq("customer_id", id);
    }
  }

  // If this person is also an affiliate / sales person (shared identity), clear
  // those bound rows first so the customer delete doesn't orphan them. Mirrors
  // the users DELETE route so removal is consistent across pages.
  const { data: boundAffiliate } = await supabase
    .from("affiliates")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (boundAffiliate) {
    await supabase.from("commissions").delete().eq("affiliate_id", id);
    await supabase.from("referral_codes").delete().eq("affiliate_id", id);
    await supabase.from("affiliates").delete().eq("id", id);
  }
  await supabase.from("sales_persons").delete().eq("user_id", id);

  const { error: delErr } = await supabase.from("customers").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);

  // Best-effort auth cleanup (guests have no auth user).
  if (await hasAuthUser(supabase, id)) {
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) {
      console.error("executeDeletion: auth delete failed (row already gone):", authError.message);
    }
  }

  return { snapshotId, guestId };
}
