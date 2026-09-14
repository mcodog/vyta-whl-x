import { supabase } from "@/lib/supabase";
import type {
  Order,
  Customer,
  Affiliate,
  Commission,
  SalesCommission,
  RecordedPaymentMethod,
} from "@/lib/supabase";

/**
 * Get all orders with customer info
 */
export async function getAllOrders(): Promise<
  (Order & { customer_email?: string; customer_name?: string })[]
> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      customers (
        email,
        first_name,
        last_name
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching orders:", error);
    return [];
  }

  return (data || []).map((order: any) => {
    const ship = (order.shipping_address ?? {}) as Record<string, any>;
    const shipName = [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim();
    return {
      ...order,
      customer_email: order.customers?.email ?? order.email ?? undefined,
      customer_name: order.customers
        ? `${order.customers.first_name} ${order.customers.last_name}`.trim()
        : shipName || null,
    };
  });
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  orderId: string,
  status: Order["status"],
  trackingNumber?: string,
): Promise<{ success: boolean; error?: string }> {
  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (trackingNumber) {
    updates.tracking_number = trackingNumber;
  }

  const { error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId);

  if (error) {
    console.error("Error updating order:", error);
    return { success: false, error: "Failed to update order" };
  }

  return { success: true };
}

/** Details captured when an admin manually records a payment on an order. */
export interface RecordOrderPaymentInput {
  method: RecordedPaymentMethod;
  /** ISO timestamp of when the payment was received. */
  receivedAt: string;
  /** Whether the payment covered the order in full or only partially. */
  status: "full" | "partial";
  /** Dollar amount received. */
  amount: number;
}

/**
 * Record a manual payment against an order — its method, the date it was
 * received, whether it was paid in full or partially, and the amount.
 */
