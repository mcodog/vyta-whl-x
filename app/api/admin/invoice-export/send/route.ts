import { NextRequest, NextResponse } from "next/server";
import { exportSupabase, getExportAuth } from "@/lib/admin/export-server";
import { logAuditServer } from "@/lib/admin/audit";
import {
  buildInvoiceExportPayload,
  callDestination,
  type ExportDestination,
  type ExportPayload,
} from "@/lib/admin/invoice-export";

// POST /api/admin/invoice-export/send
// Body: { invoiceIds: string[], destinationId: string, overwrite?: boolean }
// Commits each invoice to the destination Edge Function and records an
// invoice_exports log row per attempt. Admin only (this writes to the far side).
export async function POST(request: NextRequest) {
  const { role, userId } = await getExportAuth(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const invoiceIds: string[] = Array.isArray(body.invoiceIds) ? body.invoiceIds : [];
  const destinationId = String(body.destinationId ?? "").trim();
  const overwrite = Boolean(body.overwrite);

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

  const results = [];
  for (const invoiceId of invoiceIds) {
    const built = await buildInvoiceExportPayload(exportSupabase, invoiceId);
    if (!built) {
      results.push({ invoiceId, invoice_number: null, status: "failed", error: "Invoice not found" });
      await exportSupabase.from("invoice_exports").insert({
        invoice_id: invoiceId,
        destination_id: destination.id,
        destination_label: destination.label,
        status: "failed",
        error: "Invoice not found",
        created_by: userId,
      });
      continue;
    }

    const payload: ExportPayload = { ...built, mode: "commit", overwrite };
    const call = await callDestination(destination, payload);
    const report = call.report;

    // Map the far side's response onto our log status.
    let status: "success" | "skipped" | "failed";
    if (!call.ok) status = "failed";
    else if (report?.status === "skipped") status = "skipped";
    else if (report?.status === "failed") status = "failed";
    else status = "success";

    const error = call.ok ? report?.error ?? null : call.error;

    await exportSupabase.from("invoice_exports").insert({
      invoice_id: invoiceId,
      destination_id: destination.id,
      invoice_number: built.invoice.invoice_number,
      destination_label: destination.label,
      status,
      remote_invoice_id: report?.remote_invoice_id ?? null,
      remote_invoice_number: report?.remote_invoice_number ?? null,
      response: report ?? null,
      error,
      created_by: userId,
    });

    results.push({
      invoiceId,
      invoice_number: built.invoice.invoice_number,
      status,
      remote_invoice_number: report?.remote_invoice_number ?? null,
      report,
      error,
    });
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  await logAuditServer(exportSupabase, {
    actor_id: userId,
    action: "export",
    entity_type: "invoice",
    entity_id: invoiceIds.length === 1 ? invoiceIds[0] : null,
    payload: {
      destination: destination.label,
      count: invoiceIds.length,
      succeeded,
      skipped,
      failed,
    },
  });

  return NextResponse.json({
    destination: { id: destination.id, label: destination.label },
    summary: { total: results.length, succeeded, skipped, failed },
    results,
  });
}
