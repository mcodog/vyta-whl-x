import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { getInvoiceCaller, affiliateCustomerIds } from '@/lib/admin/invoice-access';
import { effectiveStatus } from '@/lib/admin/invoice-status';
import type { InvoiceStatus } from '@/lib/supabase';
import {
  MAX_SALES_PEOPLE,
  normalizeAssignments,
  readCustomerRoster,
  salesPersonLabel,
  writeCustomerRoster,
} from '@/lib/admin/sales-attribution';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// The customer row plus the relations the 360 view leans on. Matches the FK
// names used by the list route so the joins resolve identically.
const CUSTOMER_SELECT =
  '*, ' +
  'bound_affiliate:affiliates!customers_affiliate_id_fkey(id, first_name, last_name, email), ' +
  'default_sales_person:sales_persons!customers_default_sales_person_id_fkey(id, first_name, last_name, email, commission_rate), ' +
  'applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(id, name, is_active)';

interface ArBucket {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  count: number;
  openCount: number;
  overdueCount: number;
  paidCount: number;
}

const emptyBucket = (): ArBucket => ({
  invoiced: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
  count: 0,
  openCount: 0,
  overdueCount: 0,
  paidCount: 0,
});

type FlowCurrency = 'CAD' | 'USD';

/** One sales person's take from a single customer, in one currency. */
interface SalesFlowEarner {
  salesPersonId: string;
  name: string;
  email: string | null;
  /** Invoices of this customer they were credited on. */
  invoiceCount: number;
  /** Those invoices' totals — the money they brought in. */
  invoiced: number;
  /** Commission recorded, split by where it stands. */
  commission: number;
  commissionPaid: number;
  commissionPending: number;
  /** Commission as a share of what they invoiced (0 when they invoiced nothing). */
  effectiveRate: number;
}

interface SalesFlowBucket {
  /** Every invoice raised for the customer, cancelled ones excluded. */
  invoiced: number;
  invoiceCount: number;
  /** Commission across everyone, and what's left for the business. */
  commission: number;
  commissionPaid: number;
  commissionPending: number;
  net: number;
  earners: SalesFlowEarner[];
}

const emptyFlowBucket = (): SalesFlowBucket => ({
  invoiced: 0,
  invoiceCount: 0,
  commission: 0,
  commissionPaid: 0,
  commissionPending: 0,
  net: 0,
  earners: [],
});

/**
 * Roll up every commission recorded against this customer's invoices, per sales
 * person and per currency.
 *
 * The ledger (`sales_commissions`) is the source of truth for money owed or
 * paid — one row per person per invoice, so a multi-person invoice contributes
 * one row each. Cancelled commissions are excluded (nobody earns on a reversed
 * deal) and so are cancelled / non-payable invoices, matching how A/R counts.
 *
 * `net` is what the business keeps after commission — the number that makes the
 * money flow legible at a glance.
 */