export async function recordOrderPayment(
  orderId: string,
  input: RecordOrderPaymentInput,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("orders")
    .update({
      payment_method: input.method,
      payment_received_at: input.receivedAt,
      payment_received_status: input.status,
      payment_received_amount: input.amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    console.error("Error recording order payment:", error);
    return { success: false, error: "Failed to record payment" };
  }

  return { success: true };
}

/**
 * Bulk-delete orders (admin only). Also deletes each order's linked invoice —
 * orders and invoices are a 1:1 pair bound by foreign key. Handles a single
 * order too (pass a one-element array).
 */
export async function deleteOrders(
  orderIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch("/api/admin/orders", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ids: orderIds }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: json.error || "Failed to delete orders" };
    return { success: true };
  } catch (error) {
    console.error("Error in deleteOrders:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Get all affiliates with their stats
 */
export async function getAllAffiliates(): Promise<
  (Affiliate & {
    pending_earnings?: number;
    total_referrals?: number;
    referral_code?: string;
  })[]
> {
  // Get affiliates
  const { data: affiliates, error } = await supabase
    .from("affiliates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching affiliates:", error);
    return [];
  }

  // Get referral codes and commissions for each affiliate
  const result = await Promise.all(
    (affiliates || []).map(async (affiliate) => {
      // Get referral code
      const { data: codes } = await supabase
        .from("referral_codes")
        .select("code, uses_count")
        .eq("affiliate_id", affiliate.id)
        .eq("active", true)
        .limit(1);

      // Get pending commissions
      const { data: pendingCommissions } = await supabase
        .from("commissions")
        .select("amount")
        .eq("affiliate_id", affiliate.id)
        .eq("status", "pending");

      const pendingEarnings = (pendingCommissions || []).reduce(
        (sum, c) => sum + c.amount,
        0,
      );

      return {
        ...affiliate,
        referral_code: codes?.[0]?.code,
        total_referrals: codes?.[0]?.uses_count || 0,
        pending_earnings: pendingEarnings,
      };
    }),
  );

  return result;
}

/**
 * Get all commissions
 */
export async function getAllCommissions(): Promise<
  (Commission & {
    affiliate_email?: string;
    affiliate_name?: string;
    order_number?: string;
  })[]
> {
  const { data, error } = await supabase
    .from("commissions")
    .select(
      `
      *,
      affiliates (
        email,
        first_name,
        last_name
      ),
      orders!commissions_order_id_fkey (
        order_number
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching commissions:", error);
    return [];
  }

  return (data || []).map((commission: any) => ({
    ...commission,
    affiliate_email: commission.affiliates?.email,
    affiliate_name: commission.affiliates
      ? `${commission.affiliates.first_name} ${commission.affiliates.last_name}`
      : null,
    order_number: commission.orders?.order_number,
  }));
}

/**
 * Mark commission as paid
 */
export async function markCommissionPaid(
  commissionId: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("commissions")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", commissionId);

  if (error) {
    console.error("Error marking commission paid:", error);
    return { success: false, error: "Failed to update commission" };
  }

  return { success: true };
}

export type SalesCommissionWithMeta = SalesCommission & {
  sales_person_name?: string | null;
  sales_person_email?: string | null;
  invoice_number?: string | null;
};

/**
 * Get all sales person commissions with salesperson + invoice info
 */
export async function getAllSalesCommissions(): Promise<SalesCommissionWithMeta[]> {
  const { data, error } = await supabase
    .from("sales_commissions")
    .select(
      `
      *,
      sales_persons (
        email,
        first_name,
        last_name
      ),
      invoices (
        invoice_number
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching sales commissions:", error);
    return [];
  }

  return (data || []).map((commission: any) => ({
    ...commission,
    sales_person_email: commission.sales_persons?.email,
    sales_person_name: commission.sales_persons
      ? `${commission.sales_persons.first_name} ${commission.sales_persons.last_name}`
      : null,
    invoice_number: commission.invoices?.invoice_number,
  }));
}

/**
 * Mark a sales person commission as paid
 */
export async function markSalesCommissionPaid(
  commissionId: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("sales_commissions")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", commissionId);

  if (error) {
    console.error("Error marking sales commission paid:", error);
    return { success: false, error: "Failed to update commission" };
  }

  return { success: true };
}

export interface LowStockProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
}

/**
 * Products at or below their configured low-stock threshold, lowest stock
 * first. PostgREST can't compare two columns, so we fetch products that have a
 * threshold set (a small set) and filter the comparison client-side.
 */
export async function getLowStockProducts(): Promise<LowStockProduct[]> {
  const { data } = await supabase
    .from("products")
    .select("id, name, slug, strength, stock_quantity, low_stock_threshold")
    .not("low_stock_threshold", "is", null);
  return (data ?? [])
    .filter((p: any) => Number(p.stock_quantity ?? 0) <= Number(p.low_stock_threshold))
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug ?? null,
      strength: p.strength ?? null,
      stock_quantity: Number(p.stock_quantity ?? 0),
      low_stock_threshold: Number(p.low_stock_threshold),
    }))
    .sort((a, b) => a.stock_quantity - b.stock_quantity);
}

export interface AutoShipmentLog {
  id: string;
  order_id: string | null;
  order_number: string | null;
  stage: 'shipment' | 'label';
  ok: boolean;
  courier: string | null;
  error: string | null;
  created_at: string;
}

/**
 * Recent failed auto-shipment attempts (draft creation or label buy), surfaced
 * on the admin dashboard. Reads the append-only shipment_auto_logs feed.
 */
