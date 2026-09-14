import type { PurchaseOrderStatus } from "@/lib/supabase";

export const PO_STATUSES: PurchaseOrderStatus[] = [
  "pending",
  "partially_fulfilled",
  "fulfilled",
  "paid",
  "cancelled",
];

export interface PoStatusMeta {
  label: string;
  badge: string;
  pdfBg: string;
  pdfFg: string;
}

export const PO_STATUS_META: Record<PurchaseOrderStatus, PoStatusMeta> = {
  pending: {
    label: "Pending",
    badge: "bg-amber-500/10 text-amber-600",
    pdfBg: "#FEF3C7",
    pdfFg: "#92400E",
  },
  partially_fulfilled: {
    label: "Partially Fulfilled",
    badge: "bg-blue-500/10 text-blue-600",
    pdfBg: "#DBEAFE",
    pdfFg: "#1E40AF",
  },
  fulfilled: {
    label: "Fulfilled",
    badge: "bg-violet-500/10 text-violet-600",
    pdfBg: "#EDE9FE",
    pdfFg: "#5B21B6",
  },
  paid: {
    label: "Paid",
    badge: "bg-emerald-500/10 text-emerald-600",
    pdfBg: "#D1FAE5",
    pdfFg: "#065F46",
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-red-500/10 text-red-600",
    pdfBg: "#FEE2E2",
    pdfFg: "#991B1B",
  },
};

export function isPoLocked(status: PurchaseOrderStatus): boolean {
  return status === "paid" || status === "cancelled";
}

// Receiving is allowed for every status except cancelled. A 'paid' PO can still
// receive stock (paid-before-delivery is common); only cancellation stops it.
export function canReceivePo(status: PurchaseOrderStatus): boolean {
  return status !== "cancelled";
}
