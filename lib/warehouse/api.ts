import { supabase } from "@/lib/supabase";
import type {
  FulfillmentStatus,
  FulfillmentType,
  InvoiceStatus,
} from "@/lib/supabase";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------
export interface QueueLineItem {
  id: string;
  description: string;
  sku: string | null;
  qty: number;
  /** Quantity the warehouse has packed/fulfilled for this line. */
  qty_fulfilled: number;
  /** Quantity moved to the bound backorder invoice for this line. */
  qty_backordered: number;
  /** Whether the line was sold as a box (pack of N vials) or a single vial. */
  price_type: "box" | "vial";
  /** How many vials make up one box for this product (defaults to 10). */
  vials_per_box: number;
}

export interface PackedPhoto {
  url: string;
  path: string;
  uploaded_at: string;
}

export interface QueueItem {
  id: string; // invoice id
  invoice_number: string;
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  carrier: string | null;
  shipping_address: Record<string, any> | null;
  /** Easyship label state: not_created | pending | generated | failed. */
  label_state: string | null;
  label_url: string | null;
  has_label: boolean;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total: number;
  status: InvoiceStatus;
  /**
   * Origin of the invoice. 'stealth_health' = auto-created from a paid PuraMass
   * hosted-checkout order (the queue badges it and explains externally-managed
   * fields). null = normal in-house invoice.
   */
  source: string | null;
  /**
   * Whether the order ships with product labels applied to the vials (the
   * invoice's "With labels" toggle). Distinct from `has_label`, which is the
   * Easyship shipping label.
   */
  with_labels: boolean;
  fulfillment_type: FulfillmentType;
  fulfillment_status: FulfillmentStatus;
  packed_at: string | null;
  packed_by_name: string | null;
  fulfilled_at: string | null;
  fulfilled_by_name: string | null;
  packed_emailed_at: string | null;
  shipped_emailed_at: string | null;
  /** True when the items ship to the customer's client (Packing List flow). */
  ships_to_client: boolean;
  /** When the Packing List was last emailed to the client. */
  packing_list_emailed_at: string | null;
  /** Client (end-recipient) display info, when ships_to_client. */
  client_name: string | null;
  client_email: string | null;
  client_address: string | null;
  /** Whether this invoice has been manually removed from the active queue. */
  removed_from_queue: boolean;
  removed_at: string | null;
  /** Reason recorded when the order was cleared from the queue (if any). */
  removed_note: string | null;
  /** Name of the staff member who cleared/removed the order (if any). */
  removed_by_name: string | null;
  item_count: number;
  line_items: QueueLineItem[];
  /** Handling-step keys the warehouse has checked off for this invoice. */
  handling_checklist: string[];
  /** Photos of the packed products. */
  packed_photos: PackedPhoto[];
  created_at: string;
}

export interface QueueSummary {
  total: number;
  toFulfill: number;
  shipments: number;
  pickups: number;
}

export interface QueueViewer {
  role: string;
  can_send_emails: boolean;
}

export type NotificationKind = "packed" | "shipped";

export interface NotificationPreview {
  to: string;
  subject: string;
  body: string;
  default_subject: string;
  default_body: string;
}

// -------------------------------------------------------------------------
// Auth helpers
// -------------------------------------------------------------------------
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
    : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.error || `Request failed: ${res.status}`) as Error & {
      code?: string;
      status?: number;
    };
    error.code = err.code;
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/**
 * Open the full invoice (same document as Admin → Invoices) in a new tab.
 * Reuses the admin invoice PDF/HTML route; `download` triggers the print/save
 * dialog. Warehouse and admin roles are allowed by that route.
 */
export async function openInvoicePdf(invoiceId: string, download = true): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `/api/admin/invoices/${invoiceId}/pdf${download ? "?download=1" : ""}`;
  const res = await fetch(url, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not open the invoice");
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), "_blank");
}