export async function getAutoShipmentFailures(limit = 15): Promise<AutoShipmentLog[]> {
  const { data, error } = await supabase
    .from("shipment_auto_logs")
    .select("id, order_id, order_number, stage, ok, courier, error, created_at")
    .eq("ok", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  // The table may not exist yet (migration not run) — fail soft.
  if (error) return [];
  return (data ?? []) as AutoShipmentLog[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

/**
 * Dismiss a single auto-shipment failure from the dashboard feed. Deletes are
 * service-role only (RLS grants read, not delete), so this routes through the
 * admin API. Returns the number of rows removed.
 */
export async function deleteAutoShipmentFailure(id: string): Promise<number> {
  const res = await fetch(`/api/admin/shipment-logs?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete auto-shipment failure");
  const { deleted } = await res.json();
  return deleted ?? 0;
}

/**
 * Clear every failed auto-shipment log at once (ok=false rows). Returns the
 * number of rows removed.
 */
export async function clearAutoShipmentFailures(): Promise<number> {
  const res = await fetch(`/api/admin/shipment-logs?scope=failures`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear auto-shipment failures");
  const { deleted } = await res.json();
  return deleted ?? 0;
}

/**
 * Get dashboard stats
 */
export async function getAdminStats(): Promise<{
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  totalAffiliates: number;
  pendingCommissions: number;
  totalCommissionsPaid: number;
}> {
  // Get orders stats
  const { data: orders } = await supabase
    .from("orders")
    .select("status, total");

  const totalOrders = orders?.length || 0;
  const totalRevenue = (orders || []).reduce(
    (sum, o) => sum + (o.total || 0),
    0,
  );
  const pendingOrders = (orders || []).filter(
    (o) =>
      o.status === "pending" ||
      o.status === "received" ||
      o.status === "confirmed",
  ).length;

  // Get affiliates count
  const { count: affiliateCount } = await supabase
    .from("affiliates")
    .select("*", { count: "exact", head: true });

  // Get commissions stats
  const { data: commissions } = await supabase
    .from("commissions")
    .select("status, amount");

  const pendingCommissions = (commissions || [])
    .filter((c) => c.status === "pending")
    .reduce((sum, c) => sum + c.amount, 0);

  const totalCommissionsPaid = (commissions || [])
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + c.amount, 0);

  return {
    totalOrders,
    totalRevenue,
    pendingOrders,
    totalAffiliates: affiliateCount || 0,
    pendingCommissions,
    totalCommissionsPaid,
  };
}

/**
 * Get single order with full details (items, customer, commission)
 */
export async function getOrderDetail(orderId: string) {
  // Get order with customer
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      `
      *,
      customers (
        email,
        first_name,
        last_name,
        phone,
        shipping_address,
        shipping_city,
        shipping_state,
        shipping_postal_code,
        shipping_country
      )
    `,
    )
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    console.error("Error fetching order:", orderError);
    return null;
  }

  // Get order items
  const { data: items } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  // Get the auto-shipment attempt history (draft creation + label purchase),
  // newest first. The table may not exist yet (migration not run) — fail soft.
  const { data: autoShipmentLogs } = await supabase
    .from("shipment_auto_logs")
    .select("id, stage, ok, courier, error, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  // Get commission if any (match by order_number since that's what checkout stores)
  const { data: commissions } = await supabase
    .from("commissions")
    .select(
      `
      *,
      affiliates (
        email,
        first_name,
        last_name
      ),
      referral_codes (
        code
      )
    `,
    )
    .eq("order_id", order.id);

  const ship = (order.shipping_address ?? {}) as Record<string, any>;
  const shipName = [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim();
  return {
    order: {
      ...order,
      customer_email: order.customers?.email ?? order.email ?? null,
      customer_name: order.customers
        ? `${order.customers.first_name} ${order.customers.last_name}`.trim()
        : shipName || null,
      customer_phone: order.customers?.phone ?? ship.phone ?? null,
      customer_shipping: order.customers
        ? {
            address: order.customers.shipping_address,
            city: order.customers.shipping_city,
            state: order.customers.shipping_state,
            postal_code: order.customers.shipping_postal_code,
            country: order.customers.shipping_country,
          }
        : null,
    },
    items: (items || []).map((item: any) => ({
      ...item,
      product_name: item.product_name,
      product_strength: item.strength,
      product_image: null,
    })),
    commission: commissions?.[0]
      ? {
          ...commissions[0],
          affiliate_name: commissions[0].affiliates
            ? `${commissions[0].affiliates.first_name} ${commissions[0].affiliates.last_name}`
            : null,
          affiliate_email: commissions[0].affiliates?.email,
          referral_code: commissions[0].referral_codes?.code,
        }
      : null,
    autoShipmentLogs: (autoShipmentLogs ?? []) as AutoShipmentLog[],
  };
}

/**
 * Update order tracking number
 */
export async function updateOrderTracking(
  orderId: string,
  trackingNumber: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("orders")
    .update({
      tracking_number: trackingNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    console.error("Error updating tracking:", error);
    return { success: false, error: "Failed to update tracking" };
  }
  return { success: true };
}

/**
 * Create an Easyship shipment for an order (generates tracking + enables
 * tracking webhooks). For orders that don't auto-create on payment.
 */
export async function createOrderShipment(
  orderId: string,
  courierId?: string,
  opts?: { insured?: boolean; handover?: 'pickup' | 'dropoff' | null },
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`/api/admin/orders/${orderId}/create-shipment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(courierId ? { courierId } : {}),
      ...(opts?.insured ? { insured: true } : {}),
      ...(opts?.handover ? { handover: opts.handover } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to create shipment' };
  }
  return { success: true };
}

export interface BulkShipmentReadinessRow {
  id: string;
  orderNumber: string | null;
  /** True when a shipment can be created for this order right now. */
  eligible: boolean;
  isPickup: boolean;
  hasShipment: boolean;
  /** Why the order was skipped (present only when not eligible). */
  reason?: string;
}

/**
 * Pre-flight the bulk "create shipment record" action: evaluate each selected
 * order's Easyship readiness and report which can have a shipment created and
 * which will be skipped (and why), so the confirmation dialog can warn first.
 */
export async function getBulkShipmentReadiness(
  orderIds: string[],
): Promise<{ success: boolean; results: BulkShipmentReadinessRow[]; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, results: [], error: 'Not authenticated' };

  const res = await fetch('/api/admin/orders/bulk-shipment-readiness', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: orderIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, results: [], error: data.error || 'Failed to check readiness' };
  return { success: true, results: data.results ?? [] };
}

export interface OrderCourierRate {
  courierId: string;
  courier: string;
  cost: number;
  minDays?: number;
  maxDays?: number;
  currency: string;
}

/** Live courier options for an order's destination (FedEx/UPS whitelist). */
export async function getOrderShippingRates(
  orderId: string,
): Promise<{ success: boolean; rates: OrderCourierRate[]; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, rates: [], error: 'Not authenticated' };

  const res = await fetch(`/api/admin/orders/${orderId}/rates`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, rates: [], error: data.error || 'Failed to load rates' };
  return { success: true, rates: data.rates ?? [], error: data.error };
}

/**
 * Buy/confirm the Easyship label for an order's shipment. The PDF generates
 * asynchronously; returns label_state and (when already available) label_url.
 */
export async function buyOrderLabel(
  orderId: string,
): Promise<{ success: boolean; error?: string; labelState?: string; labelUrl?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`/api/admin/orders/${orderId}/buy-label`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error || 'Failed to buy label' };
  return { success: true, labelState: data.labelState, labelUrl: data.labelUrl };
}

export interface LabelReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  category: 'settings' | 'destination' | 'parcel';
  hint?: string;
}

