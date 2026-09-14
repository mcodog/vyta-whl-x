import { supabase } from "@/lib/supabase";
import type { SalesPerson } from "@/lib/supabase";
import { rankNameMatches } from "@/lib/admin/searchRank";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      }
    : { "Content-Type": "application/json" };
}

export async function getAllSalesPersons(): Promise<SalesPerson[]> {
  const { data, error } = await supabase
    .from("sales_persons")
    .select("*")
    .order("last_name");
  if (error) {
    console.error("getAllSalesPersons error:", error);
    return [];
  }
  return data ?? [];
}

export type SalesPersonWithStats = SalesPerson & {
  paid_earnings: number;
  pending_earnings: number;
  invoice_count: number;
};

export async function getSalesPersonsWithStats(): Promise<SalesPersonWithStats[]> {
  const people = await getAllSalesPersons();

  const { data: commissions, error } = await supabase
    .from("sales_commissions")
    .select("sales_person_id, amount, status, invoice_id");

  if (error) {
    console.error("getSalesPersonsWithStats error:", error);
    return people.map((p) => ({
      ...p,
      paid_earnings: 0,
      pending_earnings: 0,
      invoice_count: 0,
    }));
  }

  return people.map((person) => {
    const rows = (commissions ?? []).filter(
      (c) => c.sales_person_id === person.id,
    );
    const paid = rows
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const pending = rows
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const invoiceIds = new Set(
      rows.map((c) => c.invoice_id).filter(Boolean),
    );
    return {
      ...person,
      paid_earnings: paid,
      pending_earnings: pending,
      invoice_count: invoiceIds.size,
    };
  });
}

/**
 * The merged "Sales People" row (ADR 0003): a sales person plus their invoice-
 * commission stats and, when linked to a login, the affiliate tier data. Served
 * by GET /api/admin/sales-persons.
 */
export interface MergedSalesPerson extends SalesPerson {
  paid_earnings: number;
  pending_earnings: number;
  invoice_count: number;
  is_affiliate: boolean;
  affiliate: {
    referral_code: string | null;
    referral_uses: number;
    wallet_address: string | null;
    login_active: boolean | null;
    manual_code_only: boolean;
    total_earnings: number;
    referral_paid: number;
    referral_pending: number;
    /** The affiliate's billing currency, from their own customers row. */
    price_currency: import("@/lib/supabase").InvoiceCurrency;
  } | null;
}

export async function getMergedSalesPeople(): Promise<MergedSalesPerson[]> {
  const res = await fetch("/api/admin/sales-persons", { headers: await authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load sales people");
  }
  const { sales_persons } = await res.json();
  return sales_persons ?? [];
}

export async function searchSalesPersons(term: string): Promise<SalesPerson[]> {
  if (!term.trim()) return [];
  const like = `%${term.trim()}%`;
  // Pull a wider candidate set than we display, then rank locally so the best
  // matches (name/prefix) win the visible slots rather than an arbitrary set of
  // substring/email matches the DB happens to return first (a single letter
  // matches a substring of nearly every email).
  const { data, error } = await supabase
    .from("sales_persons")
    .select("*")
    .eq("active", true)
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .limit(50);
  if (error) {
    console.error("searchSalesPersons error:", error);
    return [];
  }
  return rankNameMatches(data ?? [], term).slice(0, 8);
}

export type SalesPersonInput = Omit<
  SalesPerson,
  "id" | "created_at" | "updated_at" | "total_earnings" | "user_id"
>;

export async function createSalesPerson(input: SalesPersonInput): Promise<SalesPerson> {
  const res = await fetch("/api/admin/sales-persons", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create salesperson");
  }
  const { sales_person } = await res.json();
  return sales_person;
}

export async function updateSalesPerson(
  id: string,
  patch: Partial<SalesPersonInput>,
): Promise<SalesPerson> {
  const res = await fetch(`/api/admin/sales-persons/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update salesperson");
  }
  const { sales_person } = await res.json();
  return sales_person;
}

export async function deleteSalesPerson(id: string): Promise<void> {
  const res = await fetch(`/api/admin/sales-persons/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete salesperson");
  }
}
