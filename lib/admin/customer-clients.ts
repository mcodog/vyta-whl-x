import { supabase } from "@/lib/supabase";
import type { CustomerClient } from "@/lib/supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
    : { "Content-Type": "application/json" };
}

/** An invoice that ships to a client, as listed back when a delete is refused. */
export interface ClientInvoiceRef {
  id: string;
  invoice_number: string;
}

/** How many invoices ship to a client, with a sample of them to show. */
export interface ClientUsage {
  count: number;
  invoices: ClientInvoiceRef[];
}

/**
 * Thrown when a delete is refused because invoices still ship to the client.
 * Carries the usage so the UI can link the invoices to fix rather than only
 * repeating the message.
 */
export class ClientInUseError extends Error {
  readonly usage: ClientUsage;
  constructor(message: string, usage: ClientUsage) {
    super(message);
    this.name = "ClientInUseError";
    this.usage = usage;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.error || `Request failed: ${res.status}`;
    if (res.status === 409 && err.usage) throw new ClientInUseError(message, err.usage);
    throw new Error(message);
  }
  return res.json();
}

/** Fields accepted when creating a client. `address` is required. */
export interface CustomerClientInput {
  first_name?: string | null;
  last_name?: string | null;
  address: string;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** List the saved clients (end-recipients) for a customer, newest first. */
export async function getCustomerClients(customerId: string): Promise<CustomerClient[]> {
  const { clients } = await apiFetch<{ clients: CustomerClient[] }>(
    `/api/admin/customers/${customerId}/clients`,
  );
  return clients;
}

/** Create a new client for a customer. */
export async function createCustomerClient(
  customerId: string,
  input: CustomerClientInput,
): Promise<CustomerClient> {
  const { client } = await apiFetch<{ client: CustomerClient }>(
    `/api/admin/customers/${customerId}/clients`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return client;
}

/**
 * Edit a saved client. Only the keys present in `input` are changed, so a
 * partial patch never blanks fields the caller left out. `address` may be
 * updated but not cleared.
 */
export async function updateCustomerClient(
  customerId: string,
  clientId: string,
  input: Partial<CustomerClientInput>,
): Promise<CustomerClient> {
  const { client } = await apiFetch<{ client: CustomerClient }>(
    `/api/admin/customers/${customerId}/clients/${clientId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return client;
}

/**
 * How many invoices ship to a saved client. Call this before offering a delete
 * so a client that can't be removed is flagged before the user commits.
 */
export async function getCustomerClientUsage(
  customerId: string,
  clientId: string,
): Promise<ClientUsage> {
  const { usage } = await apiFetch<{ client: CustomerClient; usage: ClientUsage }>(
    `/api/admin/customers/${customerId}/clients/${clientId}`,
  );
  return usage;
}

/**
 * Delete a saved client. Throws `ClientInUseError` (carrying the invoices that
 * still ship to them) when the API refuses; any other failure throws a plain
 * Error whose message should be surfaced to the user.
 */
export async function deleteCustomerClient(
  customerId: string,
  clientId: string,
): Promise<void> {
  await apiFetch<{ ok: true }>(
    `/api/admin/customers/${customerId}/clients/${clientId}`,
    { method: "DELETE" },
  );
}