export interface LabelReadiness {
  isPickup: boolean;
  ready: boolean;
  checks: LabelReadinessCheck[];
  destination: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
    email: string;
  };
  /** Linked customer's details for one-click "smart fill"; null for guests. */
  suggested: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
    email: string;
  } | null;
  shipment: {
    hasShipment: boolean;
    shipmentId: string | null;
    labelState: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    trackingStatus: string | null;
  };
}

/**
 * Fetch the Easyship label readiness checklist for an order.
 */
export async function getLabelReadiness(
  orderId: string,
): Promise<{ success: boolean; data?: LabelReadiness; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`/api/admin/orders/${orderId}/label-readiness`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error || 'Failed to load readiness' };
  return { success: true, data };
}

export interface InvoiceShippingDestination {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
}

export interface InvoiceShippingReadiness {
  ready: boolean;
  checks: LabelReadinessCheck[];
  rates: OrderCourierRate[];
  /** Why no live rates came back (shown when rates is empty). */
  ratesNote?: string | null;
  /** The global handling ("processing") fee — used to prefill the per-invoice override. */
  handlingFee?: { type: 'flat' | 'percent'; value: number };
}

/**
 * Evaluate Easyship readiness for an invoice that hasn't been created yet —
 * posts the typed destination + line items and gets back the checklist, an
 * overall ready flag, and the live UPS/FedEx courier options when ready.
 */
