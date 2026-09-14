import type { InvoiceStatus, InvoiceCreatorRole, InvoiceCurrency } from "@/lib/supabase";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "pending_payment",
  "sent",
  "partial",
  "paid",
  "overdue",
  "cancelled",
];

export interface InvoiceStatusMeta {
  label: string;
  badge: string;
  pdfBg: string;
  pdfFg: string;
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, InvoiceStatusMeta> = {
  draft: {
    label: "Draft",
    badge: "bg-gray-500/10 text-gray-600",
    pdfBg: "#EFF5F7",
    pdfFg: "#4B5563",
  },
  // Raised by a hosted checkout, waiting on the customer to pay at the gateway.
  // Not a receivable (it is never swept to overdue) and not warehouse work.
  pending_payment: {
    label: "Pending Payment",
    badge: "bg-violet-500/10 text-violet-600",
    pdfBg: "#EDE9FE",
    pdfFg: "#5B21B6",
  },
  sent: {
    label: "Sent",
    badge: "bg-blue-500/10 text-blue-600",
    pdfBg: "#DBEAFE",
    pdfFg: "#1E40AF",
  },
  partial: {
    label: "Partial",
    badge: "bg-amber-500/10 text-amber-600",
    pdfBg: "#FEF3C7",
    pdfFg: "#92400E",
  },
  paid: {
    label: "Paid",
    badge: "bg-emerald-500/10 text-emerald-600",
    pdfBg: "#D1FAE5",
    pdfFg: "#065F46",
  },
  overdue: {
    label: "Overdue",
    badge: "bg-red-500/10 text-red-600",
    pdfBg: "#FEE2E2",
    pdfFg: "#991B1B",
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-gray-500/10 text-gray-500 line-through",
    pdfBg: "#EFF5F7",
    pdfFg: "#5B7A8C",
  },
};

// ---------------------------------------------------------------------------
// Invoice "Source" — who entered the invoice.
// ---------------------------------------------------------------------------
// The invoices list tags each row with, and can be filtered by, who created it.
// Two levels of vocabulary are involved:
//   • created_by_role — the raw creator role stored on the invoice
//     ('admin' | 'assistant' | 'affiliate' | 'system').
//   • source          — the collapsed bucket shown in the UI/filter
//     ('admin' | 'client' | 'online'), where admin+assistant both read as
//     "Admin" and affiliate reads as "Client".

/** The collapsed source buckets used by the list tag + filter. */
export type InvoiceSource = "admin" | "client" | "online";

export interface InvoiceSourceMeta {
  /** Filter/bucket key. */
  key: InvoiceSource;
  /** Short label shown on the row tag and filter control. */
  label: string;
  /** Tailwind classes for the row tag. */
  badge: string;
  /** Longer description used as the tag's tooltip. */
  description: string;
}

export const INVOICE_SOURCE_META: Record<InvoiceSource, InvoiceSourceMeta> = {
  admin: {
    key: "admin",
    label: "Admin",
    badge: "bg-vital/10 text-vital",
    description: "Entered by an admin or assistant in the back office",
  },
  client: {
    key: "client",
    label: "Client",
    badge: "bg-emerald-500/10 text-emerald-600",
    description: "Entered by a client through their client portal",
  },
  online: {
    key: "online",
    label: "Online",
    badge: "bg-blue-500/10 text-blue-600",
    description: "Generated automatically from a store checkout",
  },
};

/** Filter options for the "Source" segmented control (includes "All"). */
export const INVOICE_SOURCE_FILTER_OPTIONS: { value: "all" | InvoiceSource; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admin" },
  { value: "client", label: "Client" },
  { value: "online", label: "Online" },
];

// ---------------------------------------------------------------------------
// Invoice "Currency" — the money an invoice is denominated/paid in.
// ---------------------------------------------------------------------------
// Amounts are never converted between currencies, so a bare "$" on the list is
// ambiguous. Each row carries a small CAD/USD tag, and the list can be filtered
// by currency. The invoices.currency column is NOT NULL DEFAULT 'CAD', so every
// row resolves to exactly one of the two.

export interface InvoiceCurrencyMeta {
  key: InvoiceCurrency;
  /** Short label shown on the row tag + filter control. */
  label: string;
  /** Tailwind classes for the row tag. */
  badge: string;
  /** Longer description used as the tag's tooltip. */
  description: string;
}

export const INVOICE_CURRENCY_META: Record<InvoiceCurrency, InvoiceCurrencyMeta> = {
  CAD: {
    key: "CAD",
    label: "CAD",
    badge: "bg-slate-500/10 text-slate-600",
    description: "Billed in Canadian dollars — amounts are not converted",
  },
  USD: {
    key: "USD",
    label: "USD",
    badge: "bg-emerald-500/10 text-emerald-700",
    description: "Billed in US dollars — amounts are not converted",
  },
};

/** The row-tag metadata for an invoice's currency. A missing/legacy value reads
 *  as CAD, matching the column default the invoice API writes. */
export function invoiceCurrencyMeta(
  currency: InvoiceCurrency | null | undefined,
): InvoiceCurrencyMeta {
  return INVOICE_CURRENCY_META[currency === "USD" ? "USD" : "CAD"];
}

/** Filter options for the "Currency" segmented control (includes "All"). */
export const INVOICE_CURRENCY_FILTER_OPTIONS: { value: "all" | InvoiceCurrency; label: string }[] = [
  { value: "all", label: "All" },
  { value: "CAD", label: "CAD" },
  { value: "USD", label: "USD" },
];

/** Collapse a stored created_by_role into its source bucket, or null when the
 *  invoice predates creator tracking (legacy rows show no Source tag). */
export function invoiceSource(
  role: InvoiceCreatorRole | null | undefined,
): InvoiceSource | null {
  switch (role) {
    case "admin":
    case "assistant":
      return "admin";
    case "affiliate":
      return "client";
    case "system":
      return "online";
    default:
      return null;
  }
}

/** The row-tag metadata for an invoice's creator, or null to render no tag. */
export function invoiceSourceMeta(
  role: InvoiceCreatorRole | null | undefined,
): InvoiceSourceMeta | null {
  const source = invoiceSource(role);
  return source ? INVOICE_SOURCE_META[source] : null;
}

// Virtual status used in API responses + UI rendering.
// Computed live so list views are correct even if mark_overdue_invoices()
// hasn't run recently.
export function effectiveStatus(
  status: InvoiceStatus,
  due_date: string,
): InvoiceStatus {
  if (status !== "sent" && status !== "partial") return status;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(due_date);
  return due < today ? "overdue" : status;
}
