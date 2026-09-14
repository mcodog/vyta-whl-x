/**
 * Multi sales person attribution — the one place that knows how a deal is split.
 *
 * An invoice (and a customer) can credit up to {@link MAX_SALES_PEOPLE} sales
 * people, each on their own commission percentage. The roster lives in
 * `invoice_sales_persons` / `customer_sales_persons`; the **primary** member
 * (position 0) is mirrored back onto the legacy single-person columns
 * (`invoices.sales_person_id` + rate/amount, `customers.default_sales_person_id`)
 * so every existing reader — affiliate scoping, analytics, genealogy, the
 * commissions report, the invoice list filter — keeps working unchanged.
 *
 * Two rules hold everywhere below:
 *
 *  1. Each person's commission is `invoice total x their own rate`. Rates are
 *     independent — they are NOT slices of one pot and may sum past 100%
 *     (that's a business decision, not a bug), so nothing here normalises them.
 *  2. The roster is always rewritten wholesale (delete + insert). Partial
 *     patching would let `position` drift out of the 0..4 run the DB's unique
 *     constraint depends on.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { round2 } from "@/lib/pricing";

/** Hard cap, matched by the `position` CHECK in the migration. */
export const MAX_SALES_PEOPLE = 5;

/** One roster entry as it arrives from a client. */
export interface SalesPersonAssignment {
  sales_person_id: string;
  /** Percent (5 = 5%). Clamped to 0–100. */
  commission_rate: number;
}

/** A roster entry with its money resolved against an invoice total. */
export interface ResolvedAssignment extends SalesPersonAssignment {
  commission_amount: number;
  position: number;
}

/** The commission one person earns on a total, at cents. */
export function commissionAmountFor(total: number, rate: number): number {
  const t = Number(total) || 0;
  const r = Number(rate) || 0;
  return round2(t * (r / 100));
}

/** Clamp a percentage to the 0–100 band the UI and DB both assume. */
function clampRate(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Normalise whatever a client sent into a clean roster: real ids only, first
 * occurrence of a duplicated person wins (they can't earn twice on one
 * invoice), rates clamped, and never more than five entries. Order is
 * significant — entry 0 becomes the primary.
 */
export function normalizeAssignments(raw: unknown): SalesPersonAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesPersonAssignment[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as any).sales_person_id ?? (item as any).id;
    if (typeof id !== "string" || !id.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ sales_person_id: id, commission_rate: clampRate((item as any).commission_rate) });
    if (out.length >= MAX_SALES_PEOPLE) break;
  }
  return out;
}

/**
 * The roster a request means, honouring the legacy single-person fields.
 *
 * `sales_people` wins whenever it is an array — including an empty one, which
 * is how a client clears every attribution. Otherwise the old
 * `sales_person_id` / `sales_person_commission_rate` pair is read as a
 * one-person roster, so an untouched caller (or an old client build) behaves
 * exactly as it did before. `undefined` means "the body says nothing about
 * attribution" and is returned as null so callers can keep what they have.
 */
export function assignmentsFromBody(body: Record<string, any>): SalesPersonAssignment[] | null {
  if (Array.isArray(body?.sales_people)) return normalizeAssignments(body.sales_people);
  if (body?.sales_person_id !== undefined) {
    return body.sales_person_id
      ? [
          {
            sales_person_id: String(body.sales_person_id),
            commission_rate: clampRate(body.sales_person_commission_rate),
          },
        ]
      : [];
  }
  return null;
}

/** Attach each entry's money and position for a given invoice total. */
export function resolveAssignments(
  assignments: SalesPersonAssignment[],
  total: number,
): ResolvedAssignment[] {
  return assignments.slice(0, MAX_SALES_PEOPLE).map((a, position) => ({
    sales_person_id: a.sales_person_id,
    commission_rate: clampRate(a.commission_rate),
    commission_amount: commissionAmountFor(total, a.commission_rate),
    position,
  }));
}

/**
 * The legacy single-person columns for an invoice, taken from the primary.
 * Written on every invoice insert/patch so the old shape never goes stale.
 */
export function primaryInvoiceColumns(resolved: ResolvedAssignment[]) {
  const primary = resolved[0] ?? null;
  return {
    sales_person_id: primary?.sales_person_id ?? null,
    sales_person_commission_rate: primary?.commission_rate ?? 0,
    sales_person_commission_amount: primary?.commission_amount ?? 0,
  };
}

/**
 * Replace an invoice's roster. Best-effort: a failure here is logged and
 * swallowed so it can never strand an invoice that has already been written —
 * the mirrored primary columns still carry the headline attribution.
 */