async function buildSalesFlow(
  invoiceRows: Array<{
    id: string;
    currency: FlowCurrency;
    total: number;
    cancelled: boolean;
    nonPayable: boolean;
  }>,
): Promise<{ byCurrency: Record<FlowCurrency, SalesFlowBucket>; currencies: FlowCurrency[] }> {
  const byCurrency: Record<FlowCurrency, SalesFlowBucket> = {
    CAD: emptyFlowBucket(),
    USD: emptyFlowBucket(),
  };

  const counted = invoiceRows.filter((i) => !i.cancelled && !i.nonPayable);
  for (const inv of counted) {
    const bucket = byCurrency[inv.currency];
    bucket.invoiced += inv.total;
    bucket.invoiceCount += 1;
  }

  const invoiceIds = counted.map((i) => i.id);
  if (invoiceIds.length === 0) {
    return { byCurrency, currencies: currenciesWithActivity(byCurrency) };
  }
  const currencyOf = new Map(counted.map((i) => [i.id, i.currency]));
  const totalOf = new Map(counted.map((i) => [i.id, i.total]));

  const { data: commissionRows } = await supabase
    .from('sales_commissions')
    .select(
      'sales_person_id, invoice_id, amount, status, sales_person:sales_persons(id, first_name, last_name, email)',
    )
    .in('invoice_id', invoiceIds);

  // person -> currency -> running totals
  const earners = new Map<string, Map<FlowCurrency, SalesFlowEarner>>();
  const seenInvoices = new Map<string, Set<string>>();

  for (const row of ((commissionRows as any[]) ?? [])) {
    if (row.status === 'cancelled') continue;
    const cur = currencyOf.get(String(row.invoice_id));
    if (!cur) continue;
    const personId = String(row.sales_person_id);

    let perCurrency = earners.get(personId);
    if (!perCurrency) {
      perCurrency = new Map();
      earners.set(personId, perCurrency);
    }
    let earner = perCurrency.get(cur);
    if (!earner) {
      earner = {
        salesPersonId: personId,
        name: salesPersonLabel(row.sales_person),
        email: row.sales_person?.email ?? null,
        invoiceCount: 0,
        invoiced: 0,
        commission: 0,
        commissionPaid: 0,
        commissionPending: 0,
        effectiveRate: 0,
      };
      perCurrency.set(cur, earner);
    }

    // One person can only be credited once per invoice, but guard anyway so a
    // stray duplicate ledger row can't double-count the invoice's value.
    const key = `${personId}:${cur}`;
    let seen = seenInvoices.get(key);
    if (!seen) {
      seen = new Set();
      seenInvoices.set(key, seen);
    }
    if (!seen.has(String(row.invoice_id))) {
      seen.add(String(row.invoice_id));
      earner.invoiceCount += 1;
      earner.invoiced += totalOf.get(String(row.invoice_id)) ?? 0;
    }

    const amount = Number(row.amount) || 0;
    earner.commission += amount;
    if (row.status === 'paid') earner.commissionPaid += amount;
    else earner.commissionPending += amount;
  }

  for (const perCurrency of earners.values()) {
    for (const [cur, earner] of perCurrency) {
      earner.effectiveRate = earner.invoiced > 0 ? (earner.commission / earner.invoiced) * 100 : 0;
      byCurrency[cur].earners.push(earner);
      byCurrency[cur].commission += earner.commission;
      byCurrency[cur].commissionPaid += earner.commissionPaid;
      byCurrency[cur].commissionPending += earner.commissionPending;
    }
  }

  for (const bucket of Object.values(byCurrency)) {
    // Biggest earner first — that's the question the page is answering.
    bucket.earners.sort((a, b) => b.commission - a.commission);
    bucket.net = bucket.invoiced - bucket.commission;
  }

  return { byCurrency, currencies: currenciesWithActivity(byCurrency) };
}

/** Currencies this customer actually has activity in, CAD first. */
function currenciesWithActivity(
  byCurrency: Record<FlowCurrency, SalesFlowBucket>,
): FlowCurrency[] {
  return (['CAD', 'USD'] as FlowCurrency[]).filter(
    (c) => byCurrency[c].invoiceCount > 0 || byCurrency[c].earners.length > 0,
  );
}

