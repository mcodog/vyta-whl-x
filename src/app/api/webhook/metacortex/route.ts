import { NextRequest, NextResponse } from "next/server";
import { getMetaCortexClient } from "@/lib/metacortex";

interface WebhookPayload {
  event: "invoice.paid" | "invoice.expired";
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    currency: string;
    status: string;
    transaction_hash?: string;
    paid_at?: string;
    metadata?: {
      order_id?: string;
      items?: unknown[];
    };
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload: WebhookPayload = await request.json();
    const { event, invoice } = payload;

    console.log(`[Webhook] Received ${event} for invoice ${invoice.invoice_number}`);

    // Verify invoice status via API (security best practice)
    const client = getMetaCortexClient();
    const verified = await client.getInvoice(invoice.invoice_number);

    if (verified.status !== invoice.status) {
      console.warn(`[Webhook] Status mismatch: received ${invoice.status}, verified ${verified.status}`);
    }

    switch (event) {
      case "invoice.paid":
        // Order has been paid - fulfill order
        console.log(`[Webhook] Order ${invoice.metadata?.order_id} PAID`);
        console.log(`[Webhook] Transaction: ${invoice.transaction_hash}`);
        // TODO: Update order status in database
        // TODO: Send confirmation email
        // TODO: Trigger fulfillment
        break;

      case "invoice.expired":
        // Invoice expired without payment
        console.log(`[Webhook] Invoice ${invoice.invoice_number} EXPIRED`);
        // TODO: Update order status
        // TODO: Notify customer (optional)
        break;

      default:
        console.log(`[Webhook] Unknown event: ${event}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
