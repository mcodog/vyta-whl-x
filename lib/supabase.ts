import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://wlnygrgwgfhlvhcvhseb.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Single shared client for client-side usage
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role key (bypasses RLS) for API routes
export function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Database types
export interface Affiliate {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  wallet_address: string | null;
  password_hash: string;
  active: boolean;
  /**
   * When true, customers bound to this affiliate must supply the referral code
   * (typed in or via a ?ref= link) for the affiliate discount to apply — being
   * bound alone no longer auto-locks the order to this affiliate. Default false.
   */
  manual_code_only: boolean;
  total_earnings: number;
  /**
   * Currency the affiliate is quoted/invoiced/paid in ("CAD" or "USD"). NOT a
   * column on `affiliates`: it's read from — and written to — the affiliate's
   * own `customers` row (shared id = affiliates.id = customers.id), which is the
   * single source of truth the invoice form and price-list logic already key
   * off. Populated by the admin sales-people endpoints; toggled from the Sales
   * People page. Undefined when not surfaced. See ADR 0003.
   */
  price_currency?: InvoiceCurrency;
  created_at: string;
  updated_at: string;
}

export interface ReferralCode {
  id: string;
  affiliate_id: string;
  code: string;
  active: boolean;
  uses_count: number;
  created_at: string;
}

export interface Commission {
  id: string;
  affiliate_id: string;
  order_id: string;
  referral_code_id: string | null;
  amount: number;
  order_total: number;
  commission_rate: number;
  status: "pending" | "paid" | "cancelled";
  paid_at: string | null;
  created_at: string;
}

export type UserRole = "customer" | "affiliate" | "assistant" | "admin" | "warehouse" | "analytics";

/** How an order/invoice is handed off to the customer. */
export type FulfillmentType = "shipment" | "pickup";

/** Warehouse workflow stage for getting an order out the door. */
export type FulfillmentStatus =
  | "pending"
  | "packed"
  | "shipped"
  | "picked_up"
  | "dropped_off";

export interface Customer {
  id: string;
  email: string;
  /** Optional secondary/backup email. Informational only — not used for auth. */
  alternate_email: string | null;
  first_name: string;
  last_name: string;
  password_hash: string;
  wallet_address: string | null;
  phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  is_admin: boolean;
  role: UserRole;
  /** The affiliate this customer is bound to (first-touch referral). */
  affiliate_id: string | null;
  /**
   * Derived (not a customers column): whether the bound affiliate is flagged
   * `manual_code_only`. Populated by /api/auth/customer so the checkout knows
   * not to auto-apply the affiliate discount from the binding alone. Undefined
   * when the customer isn't bound to an affiliate.
   */
  affiliate_manual_code_only?: boolean;
  /**
   * The PRIMARY sales person auto-filled on new invoices for this customer —
   * position 0 of `sales_people` below, mirrored here so every legacy reader
   * keeps working. Set from the invoice form's "Save this sales team to the
   * customer" checkbox; null means no default. Cleared if the sales person is
   * deleted.
   */
  default_sales_person_id: string | null;
  /**
   * The customer's full sales team (up to five), each with the commission rate
   * they earn on this customer's invoices. Joined by the customers API; the
   * rows live in `customer_sales_persons`. Ordered primary-first.
   */
  sales_people?: CustomerSalesPerson[];
  active: boolean;
  /** Currency this customer is quoted/invoiced in. New invoices default to it. */
  price_currency: InvoiceCurrency;
  /**
   * Storefront only. When false (the default) this customer's configured prices
   * are shown and charged **as-is**, merely denominated in `price_currency` — a
   * list configured at 156 reads "$156.00 USD". When true they are converted at
   * the store's `usd_exchange_rate`. Admin-created invoices ignore this.
   */
  convert_storefront_prices?: boolean;
  /**
   * Whether new invoices for this customer default to WITH product labels (the
   * sticker on each vial — not the shipping label) or without. Default true.
   */
  default_with_labels: boolean;
  allow_pickup: boolean;
  allow_shipping: boolean;
  /** Whether this (warehouse) account may send customer fulfillment emails. */
  can_send_fulfillment_emails: boolean;
  last_login_at: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export type CryptoChain = "btc" | "eth" | "sol";

export interface Order {
  id: string;
  customer_id: string | null;
  order_number: string;
  items: {
    name: string;
    quantity: number;
    price: number;
    strength?: string;
    product_id?: string;
  }[];
  total: number;
  email: string | null;
  shipping_address: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
  } | null;
  crypto: CryptoChain;
  status:
    | "pending"
    | "received"
    | "confirmed"
    | "expired"
    | "processing"
    | "shipped"
    | "delivered"
    | "cancelled";
  payment_address: string | null;
  payment_amount_expected: string | null;
  payment_amount_received: string | null;
  payment_tx_hash: string | null;
  payment_derivation_index: number | null;
  payment_confirmations: number;
  payment_confirmed_at: string | null;
  payment_expires_at: string | null;
  /** Manually recorded payment method (admin): etransfer/crypto/credit_card/other. */
  payment_method: RecordedPaymentMethod | null;
  /** Date/time a manually recorded payment was received. */
  payment_received_at: string | null;
  /** Whether the recorded payment covered the order in full or partially. */
  payment_received_status: "full" | "partial" | null;
  /** Dollar amount recorded as received (full total, or the partial figure). */
  payment_received_amount: number | null;
  referral_code: string | null;
  /** Affiliate discount applied to the product subtotal (0 when none). */
  discount_amount: number | null;
  /** Whether the order ships to the customer or is collected in person. */
  fulfillment_type: FulfillmentType | null;
  tracking_number: string | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_name: string;
  product_id: string | null;
  quantity: number;
  price_at_time: number;
  strength: string | null;
  /**
   * Whether this line was bought at the box (pack of 10) or single-vial price.
   * Null on orders placed before vial pricing shipped — render no tag then.
   */
  price_type: "box" | "vial" | null;
  created_at: string;
}