// -------------------------------------------------------------------------
// Queue
// -------------------------------------------------------------------------
export async function getQueue(filters?: {
  fulfillment_status?: FulfillmentStatus;
  fulfillment_type?: FulfillmentType;
}): Promise<{
  items: QueueItem[];
  summary: QueueSummary;
  /** Days-old threshold at/after which a card is treated as "expired" (aged). */
  expired_days: number;
  viewer: QueueViewer;
}> {
  const params = new URLSearchParams();
  if (filters?.fulfillment_status) params.set("fulfillment_status", filters.fulfillment_status);
  if (filters?.fulfillment_type) params.set("fulfillment_type", filters.fulfillment_type);
  const qs = params.toString();
  return apiFetch(`/api/warehouse/queue${qs ? `?${qs}` : ""}`);
}

/**
 * Fetch a single invoice's fulfillment record (same shape as a queue item).
 * Used by the admin invoice page to show packed photos, per-line progress and
 * the handling checklist without loading the entire queue.
 */
export async function getQueueItem(
  invoiceId: string,
): Promise<{ item: QueueItem; viewer: QueueViewer }> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}`);
}

export async function updateFulfillmentStatus(
  invoiceId: string,
  status: FulfillmentStatus,
  opts?: { overrideNoLabel?: boolean },
): Promise<void> {
  await apiFetch(`/api/warehouse/queue/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fulfillment_status: status,
      ...(opts?.overrideNoLabel ? { override_no_label: true } : {}),
    }),
  });
}

/**
 * Remove an invoice from the active queue (or restore it). Pass a `note` when
 * clearing to record why — it's stored and shown in the "Fulfilled / Removed"
 * view. Restoring clears any previously stored note.
 */
export async function setQueueRemoved(
  invoiceId: string,
  removed: boolean,
  note?: string,
): Promise<void> {
  await apiFetch(`/api/warehouse/queue/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify({
      removed_from_queue: removed,
      ...(removed && note?.trim() ? { removed_note: note.trim() } : {}),
    }),
  });
}

/** Take a draft invoice out of "draft" status (→ "sent") so it can be fulfilled. */
export async function markInvoiceReady(invoiceId: string): Promise<void> {
  await apiFetch(`/api/warehouse/queue/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify({ undraft: true }),
  });
}

// ---- Handling checklist -------------------------------------------------
/** Persist the set of checked handling-step keys for an invoice. */
export async function saveChecklist(
  invoiceId: string,
  checklist: string[],
): Promise<void> {
  await apiFetch(`/api/warehouse/queue/${invoiceId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({ checklist }),
  });
}

// ---- Per-line fulfillment / backorder -----------------------------------
/** Mark a quantity of a line item as packed/fulfilled. */
export async function fulfillLine(
  invoiceId: string,
  lineItemId: string,
  qty: number,
): Promise<void> {
  await apiFetch(`/api/warehouse/queue/${invoiceId}/line`, {
    method: "POST",
    body: JSON.stringify({ action: "fulfill", line_item_id: lineItemId, qty }),
  });
}

/**
 * Move a quantity of a line item onto the invoice's single bound backorder
 * invoice (created the first time, then reused).
 */
export async function backorderLine(
  invoiceId: string,
  lineItemId: string,
  qty: number,
): Promise<{ backorder_invoice_id: string; backorder_invoice_number: string }> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}/line`, {
    method: "POST",
    body: JSON.stringify({ action: "backorder", line_item_id: lineItemId, qty }),
  });
}