export async function getInvoiceShippingReadiness(input: {
  destination: InvoiceShippingDestination;
  items: Array<{ quantity: number; declaredValue: number }>;
  /** Whether to add the processing/handling fee on top of the courier rate. */
  applyProcessingFee?: boolean;
  /** Per-invoice override of the processing fee amount (flat CAD or % points). */
  processingFeeValue?: number | null;
}): Promise<{ success: boolean; data?: InvoiceShippingReadiness; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch('/api/admin/invoices/shipping-readiness', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error || 'Failed to check readiness' };
  return { success: true, data };
}

/**
 * Update an order's destination (shipping) address — used to fix missing label
 * fields inline before creating a shipment.
 */
export async function updateOrderShippingAddress(
  orderId: string,
  address: Partial<LabelReadiness['destination']>,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`/api/admin/orders/${orderId}/shipping-address`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(address),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error || 'Failed to update address' };
  return { success: true };
}

/**
 * Open the order's Easyship label PDF in a new tab (proxied with auth).
 */
export async function openOrderLabel(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  // Open the tab synchronously (avoids popup blockers) then navigate it.
  const tab = window.open('', '_blank');
  const res = await fetch(`/api/admin/orders/${orderId}/label`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    tab?.close();
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Label not available yet' };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url;
  else window.open(url, '_blank');
  return { success: true };
}

/**
 * Get all customers
 */
export async function getAllCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching customers:", error);
    return [];
  }

  return data || [];
}

/**
 * Create a guest customer via the server-side admin route (service role).
 * The customers table has no INSERT policy for authenticated clients, so a
 * direct browser insert is rejected by RLS — this proxies through the API.
 */