/**
 * GET /api/admin/customers/[id]
 * The "Customer 360" aggregate: profile + relations, the full invoice ledger
 * with per-currency A/R totals, storefront orders, saved ship-to clients, a
 * pricing summary, and the live cart snapshot. Admin/assistant see any
 * customer; an affiliate only their own bound customers (scoped server-side).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const caller = await getInvoiceCaller(supabase, request);
  if (!caller || caller.role === 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (caller.role === 'affiliate') {
    const ids = await affiliateCustomerIds(supabase, caller.id);
    // Treat a customer outside the affiliate's book as not found (no probing).
    if (!ids.includes(id)) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error || !customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  // Orders match by id and by email (to catch guest-checkout rows), same as the
  // takeover view.
  let orderQuery = supabase
    .from('orders')
    .select('id, order_number, status, total, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  orderQuery = customer.email
    ? orderQuery.or(`customer_id.eq.${id},email.eq.${customer.email}`)
    : orderQuery.eq('customer_id', id);

  const [invoicesRes, ordersRes, clientsRes, overridesRes, cartRes] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, status, currency, total, issue_date, due_date, created_at, ' +
          'is_backorder, non_payable, fulfillment_status, fulfillment_type, ships_to_client, ' +
          'client_id, invoice_type, sales_person_id, payments(amount, paid_at, method)',
      )
      .eq('customer_id', id)
      .order('issue_date', { ascending: false })
      .limit(300),
    orderQuery,
    supabase
      .from('customer_clients')
      .select('*')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('customer_price_overrides')
      .select('override_price, unlabeled_override_price, vial_override_price, is_visible')
      .eq('customer_id', id),
    supabase
      .from('customer_carts')
      .select('items, item_count, updated_at')
      .eq('customer_id', id)
      .maybeSingle(),
  ]);

  // Derive per-invoice paid/due + effective (live-overdue) status, and roll up
  // A/R per currency (amounts are never converted, mirroring analytics).
  const invoices = (invoicesRes.data ?? []).map((inv) => {
    const paidRaw = (inv.payments ?? []).reduce(
      (s: number, p: { amount: number | null }) => s + (Number(p?.amount) || 0),
      0,
    );
    const total = Number(inv.total) || 0;
    const amountPaid = Math.min(paidRaw, total);
    const amountDue = Math.max(0, total - amountPaid);
    return {
      ...inv,
      amount_paid: amountPaid,
      amount_due: amountDue,
      status_effective: effectiveStatus(inv.status as InvoiceStatus, inv.due_date),
    };
  });

  const ar: Record<'CAD' | 'USD', ArBucket> = { CAD: emptyBucket(), USD: emptyBucket() };
  for (const inv of invoices) {
    // Non-payable backorder trackers and cancelled invoices don't count toward A/R.
    if (inv.non_payable || inv.status === 'cancelled') continue;
    const cur: 'CAD' | 'USD' = inv.currency === 'USD' ? 'USD' : 'CAD';
    const b = ar[cur];
    b.invoiced += Number(inv.total) || 0;
    b.paid += inv.amount_paid;
    b.count += 1;
    if (inv.status_effective === 'paid') {
      b.paidCount += 1;
    } else {
      b.outstanding += inv.amount_due;
      b.openCount += 1;
    }
    if (inv.status_effective === 'overdue') {
      b.overdue += inv.amount_due;
      b.overdueCount += 1;
    }
  }

  const orders = ordersRes.data ?? [];
  const overrides = overridesRes.data ?? [];
  const cartItems = Array.isArray(cartRes.data?.items) ? cartRes.data!.items : [];

  // --- where this customer's money goes ------------------------------------
  // Every commission ever recorded against one of this customer's invoices,
  // rolled up per sales person and per currency (amounts are never converted —
  // the invoice's own currency is authoritative, exactly as A/R above).
  //
  // Staff only. An affiliate reaches this route for their own bound customers,
  // and what a co-selling colleague earns is none of their business — they see
  // their own commissions on their own dashboard.
  const isStaff = caller.role === 'admin' || caller.role === 'assistant';
  const salesFlow = isStaff
    ? await buildSalesFlow(
        invoices.map((i) => ({
          id: i.id,
          currency: i.currency === 'USD' ? 'USD' : 'CAD',
          total: Number(i.total) || 0,
          cancelled: i.status === 'cancelled',
          nonPayable: Boolean(i.non_payable),
        })),
      )
    : null;

  // The assignment roster, read separately so a pre-migration database still
  // serves the customer (it just falls back to default_sales_person).
  const salesTeam = await readCustomerRoster(supabase, id);

  return NextResponse.json({
    customer: { ...customer, sales_people: salesTeam },
    invoices,
    ar,
    orders,
    ordersSummary: {
      count: orders.length,
      lifetimeSpent: orders.reduce(
        (s: number, o: { total: number | null }) => s + (Number(o?.total) || 0),
        0,
      ),
    },
    clients: clientsRes.data ?? [],
    pricing: {
      appliedPricelistName: customer.applied_pricelist?.name ?? null,
      appliedPricelistActive: customer.applied_pricelist?.is_active ?? null,
      customPriceCount: overrides.filter(
        (o) =>
          o.override_price != null ||
          o.unlabeled_override_price != null ||
          o.vial_override_price != null,
      ).length,
      hiddenCount: overrides.filter((o) => o.is_visible === false).length,
      overrideCount: overrides.length,
    },
    cart: { items: cartItems, updatedAt: cartRes.data?.updated_at ?? null },
    /** Who is assigned to this customer, and — for staff — what each has
     *  earned from them. Null for an affiliate: the assignment is theirs to
     *  see, the money isn't. */
    salesFlow: salesFlow ? { team: salesTeam, ...salesFlow } : null,
    assignment: {
      assignedAdminId: customer.assigned_admin_id ?? null,
      assignedAdminName: customer.assigned_admin_name ?? null,
      assignedAdminEmail: customer.assigned_admin_email ?? null,
      assignedAt: customer.assigned_at ?? null,
      isMine: customer.assigned_admin_id === caller.id,
    },
    caller: { id: caller.id, role: caller.role },
  });
}

