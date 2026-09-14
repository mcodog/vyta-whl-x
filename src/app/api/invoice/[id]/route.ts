import { NextRequest, NextResponse } from "next/server";
import { getMetaCortexClient } from "@/lib/metacortex";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Invoice ID required" },
        { status: 400 }
      );
    }

    const client = getMetaCortexClient();
    const invoice = await client.getInvoice(id);

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: invoice.amount,
        currency: invoice.currency,
        payment_address: invoice.payment_address,
        status: invoice.status,
        expires_at: invoice.expires_at,
        paid_at: invoice.paid_at,
        transaction_hash: invoice.transaction_hash,
      },
    });
  } catch (error) {
    console.error("Invoice lookup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invoice lookup failed" },
      { status: 500 }
    );
  }
}
