import { supabase } from "@/lib/supabase";
import type {
  ExportInvoice,
  ExportCustomer,
  ExportLineItem,
  ExportPayment,
  DestinationReport,
} from "@/lib/admin/invoice-export";

// ---------------------------------------------------------------------------
// Client-side fetch helpers for the invoice-export feature.
// ---------------------------------------------------------------------------

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      }
    : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// --- Destinations ----------------------------------------------------------
export interface ExportDestinationView {
  id: string;
  label: string;
  edge_function_url: string;
  enabled: boolean;
  notes: string | null;
  secret_set: boolean;
  created_at: string;
  updated_at: string;
}

export async function listDestinations(): Promise<ExportDestinationView[]> {
  const { destinations } = await apiFetch<{ destinations: ExportDestinationView[] }>(
    "/api/admin/invoice-export/destinations",
  );
  return destinations;
}

export async function createDestination(input: {
  label: string;
  edge_function_url: string;
  secret: string;
  notes?: string;
  enabled?: boolean;
}): Promise<ExportDestinationView> {
  const { destination } = await apiFetch<{ destination: ExportDestinationView }>(
    "/api/admin/invoice-export/destinations",
    { method: "POST", body: JSON.stringify(input) },
  );
  return destination;
}

export async function updateDestination(
  id: string,
  input: Partial<{
    label: string;
    edge_function_url: string;
    secret: string;
    notes: string | null;
    enabled: boolean;
  }>,
): Promise<ExportDestinationView> {
  const { destination } = await apiFetch<{ destination: ExportDestinationView }>(
    `/api/admin/invoice-export/destinations/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return destination;
}

export async function deleteDestination(id: string): Promise<void> {
  await apiFetch(`/api/admin/invoice-export/destinations/${id}`, { method: "DELETE" });
}

// --- Preview & send --------------------------------------------------------
export interface ExportPreviewPayload {
  source: string;
  invoice: ExportInvoice;
  customer: ExportCustomer | null;
  line_items: ExportLineItem[];
  payments: ExportPayment[];
}

export interface PreviewResultItem {
  invoiceId: string;
  invoice_number: string | null;
  payload: ExportPreviewPayload | null;
  report: DestinationReport | null;
  error: string | null;
}

export interface PreviewResponse {
  destination: { id: string; label: string };
  results: PreviewResultItem[];
}

export async function previewExport(
  invoiceIds: string[],
  destinationId: string,
): Promise<PreviewResponse> {
  return apiFetch<PreviewResponse>("/api/admin/invoice-export/preview", {
    method: "POST",
    body: JSON.stringify({ invoiceIds, destinationId }),
  });
}

export interface SendResultItem {
  invoiceId: string;
  invoice_number: string | null;
  status: "success" | "skipped" | "failed";
  remote_invoice_number?: string | null;
  report?: DestinationReport | null;
  error?: string | null;
}

export interface SendResponse {
  destination: { id: string; label: string };
  summary: { total: number; succeeded: number; skipped: number; failed: number };
  results: SendResultItem[];
}

export async function sendExport(
  invoiceIds: string[],
  destinationId: string,
  overwrite = false,
): Promise<SendResponse> {
  return apiFetch<SendResponse>("/api/admin/invoice-export/send", {
    method: "POST",
    body: JSON.stringify({ invoiceIds, destinationId, overwrite }),
  });
}