// Helper: verify the caller is an admin
async function verifyAdmin(
  request: NextRequest,
): Promise<{ authorized: boolean; userId: string | null }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { authorized: false, userId: null };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { authorized: false, userId: null };

  let { data: rows } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id);

  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from('customers')
      .select('role')
      .eq('email', user.email.toLowerCase());
    rows = emailRows;
  }

  return { authorized: rows?.[0]?.role === 'admin', userId: user.id };
}

// Whether a Supabase Auth user exists for this id. Guest customers (created
// without a login from the invoice form) have no auth user, so any auth-side
// sync must be skipped for them rather than erroring.
async function hasAuthUser(id: string): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  return !error && !!data?.user;
}

/**
 * PUT /api/admin/customers/[id]
 * Updates a customer's profile (name/email/phone/role/active). When the
 * customer is auth-backed, email/password/active are also synced to Supabase
 * Auth; for guest customers those auth steps are skipped.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const customerId = params.id;
  const updates = await request.json().catch(() => ({}));

  const authBacked = await hasAuthUser(customerId);

  // Sync active status + credentials to Supabase Auth (auth-backed only).
  if (authBacked) {
    if (updates.active !== undefined) {
      const { error: banError } = await supabase.auth.admin.updateUserById(customerId, {
        ban_duration: updates.active ? 'none' : '876600h',
      });
      if (banError) {
        console.error('Error updating auth ban status:', banError);
        return NextResponse.json(
          { error: banError.message || 'Failed to update customer status' },
          { status: 500 },
        );
      }
    }

    if (updates.email || updates.password) {
      const authUpdates: Record<string, string> = {};
      if (updates.email) authUpdates.email = String(updates.email).toLowerCase();
      if (updates.password) authUpdates.password = updates.password;

      const { error: authError } = await supabase.auth.admin.updateUserById(customerId, authUpdates);
      if (authError) {
        console.error('Error updating auth user:', authError);
        return NextResponse.json(
          { error: authError.message || 'Failed to update login credentials' },
          { status: 500 },
        );
      }
    }
  }

  // Update the customers profile row.
  const profileUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.email) profileUpdates.email = String(updates.email).toLowerCase();
  // Secondary/backup email — informational only, not synced to Supabase Auth.
  if (updates.alternate_email !== undefined) {
    profileUpdates.alternate_email = updates.alternate_email
      ? String(updates.alternate_email).toLowerCase()
      : null;
  }
  if (updates.first_name !== undefined) profileUpdates.first_name = updates.first_name || null;
  if (updates.last_name !== undefined) profileUpdates.last_name = updates.last_name || null;
  if (updates.phone !== undefined) profileUpdates.phone = updates.phone || null;
  // Shipping address (e.g. saved back from an invoice's Ship to block).
  if (updates.shipping_address !== undefined) profileUpdates.shipping_address = updates.shipping_address || null;
  if (updates.shipping_city !== undefined) profileUpdates.shipping_city = updates.shipping_city || null;
  if (updates.shipping_state !== undefined) profileUpdates.shipping_state = updates.shipping_state || null;
  if (updates.shipping_postal_code !== undefined) profileUpdates.shipping_postal_code = updates.shipping_postal_code || null;
  if (updates.shipping_country !== undefined) profileUpdates.shipping_country = updates.shipping_country || null;
  if (updates.role) {
    profileUpdates.role = updates.role;
    profileUpdates.is_admin = updates.role === 'admin';
  }
  if (updates.active !== undefined) profileUpdates.active = updates.active;
  // Price-display currency tag ('CAD' or 'USD'); ignore anything else.
  if (updates.price_currency === 'CAD' || updates.price_currency === 'USD') {
    profileUpdates.price_currency = updates.price_currency;
  }
  // Storefront price conversion: whether this customer's configured prices are
  // converted into price_currency, or shown/charged as-is and merely
  // denominated in it. Storefront only — admin invoices ignore this.
  if (typeof updates.convert_storefront_prices === 'boolean') {
    profileUpdates.convert_storefront_prices = updates.convert_storefront_prices;
  }
  // Default product-label preference (with/without vial labels) for new invoices.
  if (typeof updates.default_with_labels === 'boolean') {
    profileUpdates.default_with_labels = updates.default_with_labels;
  }
  // Default sales person auto-filled on this customer's new invoices. Accepts a
  // sales_persons id or null to clear the association. Ignored when the request
  // also sends a full `sales_people` roster — the roster's primary wins.
  if (updates.default_sales_person_id !== undefined && !Array.isArray(updates.sales_people)) {
    profileUpdates.default_sales_person_id = updates.default_sales_person_id || null;
  }

  // The customer's sales team (up to five), each with the rate they earn on this
  // customer. Written before the profile update so `default_sales_person_id` —
  // which writeCustomerRoster keeps pointed at the primary — isn't overwritten
  // by a stale value in the same request.
  if (Array.isArray(updates.sales_people)) {
    // Reject an over-long roster rather than silently keeping the first five —
    // an admin who listed six people should be told, not quietly edited.
    if (updates.sales_people.length > MAX_SALES_PEOPLE) {
      return NextResponse.json(
        { error: `A customer can have at most ${MAX_SALES_PEOPLE} sales people` },
        { status: 400 },
      );
    }
    const assignments = normalizeAssignments(updates.sales_people);
    const { error: rosterError } = await writeCustomerRoster(supabase, customerId, assignments);
    if (rosterError) {
      console.error('Error updating customer sales team:', rosterError);
      return NextResponse.json(
        { error: rosterError || 'Failed to update the sales team' },
        { status: 500 },
      );
    }
  }

  const { data, error: profileError } = await supabase
    .from('customers')
    .update(profileUpdates)
    .eq('id', customerId)
    .select(
      '*, bound_affiliate:affiliates!customers_affiliate_id_fkey(id, first_name, last_name, email), default_sales_person:sales_persons!customers_default_sales_person_id_fkey(id, first_name, last_name, email, commission_rate)',
    )
    .single();

  if (profileError) {
    console.error('Error updating customer profile:', profileError);
    return NextResponse.json(
      { error: profileError.message || 'Failed to update customer' },
      { status: 500 },
    );
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: 'customer.update',
    entity_type: 'customer',
    entity_id: customerId,
    payload: {
      fields: Object.keys(profileUpdates).filter((k) => k !== 'updated_at'),
    },
  });

  // Hand back the fresh roster so the caller doesn't need a second round-trip.
  const salesPeople = await readCustomerRoster(supabase, customerId);

  return NextResponse.json({ customer: { ...data, sales_people: salesPeople } });
}

/**
 * DELETE /api/admin/customers/[id]
 * Hard-deletes the customer profile and, when present, the linked Supabase
 * Auth user. Guest customers (no auth user) are simply removed from the table.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const customerId = params.id;

  // Remove the profile row first so the list stops showing the customer even
  // if the auth deletion below is a no-op (guest) or fails.
  const { error: profileError } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId);

  if (profileError) {
    console.error('Error deleting customer profile:', profileError);
    return NextResponse.json(
      { error: profileError.message || 'Failed to delete customer' },
      { status: 500 },
    );
  }

  // Best-effort auth cleanup; ignored for guests / already-removed users.
  if (await hasAuthUser(customerId)) {
    const { error: authError } = await supabase.auth.admin.deleteUser(customerId);
    if (authError) {
      console.error('Error deleting auth user (profile already deleted):', authError);
    }
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: 'customer.delete',
    entity_type: 'customer',
    entity_id: customerId,
  });

  return NextResponse.json({ success: true });
}
