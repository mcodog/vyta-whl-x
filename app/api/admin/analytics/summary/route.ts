import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeAnalyticsSummary, isAdminOrAssistant } from "@/lib/admin/analytics-data";

// Short-TTL revalidation: dashboard reloads at most every 30 s server-side.
// Page-level refresh still bypasses cache via cache: 'no-store'.
export const revalidate = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  if (!(await isAdminOrAssistant(supabase, request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get("from"); // YYYY-MM-DD inclusive
  const to = params.get("to");     // YYYY-MM-DD inclusive

  try {
    const summary = await computeAnalyticsSummary(supabase, { from, to });
    return NextResponse.json({ summary });
  } catch (e) {
    console.error("analytics summary error:", e);
    const message = e instanceof Error ? e.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
