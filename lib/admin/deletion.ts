import { supabase } from "@/lib/supabase";

// Shared types + client helpers for the pre-delete "review & decide" flow used
// on the Customers, Sales People and Users pages. The heavy lifting (gathering
// the review and executing the plan) lives server-side in
// lib/admin/deletion-execute.ts behind /api/admin/deletion-review; this module
// is what the browser talks to.

export type DeletionKind = "customer" | "sales_person" | "user" | "affiliate";

// What to do with the kept records. Invoices are NEVER deleted (financial
// records) — they are either re-homed onto a guest placeholder or left detached
// with their customer snapshot. Ship-to clients may be moved or removed.
export type InvoiceDisposition = "reassign" | "detach";
export type ClientDisposition = "reassign" | "delete";

export interface DeletionPlan {
  /** Save a full JSON archive before deleting (stored + downloadable). */
  snapshot: boolean;
  /** Customer/User: what happens to their invoices. */
  invoices: InvoiceDisposition;
  /** Customer/User: what happens to their storefront orders. */
  orders: InvoiceDisposition;
  /** Customer/User: what happens to their saved ship-to clients. */
  clients: ClientDisposition;
  /** Optional label override for the guest placeholder record. */
  guestName?: string | null;
}

export interface ReviewInvoice {
  id: string;
  invoice_number: string | null;
  status: string;
  status_effective?: string;
  currency: string;
  total: number;
  amount_paid: number;
  amount_due: number;
  issue_date: string | null;
}

export interface ReviewClient {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
}

export interface ReviewCommission {
  id: string;
  amount: number;
  base: number;
  status: string;
  reference: string | null;
}

export interface DeletionReview {
  kind: DeletionKind;
  id: string;
  name: string;
  email: string | null;
  label: string;
  hasLogin: boolean;
  isAffiliate: boolean;
  isSalesPerson: boolean;
  counts: {
    invoices: number;
    orders: number;
    clients: number;
    commissions: number;
    payments: number;
  };
  money: {
    invoiced: { CAD: number; USD: number };
    outstanding: { CAD: number; USD: number };
    paidCommissions: number;
  };
  invoices: ReviewInvoice[];
  clients: ReviewClient[];
  commissions: ReviewCommission[];
  /** Affiliate only: customers referred by this affiliate (kept, just unlinked). */
  downline?: number;
}

export interface DeletionResult {
  success: boolean;
  error?: string;
  snapshotId?: string | null;
  guestId?: string | null;
}

/** Sensible default plan given a review (reassign everything, snapshot on). */
export function defaultPlan(review: DeletionReview | null): DeletionPlan {
  const hasKeepableClients = (review?.counts.clients ?? 0) > 0;
  return {
    snapshot: true,
    invoices: "reassign",
    orders: "reassign",
    clients: hasKeepableClients ? "reassign" : "delete",
    guestName: null,
  };
}

/** Fetch the normalized review payload for one entity. */
export async function fetchDeletionReview(
  kind: DeletionKind,
  id: string,
): Promise<{ review?: DeletionReview; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { error: "Not authenticated" };

    const res = await fetch(
      `/api/admin/deletion-review?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Failed to load deletion review" };
    return { review: json.review as DeletionReview };
  } catch (e) {
    console.error("fetchDeletionReview error", e);
    return { error: "An unexpected error occurred" };
  }
}

/** Execute the deletion with the chosen plan. */
export async function executeDeletion(
  kind: DeletionKind,
  id: string,
  plan: DeletionPlan,
): Promise<DeletionResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { success: false, error: "Not authenticated" };

    const res = await fetch(`/api/admin/deletion-review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ kind, id, plan }),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error || "Failed to delete" };
    return {
      success: true,
      snapshotId: json.snapshotId ?? null,
      guestId: json.guestId ?? null,
    };
  } catch (e) {
    console.error("executeDeletion error", e);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/** Client-side download of the review as a JSON snapshot file. */
export function downloadReviewJson(review: DeletionReview) {
  const safe = (review.name || review.email || review.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const blob = new Blob([JSON.stringify(review, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deletion-snapshot-${review.kind}-${safe || "record"}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
