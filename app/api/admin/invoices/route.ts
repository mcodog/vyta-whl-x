import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate, canDelete } from "@/lib/permissions";
import { createShipmentForInvoiceOrder } from "@/lib/shipping/auto-shipment";
import { logAuditServer } from "@/lib/admin/audit";
import { effectiveStatus } from "@/lib/admin/invoice-status";
import { getInvoiceCaller, affiliateCustomerIds, affiliateSalesPersonId, bindCustomerToSalesPersonAffiliate } from "@/lib/admin/invoice-access";
import { computeStockSplit, type SplitLine } from "@/lib/admin/invoice-split";
import { enforceAffiliateLinePrices, clampDiscount } from "@/lib/admin/affiliate-pricing";
import { checkLowStockForProducts } from "@/lib/admin/low-stock";
import { buildClientShipAddress, type ClientRow } from "@/lib/admin/order-sync";
import { scoreMatch, searchTokens, ilikeOrGroups } from "@/lib/search";
import {
  assignmentsFromBody,
  coSoldInvoiceIds,
  loadInvoiceRosters,
  primaryInvoiceColumns,
  resolveAssignments,
  salesPersonLabel,
  syncInvoiceCommissions,
  writeInvoiceRoster,
  type SalesPersonAssignment,
} from "@/lib/admin/sales-attribution";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `AMC-${code}`;
}

async function verifyAdmin(request: NextRequest, requireMutation = false) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, role: "customer" as const, userId: null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, role: "customer" as const, userId: null };
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    // Affiliates may read and create invoices (server-scoped to their account).
    if (role === "affiliate") return { authorized: true, role, userId: user.id };
    if (requireMutation && !canCreate(role)) {
      return { authorized: false, role, userId: user.id };
    }
    if (!requireMutation && (role === "admin" || role === "assistant")) {
      return { authorized: true, role, userId: user.id };
    }
    return { authorized: role === "admin", role, userId: user.id };
  } catch {
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

// Resolve the invoice "scope" for an affiliate: invoices they are the sales
// person on, plus invoices for customers bound to them.
async function affiliateScope(userId: string) {
  const { data: custs } = await supabase
    .from("customers")
    .select("id")
    .eq("affiliate_id", userId);
  const customerIds = (custs ?? []).map((c) => c.id);
  const { data: sp } = await supabase
    .from("sales_persons")
    .select("id, commission_rate")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    customerIds,
    salesPersonId: sp?.id ?? null,
    commissionRate: sp?.commission_rate ?? null,
  };
}