/**
 * `pending_payment` is an invoice raised by a hosted checkout that is waiting on
 * the customer to pay at the gateway. It is deliberately not `sent` (nothing was
 * emailed, and `sent` is swept to `overdue`) and not `draft` (the warehouse
 * treats non-draft as preppable work). See
 * puramass-pending-payment-invoice-migration.sql.
 */
export type InvoiceStatus =
  | "draft"
  | "pending_payment"
  | "sent"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled";

/** Ordinary invoice vs. a prepaid procurement invoice (client pays up front so
 *  we order the items from suppliers via attached purchase orders). */
export type InvoiceType = "standard" | "prepaid";

/** Currency an invoice is denominated/paid in. Amounts are not converted. */
export type InvoiceCurrency = "CAD" | "USD";

/** Who entered an invoice — the role of the creator at creation time. Staff
 *  ('admin'/'assistant'), a client portal user ('affiliate'), or the store
 *  auto-generating one from a customer's checkout ('system'). */
export type InvoiceCreatorRole = "admin" | "assistant" | "affiliate" | "system";

export type PaymentMethod = "card" | "e-transfer" | "cash" | "crypto" | "other";

/** Payment method captured when an admin manually records an order payment. */
export type RecordedPaymentMethod = "etransfer" | "crypto" | "credit_card" | "other";

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  /** Whether the unit price came from the box (pack of 10) or vial price. */
  price_type: "box" | "vial";
  /** Supplier chosen to procure this line (prepaid invoices). Defaults to the
   *  cheapest supplier in the UI; drives the Supplier Purchase Orders panel. */
  preferred_supplier_id: string | null;
  /** Quantity the warehouse has packed/fulfilled for this line. */
  qty_fulfilled: number;
  /** Quantity moved to the bound backorder invoice for this line. */
  qty_backordered: number;
  created_at: string;
  /** Optionally joined product fields, present when the query nests the
   *  product relation. `vials_per_box` drives the box→vial conversion. */
  product?: { sku?: string | null; vials_per_box?: number | null } | null;
}

