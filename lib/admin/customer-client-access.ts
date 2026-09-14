import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInvoiceCaller, affiliateCustomerIds } from "@/lib/admin/invoice-access";

export interface CustomerClientCaller {
  userId: string;
  role: string;
}

/**
 * Staff (admin/assistant) may manage any customer's clients; an affiliate only
 * their own bound customers'. Returns the caller when allowed, else null.
 *
 * Shared by the customer-clients routes so the list/create/update endpoints
 * can never drift apart on who is allowed to touch a client record.
 */
export async function authorizeForCustomer(
  supabase: SupabaseClient,
  request: NextRequest,
  customerId: string,
): Promise<CustomerClientCaller | null> {
  const caller = await getInvoiceCaller(supabase, request);
  if (!caller || caller.role === "customer") return null;
  if (caller.role === "admin" || caller.role === "assistant") {
    return { userId: caller.id, role: caller.role };
  }
  if (caller.role === "affiliate") {
    const ids = await affiliateCustomerIds(supabase, caller.id);
    if (!ids.includes(customerId)) return null;
    return { userId: caller.id, role: caller.role };
  }
  return null;
}

/** Trim a value to a non-empty string, or null when blank/not a string. */
export function cleanField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