export async function writeInvoiceRoster(
  supabase: SupabaseClient,
  invoiceId: string,
  resolved: ResolvedAssignment[],
): Promise<void> {
  try {
    await supabase.from("invoice_sales_persons").delete().eq("invoice_id", invoiceId);
    if (resolved.length === 0) return;
    const { error } = await supabase.from("invoice_sales_persons").insert(
      resolved.map((r) => ({
        invoice_id: invoiceId,
        sales_person_id: r.sales_person_id,
        commission_rate: r.commission_rate,
        commission_amount: r.commission_amount,
        position: r.position,
      })),
    );
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("writeInvoiceRoster failed for invoice", invoiceId, e);
  }
}

/**
 * Rewrite the PENDING commission ledger rows for an invoice — one per person
 * who actually earns something. Paid and cancelled rows are never touched:
 * money that has already moved is history, not state.
 */
export async function syncInvoiceCommissions(
  supabase: SupabaseClient,
  invoiceId: string,
  resolved: ResolvedAssignment[],
  invoiceTotal: number,
): Promise<void> {
  try {
    await supabase
      .from("sales_commissions")
      .delete()
      .eq("invoice_id", invoiceId)
      .eq("status", "pending");

    const earning = resolved.filter((r) => r.commission_amount > 0);
    if (earning.length === 0) return;
    const { error } = await supabase.from("sales_commissions").insert(
      earning.map((r) => ({
        sales_person_id: r.sales_person_id,
        invoice_id: invoiceId,
        amount: r.commission_amount,
        invoice_total: invoiceTotal,
        commission_rate: r.commission_rate,
        status: "pending",
      })),
    );
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("syncInvoiceCommissions failed for invoice", invoiceId, e);
  }
}

/** An invoice's stored roster, ordered primary-first. */
export async function readInvoiceRoster(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<ResolvedAssignment[]> {
  const { data } = await supabase
    .from("invoice_sales_persons")
    .select("sales_person_id, commission_rate, commission_amount, position")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true });
  return ((data as any[]) ?? []).map((r, i) => ({
    sales_person_id: String(r.sales_person_id),
    commission_rate: Number(r.commission_rate) || 0,
    commission_amount: Number(r.commission_amount) || 0,
    position: Number.isFinite(Number(r.position)) ? Number(r.position) : i,
  }));
}

/**
 * The roster to use for an invoice whose body didn't specify one: its stored
 * roster, or — for a row written before this table existed — its legacy single
 * sales person promoted to a one-person roster.
 */
export async function existingInvoiceAssignments(
  supabase: SupabaseClient,
  invoiceId: string,
  invoice: { sales_person_id?: string | null; sales_person_commission_rate?: number | null },
): Promise<SalesPersonAssignment[]> {
  const roster = await readInvoiceRoster(supabase, invoiceId);
  if (roster.length > 0) {
    return roster.map((r) => ({
      sales_person_id: r.sales_person_id,
      commission_rate: r.commission_rate,
    }));
  }
  return invoice.sales_person_id
    ? [
        {
          sales_person_id: invoice.sales_person_id,
          commission_rate: Number(invoice.sales_person_commission_rate) || 0,
        },
      ]
    : [];
}

/**
 * Replace a customer's sales-team roster and keep
 * `customers.default_sales_person_id` pointing at the primary, so the legacy
 * "default sales person" surfaces stay correct.
 */
export async function writeCustomerRoster(
  supabase: SupabaseClient,
  customerId: string,
  assignments: SalesPersonAssignment[],
): Promise<{ error: string | null }> {
  const capped = assignments.slice(0, MAX_SALES_PEOPLE);
  const { error: delErr } = await supabase
    .from("customer_sales_persons")
    .delete()
    .eq("customer_id", customerId);
  if (delErr) return { error: delErr.message };

  if (capped.length > 0) {
    const { error } = await supabase.from("customer_sales_persons").insert(
      capped.map((a, position) => ({
        customer_id: customerId,
        sales_person_id: a.sales_person_id,
        commission_rate: clampRate(a.commission_rate),
        position,
      })),
    );
    if (error) return { error: error.message };
  }

  const { error: custErr } = await supabase
    .from("customers")
    .update({ default_sales_person_id: capped[0]?.sales_person_id ?? null })
    .eq("id", customerId);
  if (custErr) return { error: custErr.message };

  return { error: null };
}

/** A customer's roster with each person's details, ordered primary-first. */
export async function readCustomerRoster(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerRosterEntry[]> {
  const { data } = await supabase
    .from("customer_sales_persons")
    .select(
      "sales_person_id, commission_rate, position, sales_person:sales_persons (id, first_name, last_name, email, active, commission_rate)",
    )
    .eq("customer_id", customerId)
    .order("position", { ascending: true });
  return ((data as any[]) ?? []).map((r, i) => ({
    sales_person_id: String(r.sales_person_id),
    commission_rate: Number(r.commission_rate) || 0,
    position: Number.isFinite(Number(r.position)) ? Number(r.position) : i,
    sales_person: r.sales_person ?? null,
  }));
}

export interface CustomerRosterEntry {
  sales_person_id: string;
  commission_rate: number;
  position: number;
  sales_person: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    active?: boolean | null;
    commission_rate?: number | null;
  } | null;
}