// Order an already-filtered set of invoice matches by how well they match the
// query, so exact invoice numbers and name-prefix hits sort above incidental
// substring matches (e.g. a "d" buried in a customer email). The DB has already
// filtered to matches, so every row is kept — this only reorders them. `q` must
// be lowercased by the caller (scoreMatch expects a normalized query).
function rankInvoiceMatches(rows: any[], q: string): any[] {
  const score = (inv: any): number => {
    const fields: Array<[string | null | undefined, number]> = [
      [inv.invoice_number, 2],
      [inv.customer_name_display, 3],
      [inv.customer?.first_name, 2],
      [inv.customer?.last_name, 2],
      [inv.customer_email_display, 1],
    ];
    let best = 0;
    let total = 0;
    for (const [value, weight] of fields) {
      const s = scoreMatch(value, q) * weight;
      total += s;
      if (s > best) best = s;
    }
    return best * 2 + total;
  };
  return rows
    .map((inv, index) => ({ inv, index, score: score(inv) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.inv.created_at ?? 0).getTime() -
          new Date(a.inv.created_at ?? 0).getTime() ||
        a.index - b.index,
    )
    .map((x) => x.inv);
}

// GET /api/admin/invoices
// admin/assistant: all invoices. affiliate: invoices for their bound customers.
// Supports server-side search (q), status filter, and pagination (limit/offset).
// Also returns aggregate `stats` (over the status-scoped set, ignoring search
// and pagination) so the summary cards stay accurate while paginating.
export async function GET(request: NextRequest) {
  const caller = await getInvoiceCaller(supabase, request);
  if (!caller || caller.role === "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { authorized } = await verifyAdmin(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  await supabase.rpc("mark_overdue_invoices");

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const customerId = params.get("customer_id");
  const invoiceType = params.get("invoice_type");
  // "Source" filter: who entered the invoice. 'admin' covers admin + assistant
  // staff, 'client' an affiliate (client portal), 'online' a store checkout.
  const sourceParam = params.get("created_source");
  const source =
    sourceParam === "admin" || sourceParam === "client" || sourceParam === "online"
      ? sourceParam
      : null;
  // "Currency" filter: the money the invoice is denominated in (CAD / USD).
  const currencyParam = params.get("currency");
  const currency = currencyParam === "CAD" || currencyParam === "USD" ? currencyParam : null;
  const q = (params.get("q") ?? "").trim();
  const limitParam = params.get("limit");
  const offsetParam = params.get("offset");

  // Affiliate scoping: restrict to invoices for the customers bound to this
  // affiliate OR invoices where the affiliate is the sales person (covers
  // name-only invoices that have no customer_id).
  let affiliateScopeOr: string | null = null;
  // Captured for the stats RPC (which scopes via array/id params rather than the
  // PostgREST `.or()` string used for the row query).
  let affScopeCustIds: string[] | null = null;
  let affScopeSpId: string | null = null;
  if (caller.role === "affiliate") {
    const [scopedCustomerIds, salesPersonId] = await Promise.all([
      affiliateCustomerIds(supabase, caller.id),
      affiliateSalesPersonId(supabase, caller.id),
    ]);
    affScopeCustIds = scopedCustomerIds;
    affScopeSpId = salesPersonId;
    const terms: string[] = [];
    if (scopedCustomerIds.length > 0) {
      terms.push(`customer_id.in.(${scopedCustomerIds.join(",")})`);
    }
    if (salesPersonId) {
      terms.push(`sales_person_id.eq.${salesPersonId}`);
      // A co-seller is credited on the invoice roster but is not the primary,
      // so the column filter above can't see those rows — pull their ids in.
      const coSold = await coSoldInvoiceIds(supabase, salesPersonId);
      if (coSold.length > 0) terms.push(`id.in.(${coSold.join(",")})`);
    }
    if (terms.length === 0) {
      return NextResponse.json({
        invoices: [],
        total: 0,
        stats: { count: 0, outstanding: 0, overdueCount: 0, paid: 0 },
      });
    }
    affiliateScopeOr = terms.join(",");
  }

  // Resolve customers matching the search term so we can match invoices linked
  // to a customer record (whose name isn't denormalised onto the invoice).
  //
  // Tokenise the query (per-word AND-of-ORs across the name/email columns) so a
  // multi-word "First Last" search — e.g. the full name that lands in the box
  // after picking a customer from the autocomplete — resolves the customer whose
  // name is split across first_name/last_name. A single whole-phrase ILIKE never
  // matches such a row, which is why selecting a customer previously returned no
  // invoices while a one-word search did. Mirrors the autocomplete's own lookup.
  const searchToks = searchTokens(q);
  let searchCustomerIds: string[] = [];
  if (searchToks.length > 0) {
    let custQuery = supabase.from("customers").select("id");
    for (const group of ilikeOrGroups(searchToks, ["first_name", "last_name", "email"])) {
      custQuery = custQuery.or(group);
    }
    const { data: matched } = await custQuery;
    searchCustomerIds = (matched ?? []).map((c: { id: string }) => c.id);
  }

  // Shared filters applied to both the page query and the stats query.
  const applyFilters = (query: any) => {
    // "outstanding" is a virtual status covering everything that still owes
    // money — sent/partial/overdue (mark_overdue_invoices ran above, so past-due
    // sent/partial rows already carry status='overdue'). Draft/paid/cancelled
    // are excluded, matching the "Outstanding $" stat's own definition.
    if (status === "outstanding") {
      query = query.in("status", ["sent", "partial", "overdue"]);
    } else if (status && status !== "all") {
      query = query.eq("status", status);
    }
    if (customerId) query = query.eq("customer_id", customerId);
    if (invoiceType === "standard" || invoiceType === "prepaid") {
      query = query.eq("invoice_type", invoiceType);
    }
    // Source: collapse admin+assistant into the "admin" bucket; affiliate is
    // "client"; system is "online". Legacy rows (created_by_role NULL) match no
    // source, so they only appear under "All".
    if (source === "admin") {
      query = query.in("created_by_role", ["admin", "assistant"]);
    } else if (source === "client") {
      query = query.eq("created_by_role", "affiliate");
    } else if (source === "online") {
      query = query.eq("created_by_role", "system");
    }
    // Currency: CAD/USD are stored verbatim (column is NOT NULL DEFAULT 'CAD').
    if (currency) query = query.eq("currency", currency);
    if (affiliateScopeOr) query = query.or(affiliateScopeOr);
    return query;
  };
  const applySearch = (query: any) => {
    const terms: string[] = [];
    if (searchToks.length > 0) {
      // Match the denormalised invoice fields on the whole phrase (invoice
      // numbers and guest names that live only on the invoice). Rebuild the
      // phrase from the sanitized tokens so a stray comma/paren can't split the
      // `.or()` term list.
      const like = `%${searchToks.join(" ")}%`;
      terms.push(
        `invoice_number.ilike.${like}`,
        `customer_name.ilike.${like}`,
        `customer_email.ilike.${like}`,
      );
    }
    // Invoices linked to a matched customer record (name lives on the customer,
    // not the invoice). ORed with the denormalised matches above.
    if (searchCustomerIds.length > 0) {
      terms.push(`customer_id.in.(${searchCustomerIds.join(",")})`);
    }
    if (terms.length === 0) return query;
    return query.or(terms.join(","));
  };

  // ---- page of rows -------------------------------------------------------
  let pageQuery = applySearch(
    applyFilters(
      supabase
        .from("invoices")
        .select(
          `
          *,
          customer:customers!customer_id (id, first_name, last_name, email, phone),
          creator:customers!created_by (id, first_name, last_name, email),
          client:customer_clients!client_id (id, first_name, last_name, address, city, state, postal_code, country, phone, email),
          sales_person:sales_persons (id, first_name, last_name),
          order:orders!order_id (id, order_number, easyship_shipment_id, label_state, tracking_number, fulfillment_type, notes),
          line_items:invoice_line_items ( id ),
          payments ( amount )
        `,
          { count: "exact" },
        )
        // The list is rendered with per-day dividers grouped by issue_date, so
        // order by issue_date first (newest day first) to keep each day's
        // invoices contiguous. created_at then id break ties deterministically
        // so a row can't drift between pages when issue_dates collide.
        .order("issue_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ),
  );

  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 100) : null;
  const offset = Math.max(parseInt(offsetParam ?? "0", 10) || 0, 0);
  // When searching we rank the full match set by relevance in memory and
  // paginate that, so the best matches land on page 1. Without a query the rows
  // are already in the desired (newest-first) order, so we paginate at the DB.
  if (limit !== null && !q) {
    pageQuery = pageQuery.range(offset, offset + limit - 1);
  }

  const { data, error, count } = await pageQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rosters come from their own failure-tolerant query, never a PostgREST
  // embed — see loadInvoiceRosters. A pre-migration database simply returns
  // nothing here and every row falls back to its primary sales person.
  const rosters = await loadInvoiceRosters(
    supabase,
    (data ?? []).map((row: any) => String(row.id)),
  );

  const invoices = (data ?? []).map((row: any) => {
    const amount_paid = (row.payments ?? []).reduce(
      (s: number, p: any) => s + Number(p.amount),
      0,
    );
    const status_effective = effectiveStatus(row.status, row.due_date);
    const customerName =
      row.customer_name ??
      (row.customer
        ? [row.customer.first_name, row.customer.last_name].filter(Boolean).join(" ")
        : null);
    // Flatten the linked order's shipping fields so the invoices list can drive
    // the same shipment/label tooling the orders page had (each invoice is bound
    // 1:1 to an order). Null when the order was deleted underneath the invoice.
    const order_shipment = row.order
      ? {
          order_id: row.order.id,
          order_number: row.order.order_number ?? null,
          easyship_shipment_id: row.order.easyship_shipment_id ?? null,
          label_state: row.order.label_state ?? null,
          tracking_number: row.order.tracking_number ?? null,
          fulfillment_type: row.order.fulfillment_type ?? null,
          notes: row.order.notes ?? null,
        }
      : null;
    // Display name of whoever entered the invoice (for the Source tag tooltip).
    // System/checkout invoices have no creator record.
    const createdByName = row.creator
      ? [row.creator.first_name, row.creator.last_name].filter(Boolean).join(" ") ||
        row.creator.email ||
        null
      : null;
    // Drop the raw joined creator record from the payload; only the resolved
    // name is surfaced.
    const { creator: _creator, ...rest } = row;
    const salesTeam = rosters.get(String(row.id)) ?? [];
    return {
      ...rest,
      amount_paid,
      amount_due: Math.max(0, Number(row.total) - amount_paid),
      status_effective,
      customer_name_display: customerName,
      customer_email_display: row.customer_email ?? row.customer?.email ?? null,
      // The primary's name, unchanged — the column every existing surface reads.
      sales_person_name: row.sales_person
        ? `${row.sales_person.first_name} ${row.sales_person.last_name}`
        : null,
      // The whole credited team, primary first, for the surfaces that show it.
      sales_people: salesTeam,
      sales_person_names: salesTeam.map((t) => salesPersonLabel(t.sales_person)),
      created_by_name: createdByName,
      order_shipment,
    };
  });

  // ---- aggregate stats (status + scope, independent of search/pagination) -
  // Computed in SQL via get_invoice_stats so it stays accurate over the full
  // set (no 1000-row cap) without pulling every invoice + payment into memory.
  // Falls back to the in-memory reduce if the RPC isn't available yet.
  const computeStatsInMemory = async () => {
    const { data: statRows } = await applyFilters(
      supabase.from("invoices").select("status, total, due_date, payments ( amount )"),
    );
    return (statRows ?? []).reduce(
      (acc: { count: number; outstanding: number; overdueCount: number; paid: number }, row: any) => {
        const paid = (row.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        const due = Math.max(0, Number(row.total) - paid);
        const eff = effectiveStatus(row.status, row.due_date);
        acc.count += 1;
        // Outstanding = money actually owed to us. A `pending_payment` invoice
        // is a hosted checkout the customer never completed, not a receivable,
        // so an abandoned cart must not inflate the figure.
        if (
          row.status !== "paid" &&
          row.status !== "draft" &&
          row.status !== "pending_payment" &&
          row.status !== "cancelled"
        )
          acc.outstanding += due;
        if (eff === "overdue") acc.overdueCount += 1;
        if (row.status === "paid") acc.paid += 1;
        return acc;
      },
      { count: 0, outstanding: 0, overdueCount: 0, paid: 0 },
    );
  };

  let stats = { count: 0, outstanding: 0, overdueCount: 0, paid: 0 };
  try {
    const statsArgs: Record<string, any> = {
      p_status: status && status !== "all" ? status : null,
      p_customer_id: customerId || null,
      p_invoice_type: invoiceType === "standard" || invoiceType === "prepaid" ? invoiceType : null,
      // For an affiliate, pass a (possibly empty) array so scoping applies; NULL
      // on both scope params means unscoped (admin/assistant). The RPC matches
      // on the invoice's primary sales person only, so an affiliate who merely
      // CO-sold an invoice sees it in the list (the row query widens to the
      // roster) without it moving these summary cards.
      p_affiliate_customer_ids: caller.role === "affiliate" ? affScopeCustIds ?? [] : null,
      p_affiliate_sales_person_id: caller.role === "affiliate" ? affScopeSpId : null,
      // Source filter (admin/client/online). NULL when unfiltered. On a
      // pre-migration DB the RPC lacks this arg and errors → the catch below
      // recomputes in memory via applyFilters (which also honours source).
      p_created_source: source,
    };
    // Currency filter. Only sent when active so the common (unfiltered) path
    // keeps calling the get_invoice_stats signature that predates this param;
    // when set on a DB missing p_currency the RPC errors → the catch below
    // recomputes in memory via applyFilters (which also honours currency).
    if (currency) statsArgs.p_currency = currency;
    const { data: statData, error: statErr } = await supabase.rpc("get_invoice_stats", statsArgs);
    if (statErr) throw statErr;
    const row: any = Array.isArray(statData) ? statData[0] : statData;
    stats = {
      count: Number(row?.count) || 0,
      outstanding: Number(row?.outstanding) || 0,
      overdueCount: Number(row?.overdue_count) || 0,
      paid: Number(row?.paid) || 0,
    };
    // A pre-migration get_invoice_stats doesn't recognise the virtual
    // "outstanding" status and returns zeros without erroring. Detect that
    // (page query found rows via applyFilters, RPC reported none) and recompute
    // in memory so the summary cards aren't blank until the migration is run.
    if (status === "outstanding" && stats.count === 0 && (count ?? 0) > 0) {
      stats = await computeStatsInMemory();
    }
  } catch (e) {
    console.error("get_invoice_stats RPC failed, aggregating in memory:", e);
    stats = await computeStatsInMemory();
  }

  // For a search, `invoices` holds every match (no DB range was applied): rank
  // by relevance, then slice out the requested page. `total` stays the full
  // match count so pagination controls stay correct.
  const total = count ?? invoices.length;
  const pageInvoices =
    q.length > 0
      ? (() => {
          const ranked = rankInvoiceMatches(invoices, q.toLowerCase());
          return limit !== null ? ranked.slice(offset, offset + limit) : ranked;
        })()
      : invoices;

  return NextResponse.json({ invoices: pageInvoices, total, stats });
}

// DELETE /api/admin/invoices — admin-only bulk delete.
// Body: { ids: string[] }.
//
// Invoices and orders are a 1:1 pair (invoices.order_id → orders.id), so
// deleting an invoice also deletes its linked order. Invoice children (line
// items, payments, backorders) cascade off the invoice; order children
// (order_items, shipment logs) cascade off the order. Crypto payment addresses
// (sol_addresses.order_id) have a RESTRICT FK, so we release them first.
export async function DELETE(request: NextRequest) {
  const { role, userId } = await verifyAdmin(request);
  if (!canDelete(role as any)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No invoice ids provided" }, { status: 400 });
  }

  // Capture the linked orders before removing the invoices (deleting the
  // invoice doesn't touch the order — we delete the order explicitly).
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, order_id")
    .in("id", ids);
  const orderIds = [
    ...new Set(
      (invs ?? [])
        .map((i: { order_id: string | null }) => i.order_id)
        .filter((x): x is string => !!x),
    ),
  ];

  const { error: invErr } = await supabase.from("invoices").delete().in("id", ids);
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  if (orderIds.length > 0) {
    await supabase.from("sol_addresses").update({ order_id: null }).in("order_id", orderIds);
    const { error: ordErr } = await supabase.from("orders").delete().in("id", orderIds);
    if (ordErr) console.error("DELETE /invoices: order cleanup failed:", ordErr);
  }

  for (const id of ids) {
    await logAuditServer(supabase, {
      actor_id: userId,
      action: "invoice.delete",
      entity_type: "invoice",
      entity_id: id,
    });
  }

  return NextResponse.json({ ok: true, deleted: ids.length, ordersDeleted: orderIds.length });
}

/**
 * Whether a write failed only because `invoices.charge_shipping_on_checkout`
 * doesn't exist yet — PostgREST reports an unknown column either from Postgres
 * (42703) or from its own schema cache (PGRST204).
 */
function isMissingCheckoutShippingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    err.code === "PGRST204" ||
    /charge_shipping_on_checkout/i.test(err.message ?? "")
  );
}

// POST /api/admin/invoices — admin only (consistent with PATCH/DELETE)
export async function POST(request: NextRequest) {
  const { authorized, role, userId } = await verifyAdmin(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      customer_id = null,
      customer_name = null,
      customer_email = null,
      customer_phone = null,
      order_id = null,
      issue_date,
      due_date,
      tax_rate = 0,
      shipping_cost = 0,
      processing_fee = 0,
      show_processing_fee = true,
      status = "draft",
      invoice_type = "standard",
      currency = "CAD",
      with_labels = true,
      fulfillment_type = "shipment",
      shipping_address = null,
      notes = null,
      // Attribution comes from `sales_people` (up to five, each with their own
      // rate). The legacy `sales_person_id` / `sales_person_commission_rate`
      // pair is still honoured as a one-person roster — see assignmentsFromBody.
      line_items = [],
      // Optional Easyship opt-in from the invoice form: create a shipment record
      // for the order this invoice spawns, locked to a chosen courier, and
      // optionally buy/print the label too.
      create_easyship_shipment = false,
      easyship_courier_id = null,
      easyship_buy_label = false,
      easyship_insured = false,
      easyship_handover = null,
      // Client-shipment opt-in: items ship to the customer's client (see the
      // Packing List flow). `client` is a new client to create; `client_id` an
      // existing one. Requires a linked customer + shipment fulfillment.
      ships_to_client = false,
      client_id = null,
      client = null,
      // Admin override: skip the stock-shortfall split and put every quantity on
      // a single invoice, creating no backorder even when stock is insufficient.
      override_backorder = false,
      // Whether this invoice's hosted-checkout payment link charges shipping.
      // Off by default: the link then sends `shipping_total_cents: 0`, because
      // shipping is usually settled outside it and charging it there again
      // billed the customer twice.
      charge_shipping_on_checkout = false,
    } = body ?? {};

    const fulfillmentType = fulfillment_type === "pickup" ? "pickup" : "shipment";
    // Only a shipment (never a pickup) can spawn an Easyship record.
    const easyshipRequested = create_easyship_shipment === true && fulfillmentType === "shipment";
    const easyshipCourierId =
      typeof easyship_courier_id === "string" && easyship_courier_id.trim()
        ? easyship_courier_id.trim()
        : null;
    const easyshipBuyLabel = easyship_buy_label === true;
    const easyshipInsured = easyship_insured === true;
    const easyshipHandover =
      easyship_handover === "pickup" || easyship_handover === "dropoff"
        ? easyship_handover
        : null;
    // Normalise the two invoice markings: currency is CAD/USD (amounts aren't
    // converted), with_labels is a plain boolean.
    const invoiceCurrency = currency === "USD" ? "USD" : "CAD";
    const invoiceType = invoice_type === "prepaid" ? "prepaid" : "standard";
    const withLabels = with_labels !== false;
    // Shipment invoices may carry a destination address captured on the form;
    // it seeds the order so a shipping label can be created later.
    const shipAddr =
      fulfillmentType === "shipment" && shipping_address && typeof shipping_address === "object"
        ? shipping_address
        : null;

    // Resolve the client (end-recipient) for a client shipment. Requires a
    // linked customer + a shipment. A new `client` (with address) is created;
    // otherwise `client_id` selects an existing one. On success we hold the
    // resolved id + full record (to seed the order's ship-to below).
    const shipsToClient = ships_to_client === true && fulfillmentType === "shipment" && !!customer_id;
    let resolvedClientId: string | null = null;
    let resolvedClient: ClientRow | null = null;
    if (shipsToClient) {
      if (client && typeof client === "object" && String(client.address ?? "").trim()) {
        const { data: created, error: clientErr } = await supabase
          .from("customer_clients")
          .insert({
            customer_id,
            first_name: client.first_name ?? null,
            last_name: client.last_name ?? null,
            address: String(client.address).trim(),
            city: client.city ?? null,
            state: client.state ?? null,
            postal_code: client.postal_code ?? null,
            country: client.country ?? "CA",
            phone: client.phone ?? null,
            email: client.email ?? null,
          })
          .select()
          .single();
        if (clientErr || !created) {
          return NextResponse.json(
            { error: clientErr?.message ?? "Could not create client" },
            { status: 500 },
          );
        }
        resolvedClientId = created.id;
        resolvedClient = created as ClientRow;
      } else if (typeof client_id === "string" && client_id) {
        const { data: existing } = await supabase
          .from("customer_clients")
          .select("*")
          .eq("id", client_id)
          .eq("customer_id", customer_id)
          .maybeSingle();
        if (existing) {
          resolvedClientId = existing.id;
          resolvedClient = existing as ClientRow;
        }
      }
    }

    // Who earns on this invoice: the roster the body asked for, capped at five
    // and de-duplicated. Affiliates are locked to themselves alone — they never
    // set their own rate or credit anybody else — so their roster is replaced
    // with the single entry taken from their own record.
    let assignments: SalesPersonAssignment[] = assignmentsFromBody(body ?? {}) ?? [];
    if (role === "affiliate" && userId) {
      const { customerIds, salesPersonId, commissionRate } = await affiliateScope(userId);
      if (customer_id && !customerIds.includes(customer_id)) {
        return NextResponse.json({ error: "Customer not in your account" }, { status: 403 });
      }
      assignments = salesPersonId
        ? [
            {
              sales_person_id: salesPersonId,
              commission_rate: commissionRate != null ? Number(commissionRate) : 0,
            },
          ]
        : [];
    }
    // The primary drives the customer <-> affiliate binding, exactly as the
    // single sales person did before.
    const effectiveSalesPersonId = assignments[0]?.sales_person_id ?? null;

    if (!Array.isArray(line_items) || line_items.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    const cleaned: SplitLine[] = line_items.map((li: any) => {
      const qty = Number(li.qty);
      const unit = Number(li.unit_price);
      // Clamp to 0–100% so a negative discount can't inflate the line total.
      const disc = clampDiscount(li.discount_pct);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid line qty");
      if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid line unit_price");
      return {
        product_id: li.product_id ?? null,
        description: String(li.description ?? "").trim() || "Item",
        qty,
        unit_price: unit,
        discount_pct: disc,
        line_total: Number((qty * unit * (1 - disc / 100)).toFixed(2)),
        price_type: li.price_type === "vial" ? "vial" : "box",
        preferred_supplier_id: li.preferred_supplier_id ?? null,
      };
    });

    // Affiliates never set their own prices: re-derive every line from the price
    // list assigned to them (admin/pricing) and drop any discount, ignoring the
    // unit_price/discount_pct the client sent. The invoice-form UI already locks
    // these fields for them; this closes the API bypass.
    const pricedLines =
      role === "affiliate" && userId
        ? await enforceAffiliateLinePrices(supabase, userId, invoiceCurrency, withLabels, cleaned)
        : cleaned;

    const taxRate = Number(tax_rate) || 0;
    const shipping = Number(shipping_cost) || 0;
    // The admin's choice rides on every invoice this request creates — on one
    // with no shipping it is simply inert, and it stays the invoice's standing
    // answer if shipping is added to it later.
    const chargeShippingOnCheckout = charge_shipping_on_checkout === true;
    // Flat processing fee (typically for self-pickup). Only applied to the total
    // when the "show on invoice" toggle is on; otherwise it's stored but inert.
    const processingFeeInput = Number(processing_fee) || 0;
    const showProcessingFee = show_processing_fee !== false;
    // Look up current stock for any product-bearing lines so we can decide
    // whether the order needs to be split into in-stock + backordered invoices.
    const productIds = [...new Set(pricedLines.filter((l) => l.product_id).map((l) => l.product_id as string))];
    const stockMap = new Map<string, number>();
    const vialsPerBoxMap = new Map<string, number>();
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, stock_quantity, vials_per_box")
        .in("id", productIds);
      for (const p of prods ?? []) {
        stockMap.set(p.id, Number(p.stock_quantity ?? 0));
        vialsPerBoxMap.set(p.id, Number(p.vials_per_box ?? 10));
      }
    }
    // Attach each product's vials-per-box so the split can convert box lines to
    // vials when allocating against the vial-counted stock pool.
    for (const l of pricedLines) {
      if (l.product_id) l.vials_per_box = vialsPerBoxMap.get(l.product_id) ?? 10;
    }
    // Override forces the entire order onto one invoice with no backorder split;
    // otherwise allocate stock greedily and split off the exceeding quantities.
    const overrideBackorder = override_backorder === true;
    const { inStock, backordered, backorderItems } = overrideBackorder
      ? { inStock: pricedLines, backordered: [] as SplitLine[], backorderItems: [] }
      : computeStockSplit(pricedLines, stockMap);

    // Invoices created here also create a matching order row (an invoice never
    // had one before). This gives every invoice an order number and lets the
    // shipping-label tooling — which operates on orders — work for
    // admin-created invoices too. Returns the new order id, or null on failure
    // (the invoice still saves; the order is best-effort).
    const createOrderForInvoice = async (
      lines: SplitLine[],
      total: number,
      status: string,
    ): Promise<string | null> => {
      const items = lines.map((l) => ({
        name: l.description,
        quantity: l.qty,
        price: l.unit_price,
      }));
      const orderStatus = status === "draft" ? "pending_invoice" : "processing";

      // Make sure the order carries a customer name so it doesn't render as a
      // "Guest" order. Prefer the address fields; fall back to the (guest)
      // invoice name. The readers fall back to shipping_address for the name.
      const [gFirst, ...gRest] = String(customer_name ?? "").split(" ").filter(Boolean);
      // A client shipment goes to the client's address, addressed under the
      // client's own name/contact (falling back to the customer's); otherwise
      // use the Ship-to captured on the form.
      const addr: Record<string, any> | null =
        fulfillmentType === "shipment" && resolvedClient
          ? buildClientShipAddress(resolvedClient, {
              customerName: customer_name,
              customerFirst: (shipAddr as any)?.firstName || gFirst,
              customerLast: (shipAddr as any)?.lastName || gRest.join(" "),
              customerPhone: customer_phone,
              customerEmail: customer_email,
            })
          : fulfillmentType === "shipment"
            ? {
                ...(shipAddr ?? {}),
                firstName: (shipAddr as any)?.firstName || gFirst || "",
                lastName: (shipAddr as any)?.lastName || gRest.join(" ") || "",
                phone: (shipAddr as any)?.phone || customer_phone || "",
              }
            : (gFirst || customer_phone)
              ? { firstName: gFirst || "", lastName: gRest.join(" ") || "", phone: customer_phone || "" }
              : null;

      for (let i = 0; i < 5; i++) {
        const { data: order, error: orderErr } = await supabase
          .from("orders")
          .insert({
            customer_id,
            order_number: generateOrderNumber(),
            items,
            total,
            email: customer_email,
            shipping_address: addr,
            crypto: "invoice",
            status: orderStatus,
            fulfillment_type: fulfillmentType,
            notes: fulfillmentType === "pickup" ? "PICKUP" : null,
          })
          .select("id")
          .single();
        if (orderErr?.code === "23505") continue; // order number clash, retry
        if (orderErr || !order) {
          console.error("createOrderForInvoice failed:", orderErr);
          return null;
        }
        // Populate order_items so the order detail page (which reads that table,
        // not the items JSONB) shows the line items.
        const orderItems = lines.map((l) => ({
          order_id: order.id,
          product_name: l.description,
          product_id: l.product_id ? String(l.product_id) : null,
          quantity: l.qty,
          price_at_time: l.unit_price,
          strength: null,
        }));
        const { error: oiErr } = await supabase.from("order_items").insert(orderItems);
        if (oiErr) console.error("createOrderForInvoice order_items failed:", oiErr);
        return order.id as string;
      }
      return null;
    };

    // Insert one invoice with its line items + commission row + audit entry.
    const insertInvoice = async (
      lines: SplitLine[],
      opts: {
        status: string;
        shipping: number;
        processingFee: number;
        is_backorder: boolean;
        parent_invoice_id: string | null;
      },
    ) => {
      const subtotal = lines.reduce((s, i) => s + i.line_total, 0);
      const taxTotal = Number((subtotal * (taxRate / 100)).toFixed(2));
      const effectiveFee = showProcessingFee ? opts.processingFee : 0;
      const total = Number((subtotal + taxTotal + opts.shipping + effectiveFee).toFixed(2));
      // Each credited person earns total x their own rate. Resolved per
      // invoice, so a split order gives each side its own correct commission.
      const resolvedTeam = resolveAssignments(assignments, total);

      // No order linked yet → create one from this invoice's contents.
      const linkedOrderId = order_id ?? (await createOrderForInvoice(lines, total, opts.status));

      const payload: Record<string, any> = {
        customer_id,
        customer_name,
        customer_email,
        customer_phone,
        order_id: linkedOrderId,
        subtotal: Number(subtotal.toFixed(2)),
        tax_rate: taxRate,
        tax_total: taxTotal,
        shipping_cost: opts.shipping,
        charge_shipping_on_checkout: chargeShippingOnCheckout,
        processing_fee: opts.processingFee,
        show_processing_fee: showProcessingFee,
        total,
        status: opts.status,
        // The backordered portion of a prepaid invoice is still procurement-
        // driven, so it inherits the same type.
        invoice_type: invoiceType,
        currency: invoiceCurrency,
        with_labels: withLabels,
        fulfillment_type: fulfillmentType,
        notes,
        // Legacy single-person columns, mirrored from the roster's primary.
        ...primaryInvoiceColumns(resolvedTeam),
        is_backorder: opts.is_backorder,
        parent_invoice_id: opts.parent_invoice_id,
        // Only the primary (non-backorder) invoice carries the client shipment;
        // the backordered portion ships separately once restocked.
        ships_to_client: shipsToClient && !opts.is_backorder,
        client_id: opts.is_backorder ? null : resolvedClientId,
        // Who entered this invoice — drives the "Source" tag/filter on the list.
        // role is one of admin/assistant/affiliate here (verifyAdmin gates it);
        // store-checkout invoices are stamped 'system' by autoCreateInvoiceFromOrder.
        created_by: userId,
        created_by_role: role,
      };
      if (issue_date) payload.issue_date = issue_date;
      if (due_date) payload.due_date = due_date;

      let { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert(payload)
        .select()
        .single();
      if (isMissingCheckoutShippingColumn(invErr)) {
        // `charge_shipping_on_checkout` comes from a later migration. A database
        // that hasn't run it must still be able to create invoices — dropping
        // the flag leaves the payment link at "shipping not charged", which is
        // its default anyway. Narrow on purpose: any other failure is reported
        // rather than retried, so a write that may already have landed is never
        // sent twice.
        const { charge_shipping_on_checkout: _flag, ...withoutFlag } = payload;
        ({ data: invoice, error: invErr } = await supabase
          .from("invoices")
          .insert(withoutFlag)
          .select()
          .single());
      }
      if (invErr || !invoice) {
        throw new Error(invErr?.message ?? "Insert failed");
      }

      const lineRows = lines.map((li) => ({
        product_id: li.product_id,
        description: li.description,
        qty: li.qty,
        unit_price: li.unit_price,
        discount_pct: li.discount_pct,
        line_total: li.line_total,
        price_type: li.price_type ?? "box",
        preferred_supplier_id: li.preferred_supplier_id ?? null,
        invoice_id: invoice.id,
      }));
      const { error: liErr } = await supabase.from("invoice_line_items").insert(lineRows);
      if (liErr) {
        await supabase.from("invoices").delete().eq("id", invoice.id);
        throw new Error(liErr.message);
      }

      // The roster, then one ledger row per person who actually earns.
      await writeInvoiceRoster(supabase, invoice.id, resolvedTeam);
      await syncInvoiceCommissions(supabase, invoice.id, resolvedTeam, total);

      // A paid invoice decrements stock immediately (idempotent in the DB),
      // then we re-check the affected products for low-stock alerts.
      if (opts.status === "paid") {
        const { error: stockErr } = await supabase.rpc("adjust_stock_for_invoice", { p_invoice_id: invoice.id });
        if (stockErr) console.error("Stock adjustment failed for invoice", invoice.id, stockErr);
        const ids = [...new Set(lines.filter((l) => l.product_id).map((l) => l.product_id as string))];
        await checkLowStockForProducts(supabase, ids).catch((e) => console.error("low-stock check failed:", e));
      }

      await logAuditServer(supabase, {
        actor_id: userId,
        action: "invoice.create",
        entity_type: "invoice",
        entity_id: invoice.id,
        payload: { invoice_number: invoice.invoice_number, total, status: opts.status, is_backorder: opts.is_backorder },
      });

      return invoice;
    };

    // Kick off the opted-in Easyship shipment for an invoice's order AFTER the
    // response is sent — mirrors the order checkout flow. Best-effort and fully
    // server-side; failures are logged to shipment_auto_logs and surface on the
    // order's Shipping Label panel, never blocking the invoice.
    const scheduleEasyship = (orderId: string | null | undefined) => {
      if (!easyshipRequested || !orderId) return;
      after(() =>
        createShipmentForInvoiceOrder(supabase, orderId, {
          courierId: easyshipCourierId,
          buyLabel: easyshipBuyLabel,
          insured: easyshipInsured,
          handover: easyshipHandover,
        }),
      );
    };

    // No shortfall: a single invoice exactly as before.
    if (backordered.length === 0) {
      const invoice = await insertInvoice(pricedLines, {
        status,
        shipping,
        processingFee: processingFeeInput,
        is_backorder: false,
        parent_invoice_id: null,
      });
      scheduleEasyship(invoice.order_id);
      // Tie the customer to the sales person's affiliate so they surface on that
      // affiliate's dashboard + customer list.
      await bindCustomerToSalesPersonAffiliate(supabase, customer_id, effectiveSalesPersonId);
      return NextResponse.json({ invoice }, { status: 201 });
    }

    // Split: in-stock quantities on the primary invoice, exceeding quantities on
    // a linked backorder invoice. Shipping rides on the primary; if everything
    // is backordered there is no primary and shipping defaults onto the
    // backorder invoice instead.
    let primary: any = null;
    if (inStock.length > 0) {
      primary = await insertInvoice(inStock, {
        status,
        shipping,
        processingFee: processingFeeInput,
        is_backorder: false,
        parent_invoice_id: null,
      });
      // Only the in-stock primary can ship now; the backordered portion can't.
      scheduleEasyship(primary.order_id);
    }

    const backInvoice = await insertInvoice(backordered, {
      // The backorder portion can't be fulfilled yet, so it always starts as a
      // draft regardless of the requested status (no stock is decremented).
      status: "draft",
      shipping: primary ? 0 : shipping,
      // Fee rides on the primary; only lands on the backorder when everything
      // is backordered (no primary), mirroring how shipping is handled.
      processingFee: primary ? 0 : processingFeeInput,
      is_backorder: true,
      parent_invoice_id: primary?.id ?? null,
    });

    // Record the backorder against the exceeding-qty invoice so it shows up in
    // the Backorders tab and can be fulfilled via a purchase order.
    const { data: bo, error: boErr } = await supabase
      .from("backorders")
      .insert({ invoice_id: backInvoice.id, status: "open" })
      .select("id")
      .single();
    if (boErr || !bo) {
      console.error("create backorder failed:", boErr);
    } else {
      const { error: itemsErr } = await supabase
        .from("backorder_items")
        .insert(backorderItems.map((i) => ({ ...i, backorder_id: bo.id })));
      if (itemsErr) console.error("insert backorder_items failed:", itemsErr);
    }

    // Tie the customer to the sales person's affiliate so they surface on that
    // affiliate's dashboard + customer list.
    await bindCustomerToSalesPersonAffiliate(supabase, customer_id, effectiveSalesPersonId);

    return NextResponse.json(
      { invoice: primary ?? backInvoice, backorder_invoice: backInvoice, split: true },
      { status: 201 },
    );
  } catch (e: any) {
    console.error("POST /invoices error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