// ---- Packed photos ------------------------------------------------------
export async function uploadPackedPhoto(
  invoiceId: string,
  file: File,
): Promise<{ photo: PackedPhoto; packed_photos: PackedPhoto[] }> {
  const form = new FormData();
  form.append("file", file);
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/warehouse/queue/${invoiceId}/photo`, {
    method: "POST",
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deletePackedPhoto(
  invoiceId: string,
  path: string,
): Promise<{ packed_photos: PackedPhoto[] }> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}/photo`, {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

// ---- Customer notifications (packed / shipped) --------------------------
export async function previewNotification(
  invoiceId: string,
  kind: NotificationKind,
): Promise<NotificationPreview> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}/notify`, {
    method: "POST",
    body: JSON.stringify({ kind, preview: true }),
  });
}

export async function sendNotification(
  invoiceId: string,
  kind: NotificationKind,
  payload: { to: string; subject: string; body: string },
): Promise<{ ok: true; to: string }> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}/notify`, {
    method: "POST",
    body: JSON.stringify({ kind, ...payload }),
  });
}

// ---- Packing list (client shipments) ------------------------------------
/**
 * Send (or re-send) the Packing List to the customer's client. Optional `to`
 * overrides the recipient (else resolved server-side from client → customer →
 * default). Returns the address it was sent to.
 */
export async function sendPackingList(
  invoiceId: string,
  to?: string,
): Promise<{ ok: true; to: string }> {
  return apiFetch(`/api/warehouse/queue/${invoiceId}/packing-list`, {
    method: "POST",
    body: JSON.stringify(to ? { to } : {}),
  });
}

// -------------------------------------------------------------------------
// Handling instructions (per fulfillment method)
// -------------------------------------------------------------------------
// Each step maps to the fulfillment_status it represents so the dashboard can
// highlight where an order is in the workflow.
export interface FulfillmentStep {
  /** Stable key used to persist the checklist state. */
  key: string;
  /** The status this step is associated with (for reference). */
  status: FulfillmentStatus;
  label: string;
  detail: string;
}

export const SHIPMENT_STEPS: FulfillmentStep[] = [
  {
    key: "verify",
    status: "pending",
    label: "Verify line items",
    detail: "Confirm every item and quantity on the invoice is in hand and correct.",
  },
  {
    key: "pack",
    status: "packed",
    label: "Pack the order",
    detail: "Pack items securely. Mark as Packed when the parcel is sealed and ready.",
  },
  {
    key: "label",
    status: "shipped",
    label: "Attach shipping label & hand off",
    detail: "Print and attach the shipping label, then hand the parcel to the courier. Marking Shipped updates the system and the order status.",
  },
];

export const PICKUP_STEPS: FulfillmentStep[] = [
  {
    key: "verify",
    status: "pending",
    label: "Verify line items",
    detail: "Confirm every item and quantity on the invoice is in hand and correct.",
  },
  {
    key: "pack",
    status: "packed",
    label: "Pack & set aside for pickup",
    detail: "Pack the items and label the package with the order number. Mark as Packed when it's ready for collection.",
  },
  {
    key: "handoff",
    status: "picked_up",
    label: "Hand to customer",
    detail: "Confirm the customer's identity / order number and hand over the package. Marking Picked Up updates the system and the order status.",
  },
];

export function stepsFor(type: FulfillmentType): FulfillmentStep[] {
  return type === "pickup" ? PICKUP_STEPS : SHIPMENT_STEPS;
}

const STATUS_ORDER: Record<FulfillmentStatus, number> = {
  pending: 0,
  packed: 1,
  shipped: 2,
  picked_up: 2,
  dropped_off: 2,
};

/** Index of the current status within the step list (for progress display). */
export function currentStepIndex(status: FulfillmentStatus): number {
  return STATUS_ORDER[status];
}

export function isComplete(status: FulfillmentStatus): boolean {
  return status === "shipped" || status === "picked_up" || status === "dropped_off";
}

const STATUS_LABELS: Record<FulfillmentStatus, string> = {
  pending: "To pack",
  packed: "Packed",
  shipped: "Shipped",
  picked_up: "Picked up",
  dropped_off: "Dropped off",
};

export function statusLabel(status: FulfillmentStatus): string {
  return STATUS_LABELS[status];
}

/** Short relative time like "2m ago", "3h ago", "Apr 5". */
export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Absolute, human-readable timestamp for the "shipped by … at …" line. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