/** "First Last", falling back to the email, then a placeholder. */
export function salesPersonLabel(
  sp: { first_name?: string | null; last_name?: string | null; email?: string | null } | null,
): string {
  if (!sp) return "Unknown";
  const name = [sp.first_name, sp.last_name].filter(Boolean).join(" ").trim();
  return name || sp.email || "Unknown";
}

/** One roster row as the read paths hand it to a renderer. */
export interface InvoiceRosterRow {
  sales_person_id: string;
  commission_rate: number;
  commission_amount: number;
  position: number;
  sales_person: Record<string, any> | null;
}

/**
 * Rosters for a batch of invoices, keyed by invoice id and ordered primary
 * first.
 *
 * Deliberately a **separate query rather than a PostgREST embed**. An embed on a
 * table that doesn't exist fails the *whole* select, which would take the
 * invoice list, the customer 360, the PDF and the customer-facing invoice view
 * down on any database that hasn't run `multi-sales-person-migration.sql` yet.
 * Here a missing table just yields an empty map and every caller falls back to
 * the invoice's own primary columns — exactly today's behaviour.
 *
 * `full` pulls the whole `sales_persons` row (the invoice form reads each
 * person's line-discount presets off it); the default is the display fields.
 */
export async function loadInvoiceRosters(
  supabase: SupabaseClient,
  invoiceIds: string[],
  opts: { full?: boolean } = {},
): Promise<Map<string, InvoiceRosterRow[]>> {
  const out = new Map<string, InvoiceRosterRow[]>();
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const person = opts.full ? "*" : "id, first_name, last_name, email";
  const { data, error } = await supabase
    .from("invoice_sales_persons")
    .select(
      `invoice_id, sales_person_id, commission_rate, commission_amount, position, sales_person:sales_persons (${person})`,
    )
    .in("invoice_id", ids);
  if (error) {
    console.error("loadInvoiceRosters failed (falling back to the primary):", error.message);
    return out;
  }

  for (const row of ((data as any[]) ?? [])) {
    const key = String(row.invoice_id);
    const list = out.get(key) ?? [];
    list.push({
      sales_person_id: String(row.sales_person_id),
      commission_rate: Number(row.commission_rate) || 0,
      commission_amount: Number(row.commission_amount) || 0,
      position: Number(row.position) || 0,
      sales_person: row.sales_person ?? null,
    });
    out.set(key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.position - b.position);
  return out;
}

/**
 * Sales teams for a batch of customers, keyed by customer id, primary first.
 * Same reasoning as {@link loadInvoiceRosters}: a separate, failure-tolerant
 * query so a pre-migration database still renders the customers list.
 */
export async function loadCustomerRosters(
  supabase: SupabaseClient,
  customerIds: string[],
): Promise<Map<string, CustomerRosterEntry[]>> {
  const out = new Map<string, CustomerRosterEntry[]>();
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("customer_sales_persons")
    .select(
      "customer_id, sales_person_id, commission_rate, position, sales_person:sales_persons (id, first_name, last_name, email, active, commission_rate)",
    )
    .in("customer_id", ids);
  if (error) {
    console.error("loadCustomerRosters failed (falling back to the default):", error.message);
    return out;
  }

  for (const row of ((data as any[]) ?? [])) {
    const key = String(row.customer_id);
    const list = out.get(key) ?? [];
    list.push({
      sales_person_id: String(row.sales_person_id),
      commission_rate: Number(row.commission_rate) || 0,
      position: Number(row.position) || 0,
      sales_person: row.sales_person ?? null,
    });
    out.set(key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.position - b.position);
  return out;
}

/**
 * Invoice ids where a sales person is credited but is NOT the primary — the
 * rows the legacy `invoices.sales_person_id` filter can't see. Used to widen a
 * query's scope so an invoice someone co-sold still shows up for them.
 *
 * Bounded deliberately: these ids are spliced into a PostgREST `.or()` filter,
 * which travels in the URL, so an unbounded list would eventually produce a
 * request too long to send. Past the cap an affiliate still reaches the invoice
 * through their bound customer, which is how the vast majority of a book
 * resolves anyway.
 */
export async function coSoldInvoiceIds(
  supabase: SupabaseClient,
  salesPersonId: string,
  limit = 200,
): Promise<string[]> {
  const { data } = await supabase
    .from("invoice_sales_persons")
    .select("invoice_id")
    .eq("sales_person_id", salesPersonId)
    .gt("position", 0)
    .limit(limit);
  return [...new Set(((data as any[]) ?? []).map((r) => String(r.invoice_id)))];
}
