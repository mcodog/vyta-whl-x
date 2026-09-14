import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Shared service-role client + admin auth for the invoice-export API routes.
export const exportSupabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type ExportRole = "customer" | "affiliate" | "assistant" | "admin";

export async function getExportAuth(
  request: NextRequest,
): Promise<{ role: ExportRole; userId: string | null }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer", userId: null };
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
  } = await exportSupabase.auth.getUser(token);
  if (!user) return { role: "customer", userId: null };
  const { data: customer } = await exportSupabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  return {
    role: (customer?.role || "customer") as ExportRole,
    userId: user.id,
  };
}
