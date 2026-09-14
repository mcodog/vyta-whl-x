import { supabase } from "@/lib/supabase";
import type {
  AgingBucket,
  FulfillmentStatus,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  Payment,
  PaymentMethod,
} from "@/lib/supabase";

// -------------------------------------------------------------------------
// Auth helpers
// -------------------------------------------------------------------------
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      }
    : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// -------------------------------------------------------------------------
// Invoices
// -------------------------------------------------------------------------
/**
 * The linked order's shipping fields, flattened onto each invoice list row so
 * the invoices page can drive the shipment/label tooling (invoices are bound
 * 1:1 to an order). Null when the invoice has no linked order (or it was
 * deleted underneath the invoice).
 */
export interface InvoiceOrderShipment {
  order_id: string;
  order_number: string | null;
  easyship_shipment_id: string | null;
  label_state: string | null;
  tracking_number: string | null;
  fulfillment_type: string | null;
  notes: string | null;
}

export interface InvoiceListItem extends Invoice {
  customer_name_display: string | null;
  customer_email_display: string | null;
  /** The PRIMARY sales person's name — the single-name column, unchanged. */
  sales_person_name: string | null;
  /** Every credited sales person's name, primary first. */
  sales_person_names?: string[];
  order_shipment: InvoiceOrderShipment | null;
}

export interface InvoiceStats {
  count: number;
  outstanding: number;
  overdueCount: number;
  paid: number;
}

export interface InvoiceListResult {
  invoices: InvoiceListItem[];
  total: number;
  stats: InvoiceStats;
}

