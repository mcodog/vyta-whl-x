import { NextRequest, NextResponse } from "next/server";
import { getMetaCortexClient, SupportedCurrency } from "@/lib/metacortex";

interface CheckoutItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CheckoutRequest {
  items: CheckoutItem[];
  currency: SupportedCurrency;
  email?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutRequest = await request.json();
    const { items, currency, email } = body;

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "No items in cart" },
        { status: 400 }
      );
    }

    if (!currency) {
      return NextResponse.json(
        { error: "Payment currency required" },
        { status: 400 }
      );
    }

    // Calculate total
    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Build description
    const description = items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");

    // Generate order ID
    const orderId = `AMC-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create invoice via MetaCortex
    const client = getMetaCortexClient();
    const invoice = await client.createInvoice({
      amount: total,
      currency,
      customer_email: email,
      description: `VYTA Order: ${description}`,
      metadata: {
        order_id: orderId,
        items,
        total,
      },
    });

    return NextResponse.json({
      success: true,
      order_id: orderId,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: invoice.amount,
        currency: invoice.currency,
        payment_address: invoice.payment_address,
        payment_url: invoice.payment_url,
        status: invoice.status,
        expires_at: invoice.expires_at,
      },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout failed" },
      { status: 500 }
    );
  }
}