export async function createCustomer(data: {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country?: string;
  price_currency?: "CAD" | "USD";
  /** Storefront only: convert configured prices into price_currency, or bill as-is. */
  convert_storefront_prices?: boolean;
  default_with_labels?: boolean;
}): Promise<{
  success: boolean;
  customer?: Customer;
  error?: string;
  conflict?: { type: "affiliate"; id: string; first_name: string | null; last_name: string | null; email: string };
}> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(data),
    });

    const json = await res.json();
    if (!res.ok) {
      // The email already belongs to an affiliate — surface the collision so the
      // caller can direct the user to that record rather than duplicating it.
      if (res.status === 409 && json?.conflict?.type === "affiliate") {
        return { success: false, error: json.error, conflict: json.conflict };
      }
      return { success: false, error: json.error || "Failed to create customer" };
    }
    return { success: true, customer: json.customer as Customer };
  } catch (error) {
    console.error("Error in createCustomer:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Toggle customer admin status
 */
export async function toggleCustomerAdmin(
  customerId: string,
  isAdmin: boolean,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("customers")
    .update({ is_admin: isAdmin })
    .eq("id", customerId);

  if (error) {
    console.error("Error updating customer:", error);
    return { success: false, error: "Failed to update customer" };
  }

  return { success: true };
}

/**
 * Update a customer's profile (and, for auth-backed customers, their login
 * email/password/active state). Proxies through the server-side admin route so
 * Supabase Auth admin calls run with the service role key. Guest customers
 * (no login) are updated profile-only.
 */
export async function updateCustomer(
  customerId: string,
  updates: {
    email?: string;
    alternate_email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role?: "customer" | "warehouse" | "analytics" | "assistant" | "admin";
    active?: boolean;
    password?: string;
    price_currency?: "CAD" | "USD";
    /** Storefront only: convert configured prices into price_currency, or bill as-is. */
    convert_storefront_prices?: boolean;
    default_with_labels?: boolean;
    default_sales_person_id?: string | null;
    /**
     * The customer's whole sales team (up to five), each with the commission
     * rate they earn on this customer. Replaces the stored roster wholesale;
     * entry 0 also becomes `default_sales_person_id`. An empty array clears the
     * team. Omit the key to leave the team untouched.
     */
    sales_people?: { sales_person_id: string; commission_rate: number }[];
    shipping_address?: string;
    shipping_city?: string;
    shipping_state?: string;
    shipping_postal_code?: string;
    shipping_country?: string;
  },
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(updates),
    });

    const json = await res.json();
    if (!res.ok)
      return { success: false, error: json.error || "Failed to update customer" };
    return { success: true, customer: json.customer as Customer };
  } catch (error) {
    console.error("Error in updateCustomer:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Delete a customer. Hard delete removes the profile and (when present) the
 * linked auth user via the service-role admin route. Soft delete deactivates
 * the customer through the same route's PUT so an auth ban is also applied.
 */
export async function deleteCustomer(
  customerId: string,
  hard: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    if (hard) {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok)
        return { success: false, error: json.error || "Failed to delete customer" };
      return { success: true };
    }

    // Soft delete: deactivate (also bans the auth user when one exists).
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ active: false }),
    });
    const json = await res.json();
    if (!res.ok)
      return { success: false, error: json.error || "Failed to deactivate customer" };
    return { success: true };
  } catch (error) {
    console.error("Error in deleteCustomer:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Update per-customer fulfillment options
 */
export async function updateCustomerFulfillment(
  customerId: string,
  allowPickup: boolean,
  allowShipping: boolean,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("customers")
    .update({ allow_pickup: allowPickup, allow_shipping: allowShipping })
    .eq("id", customerId);

  if (error) {
    console.error("Error updating customer fulfillment:", error);
    return { success: false, error: "Failed to update fulfillment options" };
  }

  return { success: true };
}

/**
 * Get all users with optional filtering
 */
export async function getUsers(filters?: {
  role?: string;
  active?: boolean;
  search?: string;
}): Promise<Customer[]> {
  let query = supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.role) {
    query = query.eq("role", filters.role);
  }

  if (filters?.active !== undefined) {
    query = query.eq("active", filters.active);
  }

  if (filters?.search) {
    const search = filters.search.toLowerCase();
    query = query.or(
      `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching users:", error);
    return [];
  }

  return data || [];
}

/**
 * Create a new user via the server-side API route.
 * Uses the service role key server-side so auth.admin.createUser works
 * and email_confirm:true bypasses email confirmation.
 */
export async function createUser(data: {
  email: string;
  first_name: string;
  last_name: string;
  role: "customer" | "warehouse" | "analytics" | "assistant" | "admin";
  password_hash: string;
  phone?: string;
  active?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    console.log("[createUser] Getting session...");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    console.log("[createUser] Session present:", session);
    if (!session) return { success: false, error: "Not authenticated" };

    console.log("[createUser] Calling POST /api/admin/users...");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
        password: data.password_hash,
        phone: data.phone,
        active: data.active,
      }),
    });

    console.log("[createUser] Response status:", res.status);
    const json = await res.json();
    console.log("[createUser] Response body:", json);
    if (!res.ok)
      return { success: false, error: json.error || "Failed to create user" };
    return { success: true };
  } catch (error) {
    console.error("[createUser] Unexpected error:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Update user information (both auth and customer profile).
 * Proxies through the server-side API route so auth.admin.updateUserById
 * runs with the service role key.
 */
export async function updateUser(
  userId: string,
  updates: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role?: "customer" | "warehouse" | "analytics" | "assistant" | "admin";
    active?: boolean;
    password?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(updates),
    });

    const json = await res.json();
    if (!res.ok)
      return { success: false, error: json.error || "Failed to update user" };
    return { success: true };
  } catch (error) {
    console.error("Error in updateUser:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Delete user (soft or hard delete).
 * Hard delete proxies through the server-side API route so auth.admin.deleteUser
 * runs with the service role key. Soft delete (deactivate) only updates the
 * customers table and can stay client-side.
 */
export async function deleteUser(
  userId: string,
  hard: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (hard) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return { success: false, error: "Not authenticated" };

      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json = await res.json();
      if (!res.ok)
        return { success: false, error: json.error || "Failed to delete user" };
      return { success: true };
    }

    // Soft delete: deactivate via PUT route so auth ban is also applied
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ active: false }),
    });

    const json = await res.json();
    if (!res.ok)
      return {
        success: false,
        error: json.error || "Failed to deactivate user",
      };
    return { success: true };
  } catch (error) {
    console.error("Error in deleteUser:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Create a new affiliate via the server-side API route.
 * Creates a Supabase Auth user first, then inserts to the affiliates table
 * using the auth user's UUID as id. Also generates a referral code.
 */
/** An existing customer that collides with a new affiliate's email. */
export interface AffiliateEmailConflict {
  type: "customer";
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  has_login: boolean;
}

export async function createAffiliate(data: {
  email: string;
  first_name: string;
  last_name: string;
  password?: string;
  wallet_address?: string;
  active?: boolean;
  /** Billing currency for the new affiliate (defaults to CAD server-side). */
  price_currency?: "CAD" | "USD";
  // When set, confirms merging the colliding customer (this id) into the
  // affiliate instead of failing on the email collision.
  merge_customer_id?: string;
}): Promise<{
  success: boolean;
  error?: string;
  affiliate_id?: string;
  conflict?: AffiliateEmailConflict;
  merged?: boolean;
  promoted?: boolean;
  has_login?: boolean;
}> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch("/api/admin/affiliates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(data),
    });

    const json = await res.json();
    if (!res.ok) {
      // A customer already owns this email — surface the collision so the caller
      // can prompt to merge/promote rather than treating it as a hard error.
      if (res.status === 409 && json?.conflict?.type === "customer") {
        return { success: false, error: json.error, conflict: json.conflict };
      }
      return {
        success: false,
        error: json.error || "Failed to create affiliate",
      };
    }
    return {
      success: true,
      affiliate_id: json.affiliate_id,
      merged: json.merged,
      promoted: json.promoted,
      has_login: json.has_login,
    };
  } catch (error) {
    console.error("Error in createAffiliate:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Email a passwordless magic sign-in link to a customer/affiliate by their
 * customers-row id, via the same proven endpoint as the "Login Link" button.
 */
export async function sendCustomerMagicLink(
  customerId: string,
  redirectPath?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch("/api/admin/customers/magic-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ customer_id: customerId, redirect_path: redirectPath }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: json.error || "Failed to send sign-in link" };
    return { success: true };
  } catch (error) {
    console.error("Error in sendCustomerMagicLink:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Email a password-reset link to a customer/affiliate by their customers-row
 * id. Unlike the magic link (which signs them straight in), this drops them on
 * /account/set-password to choose a new password — the staff-initiated twin of
 * the customer-facing "Forgot password" form.
 */
export async function sendCustomerPasswordReset(
  customerId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch("/api/admin/customers/password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ customer_id: customerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: json.error || "Failed to send reset link" };
    return { success: true };
  } catch (error) {
    console.error("Error in sendCustomerPasswordReset:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Update affiliate information (auth credentials + affiliate profile).
 */
export async function updateAffiliate(
  affiliateId: string,
  updates: {
    email?: string;
    first_name?: string;
    last_name?: string;
    wallet_address?: string;
    active?: boolean;
    manual_code_only?: boolean;
    /** Billing currency; persisted to the affiliate's own customers row. */
    price_currency?: "CAD" | "USD";
    password?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/affiliates/${affiliateId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(updates),
    });

    const json = await res.json();
    if (!res.ok)
      return {
        success: false,
        error: json.error || "Failed to update affiliate",
      };
    return { success: true };
  } catch (error) {
    console.error("Error in updateAffiliate:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Hard delete an affiliate (removes referral codes, affiliate row, and auth user).
 */
export async function deleteAffiliate(
  affiliateId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/affiliates/${affiliateId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    const json = await res.json();
    if (!res.ok)
      return {
        success: false,
        error: json.error || "Failed to delete affiliate",
      };
    return { success: true };
  } catch (error) {
    console.error("Error in deleteAffiliate:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Toggle affiliate active status (syncs auth ban via PUT route).
 */
export async function toggleAffiliateActive(
  affiliateId: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/affiliates/${affiliateId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ active }),
    });

    const json = await res.json();
    if (!res.ok)
      return {
        success: false,
        error: json.error || "Failed to update affiliate status",
      };
    return { success: true };
  } catch (error) {
    console.error("Error in toggleAffiliateActive:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Toggle user active status.
 * Routes through PUT /api/admin/users/[id] so the auth ban is synced.
 */
export async function toggleUserActive(
  userId: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ active }),
    });

    const json = await res.json();
    if (!res.ok)
      return {
        success: false,
        error: json.error || "Failed to update user status",
      };
    return { success: true };
  } catch (error) {
    console.error("Error in toggleUserActive:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