export async function getInvoices(filters?: {
  // "outstanding" is a virtual filter covering every unpaid, non-draft,
  // non-cancelled invoice (server maps it to status in sent/partial/overdue).
  status?: InvoiceStatus | "all" | "outstanding";
  customer_id?: string;
  /** Restrict to a single invoice type ('standard' | 'prepaid'). */
  invoice_type?: "standard" | "prepaid";
  /** Restrict by who entered the invoice: 'admin' (staff), 'client' (affiliate
   *  portal), or 'online' (store checkout). */
  created_source?: "admin" | "client" | "online";
  /** Restrict by the billing currency the invoice is denominated in. */
  currency?: "CAD" | "USD";
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<InvoiceListResult> {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  if (filters?.customer_id) params.set("customer_id", filters.customer_id);
  if (filters?.invoice_type) params.set("invoice_type", filters.invoice_type);
  if (filters?.created_source) params.set("created_source", filters.created_source);
  if (filters?.currency) params.set("currency", filters.currency);
  if (filters?.q?.trim()) params.set("q", filters.q.trim());
  if (filters?.limit != null) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString();
  const res = await apiFetch<{
    invoices: InvoiceListItem[];
    total?: number;
    stats?: InvoiceStats;
  }>(`/api/admin/invoices${qs ? `?${qs}` : ""}`);
  return {
    invoices: res.invoices,
    total: res.total ?? res.invoices.length,
    stats:
      res.stats ?? { count: res.invoices.length, outstanding: 0, overdueCount: 0, paid: 0 },
  };
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  try {
    const { invoice } = await apiFetch<{ invoice: Invoice }>(`/api/admin/invoices/${id}`);
    return invoice;
  } catch {
    return null;
  }
}

export interface InvoiceInput {
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  order_id?: string | null;
  issue_date?: string;
  due_date?: string;
  tax_rate?: number;
  shipping_cost?: number;
  /**
   * Whether this invoice's hosted-checkout payment link charges `shipping_cost`.
   * Defaults to false, which sends `shipping_total_cents: 0` — the link then
   * bills the items only, since shipping is usually settled outside it.
   */
  charge_shipping_on_checkout?: boolean;
  /** Flat processing fee (typically for self-pickup invoices). Defaults to 0. */
  processing_fee?: number;
  /** Whether the processing fee is applied to the total and shown on the PDF. */
  show_processing_fee?: boolean;
  status?: InvoiceStatus;
  /** 'standard' (default) or 'prepaid' — a client-prepaid procurement invoice. */
  invoice_type?: "standard" | "prepaid";
  /** Currency the invoice is paid in. Defaults to CAD. */
  currency?: "CAD" | "USD";
  /** Whether the order ships with product labels. Defaults to true. */
  with_labels?: boolean;
  fulfillment_type?: "shipment" | "pickup";
  /** Destination for the order created from a shipment invoice. */
  shipping_address?: Record<string, unknown> | null;
  notes?: string | null;
  /**
   * Everyone credited on this invoice (up to five), primary first — each earns
   * `total x their own commission_rate`. An empty array clears attribution.
   */
  sales_people?: Array<{ sales_person_id: string; commission_rate: number }>;
  /**
   * The legacy single-person pair. Still accepted (and still written from the
   * roster's primary), so an older client keeps working unchanged.
   */
  sales_person_id?: string | null;
  sales_person_commission_rate?: number;
  line_items: Array<
    Pick<InvoiceLineItem, "product_id" | "description" | "qty" | "unit_price" | "discount_pct" | "price_type"> & {
      /** Supplier chosen to procure this line (prepaid invoices). */
      preferred_supplier_id?: string | null;
    }
  >;
  /** Create an Easyship shipment record for the order this invoice spawns. */
  create_easyship_shipment?: boolean;
  /** Courier_service id to lock that shipment to (UPS/FedEx). */
  easyship_courier_id?: string | null;
  /** Also buy/print the shipping label once the shipment exists. */
  easyship_buy_label?: boolean;
  /** Items ship to the customer's client — generate/send a Packing List. */
  ships_to_client?: boolean;
  /** Existing client to ship to (mutually exclusive with `client`). */
  client_id?: string | null;
  /**
   * Force the whole order onto a single invoice, skipping the stock-shortfall
   * split. When true, no backorder is created even if quantities exceed stock;
   * on edit, any existing OPEN backorder for the invoice is cleared.
   */
  override_backorder?: boolean;
  /** A brand-new client to create and ship to. `address` is required. */
  client?: {
    first_name?: string | null;
    last_name?: string | null;
    address: string;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
}

export interface CreateInvoiceResult {
  invoice: Invoice;
  /** Present when the order was split because some quantities exceeded stock. */
  backorder_invoice?: Invoice;
  split?: boolean;
}

export async function createInvoice(input: InvoiceInput): Promise<CreateInvoiceResult> {
  return apiFetch<CreateInvoiceResult>("/api/admin/invoices", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type InvoicePatch = Partial<InvoiceInput>;

export async function replaceInvoice(id: string, patch: InvoicePatch): Promise<Invoice> {
  const { invoice } = await apiFetch<{ invoice: Invoice }>(`/api/admin/invoices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return invoice;
}

// Routed through PATCH (no direct supabase mutations) so audit log fires.
export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice> {
  return replaceInvoice(id, { status });
}

// Set the warehouse fulfillment status (packed / shipped / dropped_off /
// picked_up) from the admin invoice list. The PATCH route stamps who/when and
// syncs the linked order's status for terminal steps.
export async function setInvoiceFulfillmentStatus(
  id: string,
  status: FulfillmentStatus,
): Promise<Invoice> {
  const { invoice } = await apiFetch<{ invoice: Invoice }>(`/api/admin/invoices/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fulfillment_status: status }),
  });
  return invoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/admin/invoices/${id}`, { method: "DELETE" });
}

/**
 * Bulk-delete invoices (admin only). Also deletes each invoice's linked order —
 * invoices and orders are a 1:1 pair bound by foreign key. Handles a single
 * invoice too (pass a one-element array).
 */
export async function deleteInvoices(ids: string[]): Promise<void> {
  await apiFetch<{ ok: true }>("/api/admin/invoices", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// -------------------------------------------------------------------------
// Linked-order tracking
// -------------------------------------------------------------------------
export interface InvoiceTrackingSnapshot {
  tracking_number: string | null;
  tracking_status: string | null;
  tracking_url: string | null;
  carrier: string | null;
  label_state: string | null;
}

export interface InvoiceTrackingResult {
  /** False when the invoice has no linked order (legacy invoices). */
  hasOrder: boolean;
  order_id?: string;
  order_number?: string | null;
  order_status?: string | null;
  /** Whether the linked order has an Easyship shipment to track live. */
  hasShipment?: boolean;
  /** True when the returned snapshot came from a live Easyship refresh. */
  live?: boolean;
  tracking: InvoiceTrackingSnapshot | null;
}

/**
 * Fetch the tracking snapshot for an invoice's bound order. Pass
 * `{ refresh: true }` to pull a live Easyship update first (when a shipment
 * exists). Safe for invoices with no order — returns `hasOrder: false`.
 */
export async function getInvoiceTracking(
  invoiceId: string,
  opts?: { refresh?: boolean },
): Promise<InvoiceTrackingResult> {
  const qs = opts?.refresh ? "?refresh=1" : "";
  return apiFetch<InvoiceTrackingResult>(`/api/admin/invoices/${invoiceId}/tracking${qs}`);
}

// -------------------------------------------------------------------------
// Easyship sync — attach shipments/labels onto invoices by customer name
// -------------------------------------------------------------------------
/** A raw Easyship shipment record surfaced by the sync preview. */
export interface EasyshipSyncRecord {
  shipmentId: string;
  createdAt: string | null;
  destinationName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingStatus: string | null;
  labelState: string | null;
  labelUrl: string | null;
  courier: string | null;
  platformOrderNumber: string | null;
}

/** A proposed shipment → invoice match. */
export interface EasyshipSyncMatch extends EasyshipSyncRecord {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceName: string;
  /** The name mapped to more than one invoice — the newest was chosen. */
  ambiguous: boolean;
  candidateCount: number;
}

export interface EasyshipSyncPreview {
  date: string;
  fetched: number;
  /** Set when the Easyship fetch failed and returned nothing. */
  easyshipError: string | null;
  matches: EasyshipSyncMatch[];
  unmatched: EasyshipSyncRecord[];
}

/**
 * Preview an Easyship sync: fetch shipments created on/after `date`
 * (YYYY-MM-DD) and match them to invoices by customer name. Read-only.
 */
export async function previewEasyshipSync(date: string): Promise<EasyshipSyncPreview> {
  return apiFetch<EasyshipSyncPreview>('/api/admin/invoices/easyship-sync', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });
}

/** A confirmed match to attach to its invoice's linked order. */
export interface EasyshipSyncApplyItem {
  invoiceId: string;
  shipmentId: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingStatus?: string | null;
  labelState?: string | null;
  labelUrl?: string | null;
  courier?: string | null;
}

export interface EasyshipSyncApplyResult {
  applied: number;
  failed: number;
  skipped: Array<{ invoiceId: string; reason: string }>;
}

/**
 * Apply confirmed Easyship matches: attach each shipment (id, tracking, label)
 * onto the invoice's linked order. Orders that already have a shipment, or that
 * are missing, are skipped and reported back.
 */
export async function applyEasyshipSync(
  matches: EasyshipSyncApplyItem[],
): Promise<EasyshipSyncApplyResult> {
  return apiFetch<EasyshipSyncApplyResult>('/api/admin/invoices/easyship-sync', {
    method: 'POST',
    body: JSON.stringify({ apply: matches }),
  });
}

// -------------------------------------------------------------------------
// Payments
// -------------------------------------------------------------------------
export interface PaymentInput {
  amount: number;
  method: PaymentMethod;
  reference_note?: string | null;
  paid_at?: string;
  /**
   * When true, email the customer a "payment received" confirmation. Driven by
   * the toggle in the record-payment confirmation modal. Defaults to not
   * sending when omitted.
   */
  send_email?: boolean;
}

export interface RecordPaymentResult {
  payment: Payment;
  /**
   * Outcome of the customer confirmation email. `requested` mirrors the toggle;
   * `sent` is true only when the email actually went out. Present so the caller
   * can surface "sent / not sent" immediately after recording.
   */
  email: {
    requested: boolean;
    sent: boolean;
    error?: string | null;
    to?: string | null;
    /** Email of the admin who triggered the send. */
    by?: string | null;
  };
}

export async function recordPayment(
  invoiceId: string,
  input: PaymentInput,
): Promise<RecordPaymentResult> {
  const res = await apiFetch<RecordPaymentResult>(
    `/api/admin/invoices/${invoiceId}/payments`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return res;
}

export interface ReversePaymentResult {
  ok: true;
  /** The payment that was removed. */
  reversed_payment: { id: string; amount: number; method: PaymentMethod };
  /** The invoice's recomputed money + status after the reversal. */
  invoice: {
    id: string;
    status: InvoiceStatus;
    total: number;
    amount_paid: number;
    amount_due: number;
  };
  /** True when the paid-transition's stock decrement was given back. */
  stock_restored: boolean;
}

/**
 * Reverse (delete) a recorded payment. The server recomputes the invoice status
 * from what remains (paid → partial → sent) and, when the invoice is no longer
 * fully paid, restores the stock the paid transition decremented. Admin only.
 */
export async function reversePayment(
  invoiceId: string,
  paymentId: string,
): Promise<ReversePaymentResult> {
  return apiFetch<ReversePaymentResult>(
    `/api/admin/invoices/${invoiceId}/payments/${paymentId}`,
    { method: "DELETE" },
  );
}

// -------------------------------------------------------------------------
// Aging report
// -------------------------------------------------------------------------
export async function getAgingReport(): Promise<AgingBucket[]> {
  const { buckets } = await apiFetch<{ buckets: AgingBucket[] }>("/api/admin/invoices/aging");
  return buckets;
}

// -------------------------------------------------------------------------
// Auto-create from order (server helper for downstream order-confirm flows)
// -------------------------------------------------------------------------
// Idempotent: returns the existing invoice if one is already linked to the
// order. Caller is responsible for providing a service-role supabase client.
export async function autoCreateInvoiceFromOrder(
  serviceSupabase: import("@supabase/supabase-js").SupabaseClient,
  orderId: string,
): Promise<Invoice | null> {
  // Idempotency: short-circuit if an invoice already exists for this order
  const { data: existing } = await serviceSupabase
    .from("invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) return existing as Invoice;

  const { data: order } = await serviceSupabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (!order) return null;

  const { data: items } = await serviceSupabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  // If the order carries an affiliate discount, spread it across the line items
  // as a uniform per-line discount so the invoice shows the reduced pricing the
  // customer actually paid.
  const rawSubtotal = (items ?? []).reduce(
    (s: number, i: any) => s + Number(i.price_at_time) * i.quantity,
    0,
  );
  const discountAmount = Number(order.discount_amount) || 0;
  const discountRate = rawSubtotal > 0 ? discountAmount / rawSubtotal : 0;
  const discountPct = Number((discountRate * 100).toFixed(2));

  const line_items = (items ?? []).map((i: any) => {
    const unit = Number(i.price_at_time);
    return {
      product_id: null,
      description: [i.product_name, i.strength].filter(Boolean).join(" — "),
      qty: i.quantity,
      unit_price: unit,
      discount_pct: discountPct,
      line_total: Number((unit * i.quantity * (1 - discountRate)).toFixed(2)),
      // Carry the box/vial tag from the order onto the invoice line.
      price_type: i.price_type === "vial" ? "vial" : "box",
    };
  });

  const subtotal = line_items.reduce((s, i) => s + i.line_total, 0);
  const orderTotal = Number(order.total) || subtotal;
  // The order total already bundles shipping; recover it as the difference so
  // the invoice total matches the order the customer actually paid.
  const shippingCost = Math.max(0, Number((orderTotal - subtotal).toFixed(2)));

  // Denormalise a display name/phone from the order's shipping address so the
  // invoice is identifiable even when there's no linked customer record.
  const ship = (order.shipping_address ?? {}) as Record<string, any>;
  const customerName =
    [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim() || null;

  // Carry the order's fulfillment method onto the invoice so the warehouse
  // queue knows whether to ship or hold for pickup. Fall back to the legacy
  // notes flag for orders created before fulfillment_type existed.
  const fulfillmentType =
    order.fulfillment_type ?? (order.notes === "PICKUP" ? "pickup" : "shipment");

  const { data: invoice, error } = await serviceSupabase
    .from("invoices")
    .insert({
      order_id: orderId,
      customer_id: order.customer_id,
      customer_name: customerName,
      customer_email: order.email,
      customer_phone: ship.phone ?? null,
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal: Number(subtotal.toFixed(2)),
      tax_rate: 0,
      tax_total: 0,
      shipping_cost: shippingCost,
      total: Number(orderTotal.toFixed(2)),
      status: "draft",
      fulfillment_type: fulfillmentType,
      // Inherit the order's billing currency (CAD default) so a USD order's
      // invoice is denominated and labelled in USD. order.* is SELECT *, so the
      // column is absent (→ undefined → CAD) on a pre-migration database.
      currency: order.currency === "USD" ? "USD" : "CAD",
      // Store-generated: this invoice was auto-created from a customer checkout,
      // not entered by a person. Drives the "Online" Source tag on the list.
      created_by_role: "system",
    })
    .select()
    .single();
  if (error || !invoice) {
    console.error("autoCreateInvoiceFromOrder insert error:", error);
    return null;
  }

  if (line_items.length > 0) {
    await serviceSupabase
      .from("invoice_line_items")
      .insert(line_items.map((li) => ({ ...li, invoice_id: invoice.id })));
  }
  return invoice as Invoice;
}

/**
 * Create a fulfillment invoice for a paid PuraMass (Stealth Health) hosted-
 * checkout order so its items appear in the warehouse queue, marked as a Stealth
 * Health order. Idempotent per PuraMass order (guarded by
 * `puramass_orders.invoice_id`). Called from the Stealth Health webhook.
 *
 * Where PuraMass collected the customer's name / phone / shipping address and
 * priced the order itself, this invoice has a minimal customer record and no
 * shipping address — the warehouse queue explains those gaps via the source
 * badge and tooltips.
 *
 * When the signed-in customer checkout collected them here instead (`attach`),
 * the invoice carries the real thing: the customer's currency, the shipping they
 * paid, and a link to the order row holding the address and the Easyship
 * shipment — so the shipment shows on the invoice exactly as an in-house one
 * does, and the warehouse has an address to pack against.
 */
export async function createStealthHealthFulfillmentInvoice(
  serviceSupabase: import("@supabase/supabase-js").SupabaseClient,
  order: {
    id: string;
    transaction_id: string | null;
    customer_id: string | null;
    customer_email: string | null;
    items: unknown;
    invoice_id: string | null;
  },
  paidItems?: Array<{
    sku?: string;
    name?: string;
    quantity?: number;
    unit_price_cents?: number;
  }>,
  attach?: {
    /** The order row carrying the shipping address + Easyship shipment. */
    orderId?: string | null;
    /** Shipping the customer was charged, in cents. */
    shippingCents?: number | null;
    /** The order's currency ('cad' | 'usd'); defaults to USD as before. */
    currency?: string | null;
    /** Recipient details, for the invoice's own customer fields. */
    recipient?: { name?: string | null; phone?: string | null } | null;
    /** The courier the customer paid for, named in the invoice notes. */
    courier?: string | null;
    /**
     * How the customer is getting the order. A hosted-checkout customer who
     * chose to collect in person pays no shipping and gets no courier, and the
     * warehouse queue has to hold the order at the counter rather than pack it
     * for a shipment — which it decides from this. Defaults to 'shipment', what
     * every hand-off was before pickup existed.
     */
    fulfillmentType?: "shipment" | "pickup" | null;
    /**
     * The state to raise the invoice in. `pending_payment` is the normal case:
     * the invoice is created when the customer is handed off to the hosted
     * checkout, and flipped to `paid` by {@link markPuramassInvoicePaid} when
     * the payment webhook lands. `paid` is for the fallback path where the
     * webhook is the first thing that knows about the order at all.
     */
    status?: "pending_payment" | "paid";
    /** Hosted payment link, so a pending invoice can be resumed by the customer. */
    paymentLink?: string | null;
  },
): Promise<{ id: string } | null> {
  // Idempotency: at most one invoice per PuraMass order.
  if (order.invoice_id) return { id: order.invoice_id };
  const { data: linked } = await serviceSupabase
    .from("puramass_orders")
    .select("invoice_id")
    .eq("id", order.id)
    .maybeSingle();
  if (linked?.invoice_id) return { id: linked.invoice_id as string };

  // Prefer the webhook's paid items (they carry name + unit price + the exact
  // SKUs the customer actually paid for); fall back to what we sent at hand-off.
  const rawItems =
    Array.isArray(paidItems) && paidItems.length
      ? paidItems
      : Array.isArray(order.items)
        ? (order.items as any[])
        : [];
  const items = rawItems
    .map((i: any) => ({
      sku: typeof i.sku === "string" ? i.sku : "",
      name: typeof i.name === "string" ? i.name : "",
      quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
      unit_price:
        i.unit_price_cents != null && Number.isFinite(Number(i.unit_price_cents))
          ? Number(i.unit_price_cents) / 100
          : 0,
    }))
    .filter((i) => i.sku);

  // Map each PuraMass SKU back to a storefront product (best effort) for the
  // line's product link + a nicer description.
  const skus = items.map((i) => i.sku);
  const productBySku = new Map<string, { id: string; name: string }>();
  if (skus.length) {
    const { data: byBox } = await serviceSupabase
      .from("products")
      .select("id, name, puramass_sku")
      .in("puramass_sku", skus);
    for (const p of byBox ?? []) {
      if (p.puramass_sku) productBySku.set(p.puramass_sku as string, { id: p.id, name: p.name });
    }
    const { data: byVial } = await serviceSupabase
      .from("products")
      .select("id, name, puramass_sku_vial")
      .in("puramass_sku_vial", skus);
    for (const p of byVial ?? []) {
      if (p.puramass_sku_vial)
        productBySku.set(p.puramass_sku_vial as string, { id: p.id, name: p.name });
    }
  }

  const line_items = items.map((i) => {
    const prod = productBySku.get(i.sku) ?? null;
    return {
      product_id: prod?.id ?? null,
      description: i.name || prod?.name || i.sku,
      qty: i.quantity,
      unit_price: Number(i.unit_price.toFixed(2)),
      discount_pct: 0,
      line_total: Number((i.unit_price * i.quantity).toFixed(2)),
      price_type: i.sku.endsWith("-vial") ? "vial" : "box",
    };
  });

  const subtotal = Number(line_items.reduce((s, i) => s + i.line_total, 0).toFixed(2));

  // Shipping the customer paid at our checkout, when we collected it. A
  // hand-off that let PuraMass handle shipping carries none, as before.
  const shippingCost =
    attach?.shippingCents != null && Number.isFinite(Number(attach.shippingCents))
      ? Number((Number(attach.shippingCents) / 100).toFixed(2))
      : 0;
  const currency = String(attach?.currency ?? "").toLowerCase() === "cad" ? "CAD" : "USD";
  const status = attach?.status ?? "paid";
  // An invoice with our own address and shipment isn't missing anything, so it
  // doesn't get the "managed by Stealth Health" caveat.
  const collectedHere = Boolean(attach?.orderId) || Boolean(attach?.paymentLink);
  const isPickup = attach?.fulfillmentType === "pickup";
  // How the order leaves us, for the notes: the courier when there is one, and
  // "collected in person" for a pickup — which is also why such an invoice has
  // no shipping charge and no address.
  const fulfilmentNote = isPickup
    ? "; collected in person"
    : attach?.courier
      ? `; shipping by ${attach.courier}`
      : "";
  const paidNote = `Paid by card through the hosted checkout${fulfilmentNote}.`;
  const notes =
    `Stealth Health order${order.transaction_id ? ` — transaction ${order.transaction_id}` : ""}. ` +
    (status === "pending_payment"
      ? `Raised at checkout${fulfilmentNote ? ` —${fulfilmentNote.replace(/^;/, "")}` : ""}. Awaiting payment on the hosted checkout; it becomes paid when the payment is confirmed.`
      : collectedHere
        ? paidNote
        : "Payment, and the customer's name / phone / shipping address, are collected and managed by Stealth Health.");

  const { data: invoice, error } = await serviceSupabase
    .from("invoices")
    .insert({
      source: "stealth_health",
      order_id: attach?.orderId ?? null,
      customer_id: order.customer_id ?? null,
      customer_name: attach?.recipient?.name || null,
      customer_email: order.customer_email ?? null,
      customer_phone: attach?.recipient?.phone || null,
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal,
      tax_rate: 0,
      tax_total: 0,
      shipping_cost: shippingCost,
      total: Number((subtotal + shippingCost).toFixed(2)),
      status,
      fulfillment_type: isPickup ? "pickup" : "shipment",
      fulfillment_status: "pending",
      currency,
      created_by_role: "system",
      notes,
    })
    .select("id")
    .single();
  if (error || !invoice) {
    console.error("createStealthHealthFulfillmentInvoice insert error:", error);
    return null;
  }

  if (line_items.length) {
    const { error: liError } = await serviceSupabase
      .from("invoice_line_items")
      .insert(line_items.map((li) => ({ ...li, invoice_id: invoice.id })));
    if (liError) console.error("Stealth Health invoice line items error:", liError);
  }

  // The resume link is written separately: its column comes from a later
  // migration, and folding it into the insert above would lose the whole
  // invoice on a database that hasn't run that migration yet.
  if (attach?.paymentLink) {
    const { error: linkErr } = await serviceSupabase
      .from("invoices")
      .update({ checkout_payment_link: attach.paymentLink })
      .eq("id", invoice.id);
    if (linkErr) {
      console.error("Stealth Health invoice payment-link update failed:", linkErr);
    }
  }

  await serviceSupabase
    .from("puramass_orders")
    .update({ invoice_id: invoice.id })
    .eq("id", order.id);

  return invoice as { id: string };
}

/**
 * Flip a hosted-checkout invoice from `pending_payment` to `paid` once the
 * payment webhook confirms it, and attach the order row carrying the shipping
 * address and Easyship shipment created at the same moment.
 *
 * Idempotent and defensive: an invoice that is already `paid` is left alone
 * (a redelivered webhook must not re-stamp it), and an invoice in any other
 * state — `partial`, `cancelled`, something an admin moved by hand — is
 * reported rather than overwritten, because a human has touched it since.
 *
 * Returns whether the flip happened, and why not when it didn't.
 */
export async function markPuramassInvoicePaid(
  serviceSupabase: import("@supabase/supabase-js").SupabaseClient,
  invoiceId: string,
  attach?: {
    /** The order row created alongside the shipment, to link to the invoice. */
    orderId?: string | null;
    /** The courier the shipment actually went out with. */
    courier?: string | null;
  },
): Promise<{ updated: boolean; reason?: string }> {
  const { data: invoice, error } = await serviceSupabase
    .from("invoices")
    .select("id, status, order_id, notes")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error || !invoice) return { updated: false, reason: "Invoice not found" };
  if (invoice.status === "paid") return { updated: false, reason: "Already paid" };
  if (invoice.status !== "pending_payment") {
    return { updated: false, reason: `Invoice is ${invoice.status}` };
  }

  const update: Record<string, unknown> = { status: "paid" };
  // Link the order row now that one exists — it is what carries the shipping
  // address and Easyship shipment onto the invoice.
  if (attach?.orderId && !invoice.order_id) update.order_id = attach.orderId;
  if (attach?.courier) {
    const note = String(invoice.notes ?? "");
    update.notes = note.includes(attach.courier)
      ? note
      : `${note} Shipping by ${attach.courier}.`.trim();
  }

  const { error: updErr } = await serviceSupabase
    .from("invoices")
    .update(update)
    .eq("id", invoiceId);
  if (updErr) {
    console.error("markPuramassInvoicePaid failed:", updErr);
    return { updated: false, reason: updErr.message };
  }
  return { updated: true };
}