/** A photo of the packed products attached to an invoice. */
export interface PackedPhoto {
  url: string;
  path: string;
  uploaded_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  reference_note: string | null;
  paid_at: string;
  recorded_by: string | null;
  created_at: string;
  /**
   * Customer payment-confirmation email tracking, set when the payment is
   * recorded via the confirmation modal. `email_requested` is null on payments
   * recorded before this feature shipped (status untracked), false when the
   * admin chose not to notify the customer, and true when a send was requested.
   * `email_sent_at` is set only on a successful send; `email_error` holds the
   * reason a requested send failed. `email_sent_by_email` is the admin who
   * triggered the send, denormalised for display.
   */
  email_requested?: boolean | null;
  email_sent_at?: string | null;
  email_error?: string | null;
  email_to?: string | null;
  email_sent_by?: string | null;
  email_sent_by_email?: string | null;
}

export interface SalesPerson {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  commission_rate: number;
  notes: string | null;
  active: boolean;
  total_earnings: number;
  /**
   * Default per-line discount presets (%) pre-filled on this sales person's
   * invoices: `default_box_discount_pct` on box (pack-of-10) lines,
   * `default_vial_discount_pct` on single-vial lines. 0 = no preset. Just
   * defaults — editable/removable per line. See
   * sales-person-line-discount-presets-migration.sql.
   */
  default_box_discount_pct?: number;
  default_vial_discount_pct?: number;
  /**
   * Links this sales person to a login account (customers.id = affiliates.id =
   * auth uid) when they are an affiliate. NULL for a contact-only "Rep" who has
   * no login. Enforced 1:1 for affiliates by the partial unique index
   * `uniq_sales_persons_user_id`. See ADR 0003.
   */
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One member of an invoice's commission roster (`invoice_sales_persons`). Up to
 * five per invoice; position 0 is the primary and is mirrored onto
 * `invoices.sales_person_id` + `sales_person_commission_rate/_amount`.
 *
 * Rates are independent, not slices of one pot: each person earns
 * `invoice total x their own rate`, so the rates may sum past 100%.
 */
export interface InvoiceSalesPerson {
  id?: string;
  invoice_id?: string;
  sales_person_id: string;
  /** Percent (5 = 5%). */
  commission_rate: number;
  /** invoice total x rate, snapshotted at write time. */
  commission_amount: number;
  /** 0 = primary. */
  position: number;
  created_at?: string;
  /** Joined by the API for display. */
  sales_person?: Pick<SalesPerson, "id" | "first_name" | "last_name" | "email"> | null;
}

/**
 * One member of a customer's sales team (`customer_sales_persons`) — who is
 * assigned to the customer and at what rate. Pre-fills the invoice form; an
 * invoice snapshots its own rates once raised.
 */
export interface CustomerSalesPerson {
  id?: string;
  customer_id?: string;
  sales_person_id: string;
  /** Percent (5 = 5%) earned on this customer's invoices. */
  commission_rate: number;
  /** 0 = primary (mirrored onto customers.default_sales_person_id). */
  position: number;
  /** Joined by the API for display. */
  sales_person?: Pick<
    SalesPerson,
    "id" | "first_name" | "last_name" | "email" | "active" | "commission_rate"
  > | null;
}

export type SalesCommissionStatus = "pending" | "paid" | "cancelled";

export interface SalesCommission {
  id: string;
  sales_person_id: string;
  invoice_id: string | null;
  amount: number;
  invoice_total: number;
  commission_rate: number;
  status: SalesCommissionStatus;
  paid_at: string | null;
  created_at: string;
}

/**
 * An end-recipient ("client") of a customer. When a customer (typically a
 * reseller) orders items that ship to their own client, the client is recorded
 * here and reused across invoices. Only `address` is required.
 */
export interface CustomerClient {
  id: string;
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  /** True when the linked customer record was deleted after this invoice was
   *  created (customer_id is cleared, but the snapshot name/email is kept).
   *  Shown as a tag in the admin UI only — never on the printed document. */
  customer_deleted: boolean;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax_total: number;
  shipping_cost: number;
  /**
   * Whether this invoice's hosted-checkout payment link charges shipping.
   *
   * Off by default (and absent on a database that hasn't run the migration,
   * which reads the same): the hand-off then sends `shipping_total_cents: 0`,
   * so the link bills the items only. Ticked on the invoice, its
   * `shipping_cost` is wired into the payload instead.
   */
  charge_shipping_on_checkout?: boolean;
  total: number;
  status: InvoiceStatus;
  /** Currency the invoice is paid in ("CAD" or "USD"); amounts aren't converted. */
  currency: InvoiceCurrency;
  /** Whether the order ships with product labels applied. */
  with_labels: boolean;
  /** Flat processing fee (typically for self-pickup invoices). */
  processing_fee: number;
  /** When true, the processing fee is applied to the total and shown on the PDF. */
  show_processing_fee: boolean;
  /** Ordinary invoice, or a "prepaid" invoice a client pays up front so we can
   *  procure the items from our suppliers (drives the Supplier Purchase Orders
   *  panel + attached POs). Defaults to 'standard'. */
  invoice_type: InvoiceType;
  /** Whether this invoice ships to the customer or is collected in person. */
  fulfillment_type: FulfillmentType;
  /** Warehouse workflow stage (pending → packed → shipped/picked_up). */
  fulfillment_status: FulfillmentStatus;
  /** Who packed the order and when (set by warehouse staff). */
  packed_at: string | null;
  packed_by: string | null;
  /** Who completed fulfillment (shipped/picked up) and when. */
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  /** When the "packed/ready" and "shipped" customer notifications were sent. */
  packed_emailed_at: string | null;
  shipped_emailed_at: string | null;
  notes: string | null;
  /**
   * The PRIMARY sales person and their commission — position 0 of
   * `sales_people`, mirrored onto the invoice so affiliate scoping, analytics,
   * genealogy and the list filter keep reading one stable column.
   */
  sales_person_id: string | null;
  sales_person_commission_rate: number;
  sales_person_commission_amount: number;
  is_backorder: boolean;
  /** True once the invoice's paid transition decremented product stock. Set by
   *  adjust_stock_for_invoice() and cleared by restore_stock_for_invoice(); used
   *  to guard stock restoration on cancel / payment reversal. */
  stock_adjusted?: boolean;
  parent_invoice_id: string | null;
  /** Warehouse backorder invoices are non-payable (track what's still owed). */
  non_payable: boolean;
  /** Handling-step keys the warehouse has checked off for this invoice. */
  handling_checklist: string[];
  /** Photos of the packed products. */
  packed_photos: PackedPhoto[];
  last_emailed_at: string | null;
  last_emailed_by: string | null;
  last_emailed_by_email: string | null;
  /** "Email Customer" quick actions on the invoice screen: when/who last sent
   *  the order-confirmation and shipping-notification emails. */
  order_confirmation_emailed_at: string | null;
  order_confirmation_emailed_by: string | null;
  order_confirmation_emailed_by_email: string | null;
  shipping_notification_emailed_at: string | null;
  shipping_notification_emailed_by: string | null;
  shipping_notification_emailed_by_email: string | null;
  /** True when this invoice's items ship to the customer's client (see client). */
  ships_to_client: boolean;
  /** The end-recipient this invoice ships to, when ships_to_client is set. */
  client_id: string | null;
  /** When the Packing List was last emailed to the client (and to whom/by whom). */
  packing_list_emailed_at: string | null;
  packing_list_emailed_by: string | null;
  packing_list_emailed_to: string | null;
  /** Who entered this invoice: the customers.id of the admin/assistant/affiliate
   *  who created it, or NULL for store-generated (checkout) invoices. */
  created_by: string | null;
  /** The creator's role at creation time — 'admin' | 'assistant' | 'affiliate'
   *  | 'system'. Drives the "Source" tag/filter on the invoices list
   *  ('affiliate' shows as "Client", 'system' as "Online"). NULL on legacy rows
   *  created before creator tracking existed. */
  created_by_role: InvoiceCreatorRole | null;
  /* --- Invoice payment request (the "pay this invoice" email + page) ------- */
  /** Unguessable token in the emailed link (/pay/<token>). Minted on the first
   *  payment-email send and reused on every resend. */
  payment_token: string | null;
  payment_token_created_at: string | null;
  /** When/who/where the payment-request email was last sent. Distinct from
   *  last_emailed_* which tracks the invoice-PDF email. */
  payment_email_sent_at: string | null;
  payment_email_sent_by: string | null;
  payment_email_sent_by_email: string | null;
  payment_email_to: string | null;
  payment_email_count: number;
  /** What the customer chose on the payment page. NULL until they choose. */
  payment_method_selected: InvoicePaymentMethodChoice | null;
  payment_method_selected_at: string | null;
  /** Crypto path: the wallet they were shown, and the transaction reference
   *  they handed back (informational until an admin records the payment). */
  crypto_wallet_id: string | null;
  crypto_payment_reference: string | null;
  crypto_payment_declared_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined / derived (populated by API)
  customer?: Customer | null;
  client?: CustomerClient | null;
  sales_person?: SalesPerson | null;
  /** Every sales person credited on this invoice (up to five), primary first. */
  sales_people?: InvoiceSalesPerson[];
  line_items?: InvoiceLineItem[];
  payments?: Payment[];
  amount_paid?: number;
  amount_due?: number;
  status_effective?: InvoiceStatus;
  /** Email of the staff member who sent the Packing List, resolved from
   *  packing_list_emailed_by by the detail API for display. */
  packing_list_emailed_by_email?: string | null;
  /** Display name of whoever entered the invoice, resolved from created_by by
   *  the list API (for the Source tag's tooltip). Null when unknown/system. */
  created_by_name?: string | null;
  /** The order this invoice is bound to (1:1), when one exists. */
  order?: InvoiceLinkedOrder | null;
  /** Stealth Health hand-offs created from this invoice's payment page (newest
   *  first), carrying the payment link and when it was created. Detail API only. */
  payment_handoffs?: InvoicePaymentHandoff[];
  /** The payment page's timeline for this invoice (newest first). Detail API only. */
  payment_events?: InvoicePaymentEvent[];
}

/** How a customer chose to pay from the invoice payment page. */
export type InvoicePaymentMethodChoice = 'crypto' | 'card';

/**
 * A Stealth Health (PuraMass) hosted-checkout hand-off created for an invoice
 * from its payment page. `payment_link` is the URL the customer was sent to —
 * it can be resent, and `created_at` says when it was issued.
 */
export interface InvoicePaymentHandoff {
  id: string;
  transaction_id: string | null;
  payment_link: string | null;
  /**
   * payment_pending | paid | expired | cancelled, plus our own `superseded` —
   * a pending hand-off retired because a newer link replaced it. The PuraMass
   * order itself is untouched (there is no cancel), so a superseded link can
   * still be paid; the webhook settles this invoice either way.
   */
  status: string;
  subtotal_cents: number | null;
  currency: string | null;
  paid_at: string | null;
  created_at: string;
}

/** One entry in an invoice's customer-facing payment timeline. */
export interface InvoicePaymentEvent {
  id: string;
  event_type:
    | 'link_created'
    | 'email_sent'
    | 'page_viewed'
    | 'method_selected'
    | 'checkout_created'
    | 'crypto_declared'
    | 'paid'
    | 'failed';
  method: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/**
 * The snapshot of a bound order returned alongside an invoice by the detail
 * API. Every invoice is meant to have one, but some legacy invoices don't —
 * consumers must treat this as possibly null and fall back gracefully.
 */
export interface InvoiceLinkedOrder {
  id: string;
  order_number: string | null;
  status: string | null;
  tracking_number: string | null;
  tracking_status: string | null;
  tracking_url: string | null;
  carrier: string | null;
  easyship_shipment_id: string | null;
  label_state: string | null;
  shipping_address: Order["shipping_address"] | null;
  notes: string | null;
  fulfillment_type: FulfillmentType | null;
  order_items?: Array<{
    id: string;
    product_name: string | null;
    product_id: string | null;
    quantity: number;
    price_at_time: number;
    strength: string | null;
    price_type: "box" | "vial" | null;
  }>;
}

export interface InvoiceEmailLogEntry {
  id: string;
  invoice_id: string;
  sent_by: string | null;
  sent_by_email: string | null;
  to_email: string;
  bcc_emails: string[];
  subject: string;
  message_id: string | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

/** Category key for a changelog entry. Free text in the DB, but the UI knows
 *  this canonical set (badge colours/labels live in lib/admin/changelog.ts). */
export type ChangelogCategory =
  | "admin"
  | "storefront"
  | "feature"
  | "patch"
  | "bugfix"
  | "performance"
  | "security"
  | "api"
  | "database"
  | "ui"
  | "mobile";

/** How impactful a change is, shown as a badge on the card. */
export type ChangelogImpact = "critical" | "major" | "minor";

/** A related link or attachment on a changelog entry. */
export interface ChangelogLink {
  label: string;
  url: string;
}

/** A single entry on the admin changelog timeline. */
export interface ChangelogEntry {
  id: string;
  category: ChangelogCategory;
  title: string;
  summary: string;
  /** Full details in markdown (shown in the Read More drawer). */
  body: string | null;
  author: string | null;
  version: string | null;
  impact: ChangelogImpact | null;
  tags: string[];
  affected_areas: string[];
  links: ChangelogLink[];
  /** Timestamp the entry is dated/grouped by (editable so entries can be backdated). */
  entry_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteSettings {
  checkout_type: 'email' | 'crypto';
  admin_emails: string[];
  pickup_address: string;
  guest_checkout_enabled: boolean;
  invoice_cc_emails: string[];
  invoice_customer_email_subject: string;
  invoice_customer_email_body: string;
  invoice_admin_email_subject: string;
  invoice_admin_email_body: string;
}

export interface AgingBucket {
  label: "current" | "1-30" | "31-60" | "61-90" | "90+";
  count: number;
  total: number;
}

export interface AnalyticsSummary {
  inventory: {
    units: number;
    value: number;
    sku_count: number;
    low_stock_count: number;
  };
  incoming: {
    units: number;
    value: number;
    po_count: number;
    pos: Array<{
      id: string;
      po_number: string;
      supplier_name: string | null;
      status: PurchaseOrderStatus;
      total: number;
      expected_date: string | null;
    }>;
  };
  revenue: {
    invoiced: number;
    paid: number;
    outstanding: number;
    invoice_count: number;
    paid_invoice_count: number;
    /** Revenue split by the currency each invoice is denominated in. Amounts
     *  are NOT converted — CAD figures sum CAD invoices, USD figures sum USD
     *  invoices, so the two are tracked and reported separately. */
    by_currency: Record<InvoiceCurrency, CurrencyRevenue>;
    /** Audit list for the range ("which invoices are in this number?"). Includes
     *  every revenue invoice feeding the figures above, PLUS draft invoices for
     *  visibility — drafts are tagged `status: "draft"` and are NOT counted in
     *  invoiced/paid/outstanding. Sorted newest issue date first. */
    invoices: RevenueInvoice[];
    range: { from: string | null; to: string | null };
  };
  /** Shipping billed / collected across the same invoices as `revenue`. */
  shipping: ShippingEarnings;
  /** Leaderboards for the Performance section. Amounts are nominal totals summed
   *  across currencies (CAD + USD), matching how the customer/affiliate reports
   *  already tally lifetime spend. */
  performance: {
    top_customers: PerformanceEntry[];
    top_sales_persons: PerformanceEntry[];
    top_affiliates: PerformanceEntry[];
    top_products: ProductPerformanceEntry[];
  };
}

/** One invoice that contributes to the revenue figures for a range. A lightweight
 *  projection of {@link Invoice} — just what the audit list in the Analytics
 *  Revenue section renders. */
export interface RevenueInvoice {
  id: string;
  invoice_number: string;
  issue_date: string | null;
  /** Resolved display name (linked customer, else the guest name on the invoice). */
  customer_name: string | null;
  /** Effective status (overdue computed live), matching the invoices list view. */
  status: InvoiceStatus;
  currency: InvoiceCurrency;
  /** Invoice total (nominal, in its own currency). */
  total: number;
  /** Amount collected against this invoice (capped at total). */
  paid: number;
}

/** One row in a revenue leaderboard (customer / sales person / affiliate). */
export interface PerformanceEntry {
  id: string | null;
  name: string;
  /** Total invoiced (nominal, all currencies). */
  revenue: number;
  /** Total collected against those invoices. */
  paid: number;
  /** Number of invoices attributed to this entity. */
  invoice_count: number;
  /** Sales-person commission earned (only set for sales persons). */
  commission?: number;
}

/** One row in the top-selling-products leaderboard. */
export interface ProductPerformanceEntry {
  id: string | null;
  name: string;
  /** Units sold across the matched invoices. */
  units: number;
  /** Revenue from those units (nominal, all currencies). */
  revenue: number;
}

/** Revenue figures for a single currency (see AnalyticsSummary.revenue). */
export interface CurrencyRevenue {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoice_count: number;
  paid_invoice_count: number;
}

/** Shipping figures for a single currency (see AnalyticsSummary.shipping). */
export interface ShippingCurrencyEarnings {
  /** Shipping billed on invoices in this currency. */
  charged: number;
  /** Share of that shipping already collected (pro-rated by payment). */
  collected: number;
  /** charged − collected, never negative. */
  uncollected: number;
  /** Invoices in this currency carrying a shipping charge. */
  invoice_count: number;
}

/**
 * What the business earns on shipping: the shipping line billed on revenue
 * invoices, handling markup included. Carrier cost is never persisted (Easyship
 * rates are quoted live at checkout), so these are GROSS shipping revenue
 * figures, not a margin over what the courier charged.
 */
export interface ShippingEarnings {
  /** Shipping billed across the range (nominal, CAD + USD combined). */
  charged: number;
  /** Collected portion — each invoice's shipping pro-rated by how much of the
   *  invoice has been paid. */
  collected: number;
  /** charged − collected, never negative. */
  uncollected: number;
  /** Invoices carrying a shipping charge (shipping_cost > 0). */
  invoice_count: number;
  /** charged / invoice_count. */
  avg_per_invoice: number;
  /** Shipping as a percentage of total invoiced revenue for the same range. */
  share_of_invoiced: number;
  /** Split by the currency each invoice is denominated in (never converted). */
  by_currency: Record<InvoiceCurrency, ShippingCurrencyEarnings>;
  /** Per-month trend keyed 'YYYY-MM', oldest first. Only months with billed
   *  shipping appear. */
  monthly: Array<{ month: string; charged: number; collected: number }>;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierPrice {
  id: string;
  supplier_id: string;
  product_id: string;
  price: number;
  created_at: string;
  updated_at: string;
}

/** A product row in a supplier's pricelist editor (joined with products). */
export interface SupplierPriceRow {
  product_id: string;
  name: string;
  sku: string | null;
  strength: string | null;
  original_price: number;
  /** null when the supplier has no explicit price (falls back to original_price). */
  supplier_price: number | null;
}

/** Cheapest supplier for a product, keyed by product_id. */
export interface CheapestSupplierPrice {
  supplier_id: string;
  supplier_name: string;
  price: number;
}

export type PurchaseOrderStatus =
  | "pending"
  | "partially_fulfilled"
  | "fulfilled"
  | "paid"
  | "cancelled";

export type PurchaseOrderTaxType = "percentage" | "fixed";

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  description: string;
  sku_snapshot: string | null;
  qty: number;
  qty_received: number;
  unit_price: number;
  line_total: number;
  /** Whether the unit price came from the box (pack of 10) or vial price. */
  price_type: "box" | "vial";
  /**
   * True per-unit cost after this line's share of order-level shipping and
   * discount is folded in (allocated by value). The cost basis for COGS /
   * margin; `unit_price` is the raw supplier price before allocation.
   */
  landed_unit_cost: number;
  /** landed_unit_cost × qty — reconciles to subtotal + shipping − discount. */
  landed_line_total: number;
  created_at: string;
  /** Joined product, used to convert box lines to vials when receiving. */
  product?: Pick<Product, "vials_per_box"> | null;
}

export interface PurchaseOrderReceiptItem {
  id: string;
  receipt_id: string;
  po_item_id: string;
  product_id: string | null;
  qty: number;
  created_at: string;
}

export interface PurchaseOrderReceipt {
  id: string;
  purchase_order_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  items?: PurchaseOrderReceiptItem[];
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: PurchaseOrderStatus;
  subtotal: number;
  shipping_fee: number;
  discount_type: PurchaseOrderTaxType;
  discount_value: number;
  discount: number;
  tax_type: PurchaseOrderTaxType;
  tax_value: number;
  tax_total: number;
  total: number;
  notes: string | null;
  order_date: string | null;
  expected_date: string | null;
  inventory_applied: boolean;
  inventory_applied_at: string | null;
  /** The prepaid invoice this PO was generated from, when applicable. */
  source_invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier?: Supplier | null;
  items?: PurchaseOrderItem[];
  receipts?: PurchaseOrderReceipt[];
}

export interface Pricelist {
  id: string;
  name: string;
  is_active: boolean;
  // Currency the item prices are stored in. USD lists show 1:1 on a USD invoice
  // (no exchange-rate conversion). Defaults to CAD.
  currency?: InvoiceCurrency;
  description?: string | null;
  created_at: string;
  updated_at: string;
  // Joined / derived (populated by API)
  items?: PricelistItem[];
  item_count?: number;
}

export interface PricelistItem {
  id: string;
  pricelist_id: string;
  product_id: string;
  price: number;
  // Unlabeled (base) price; null falls back to `price` (the labeled value).
  unlabeled_price?: number | null;
  created_at: string;
  updated_at: string;
  // Joined / derived (populated by API)
  product?: Pick<Product, "id" | "name" | "slug" | "strength" | "price"> | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  /**
   * Optional explicit USD price. When null the USD price is computed as
   * price × the global usd_exchange_rate (see lib/pricing.ts).
   */
  price_usd: number | null;
  /** Single-vial price. The UI falls back to price/10 when this is null. */
  vial_price: number | null;
  /** On-hand stock, counted in vials (the smallest unit we ship). */
  stock_quantity: number;
  /** How many vials make up one box. Purchase-order box lines convert to
   *  vials at this rate when received. Defaults to 10. */
  vials_per_box: number;
  low_stock_threshold: number;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
  /** When true, the storefront product cards lead with the box / packaging
   *  image (as the primary image) instead of the vial shot. Opt-in per
   *  product; defaults to false. */
  box_image_first?: boolean;
  strength: string | null;
  purity: string | null;
  form: string | null;
  featured: boolean;
  active: boolean;
  /** When true, offered as an upsell add-on in the cart and checkout. */
  is_checkout_addon?: boolean;
  created_at: string;
  updated_at: string;
  slug: string | null;
  description_short: string | null;
  benefits: string | null;
  mechanism: string | null;
  coa_url: string[];
  sku: string | null;
  /**
   * Internal free-text note, typed in the admin products cell-edit grid between
   * Stock (cases) and Case price. NULL / absent means no note.
   *
   * Never rendered outside that grid, and stripped from the public products API
   * (which selects `*`). It is not hidden from staff, though: the admin invoice
   * form also selects `*`, so an affiliate can see the field in that response.
   */
  grid_note?: string | null;
}
