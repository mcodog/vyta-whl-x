import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  applyExportOptions,
  loadPricelistExport,
  pricelistFileBase,
  DEFAULT_PRICELIST_ID,
} from "@/lib/admin/pricelist-export";
import {
  readFlag,
  resolveColumns,
  type PricelistExportFormat,
  type PricelistExportOptions,
} from "@/lib/admin/pricelist-columns";
import { renderPricelistPdf } from "@/lib/admin/pricelist-pdf";
import { renderPricelistXlsx } from "@/lib/admin/pricelist-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Downloading a price list is a read, so admins and assistants both qualify. */
async function canDownload(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return false;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = customer?.role || "customer";
    return role === "admin" || role === "assistant";
  } catch {
    return false;
  }
}

// GET /api/admin/pricelists/[id]/export
//   ?format=pdf|xlsx          which file to build (default: pdf)
//   &cols=sku,product,price   columns to include; unknown keys are ignored and
//                             an empty selection falls back to the format's
//                             defaults, so a download always has columns
//   &name=1&desc=1&meta=1     print the list name / description / details strip
//   &only_priced=0            drop rows that fall back to the catalog price
// Downloads one price list as a branded PDF or an Excel workbook. `id` may be
// "default" for the catalog's own prices (the pinned "Default Prices" record).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await canDownload(request))) {
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const format: PricelistExportFormat = sp.get("format") === "xlsx" ? "xlsx" : "pdf";

  const loaded = await loadPricelistExport(supabase, id || DEFAULT_PRICELIST_ID);
  if (!loaded) return new NextResponse("Price list not found", { status: 404 });

  const options: PricelistExportOptions = {
    columns: resolveColumns(sp.get("cols")?.split(","), format, loaded),
    showName: readFlag(sp.get("name"), true),
    showDescription: readFlag(sp.get("desc"), true),
    showMeta: readFlag(sp.get("meta"), true),
    onlyPriced: readFlag(sp.get("only_priced"), false),
  };
  const data = applyExportOptions(loaded, options);

  const base = pricelistFileBase(data);
  const body =
    format === "xlsx"
      ? renderPricelistXlsx(data, options)
      : await renderPricelistPdf(data, options);

  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
