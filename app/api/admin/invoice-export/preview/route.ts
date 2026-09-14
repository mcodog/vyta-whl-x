import { NextRequest, NextResponse } from "next/server";
import { exportSupabase, getExportAuth } from "@/lib/admin/export-server";
import {
  buildInvoiceExportPayload,
  callDestination,
  type ExportDestination,
  type ExportPayload,
} from "@/lib/admin/invoice-export";

// POST /api/admin/invoice-export/preview
// Body: { invoiceIds: string[], destinationId: string }
// Builds each invoice's payload and asks the destination Edge Function, in
// dry-run ("preview") mode, to report whether its columns are compatible and
// whether the invoice / customer / products already exist. Nothing is written.
export async function POST(request: NextRequest) {
  const { role } = await getExportAuth(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const invoiceIds: string[] = Array.isArray(body.invoiceIds) ? body.invoiceIds : [];
  const destinationId = String(body.destinationId ?? "").trim();

  if (invoiceIds.length === 0) {
    return NextResponse.json({ error: "No invoices selected" }, { status: 400 });
  }
  if (!destinationId) {
    return NextResponse.json({ error: "No destination selected" }, { status: 400 });
  }

  const { data: dest } = await exportSupabase
    .from("invoice_export_destinations")
    .select("*")
    .eq("id", destinationId)
    .single();
  if (!dest) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }
  const destination = dest as ExportDestination;
  if (!destination.enabled) {
    return NextResponse.json({ error: "Destination is disabled" }, { status: 400 });
  }

  const results = await Promise.all(
    invoiceIds.map(async (invoiceId) => {
      const built = await buildInvoiceExportPayload(exportSupabase, invoiceId);
      if (!built) {
        return { invoiceId, invoice_number: null, error: "Invoice not found", payload: null, report: null };
      }
      const payload: ExportPayload = { ...built, mode: "preview" };
      const call = await callDestination(destination, payload);
      return {
        invoiceId,
        invoice_number: built.invoice.invoice_number,
        // Send the payload back so the dialog can show exactly what will go out.
        payload: built,
        report: call.report,
        error: call.ok ? null : call.error,
      };
    }),
  );

  return NextResponse.json({
    destination: { id: destination.id, label: destination.label },
    results,
  });
}
