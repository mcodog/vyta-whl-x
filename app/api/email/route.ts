import { NextRequest, NextResponse } from 'next/server';
import {
  sendOrderConfirmation,
  sendShippingNotification,
  sendCustomerWelcome,
  sendAffiliateWelcome,
} from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...data } = body;

    if (!type) {
      return NextResponse.json({ error: 'Missing email type' }, { status: 400 });
    }

    let result;

    switch (type) {
      case 'order_confirmation':
        result = await sendOrderConfirmation(data);
        break;
      case 'shipping_notification':
        result = await sendShippingNotification(data);
        break;
      case 'customer_welcome':
        result = await sendCustomerWelcome(data);
        break;
      case 'affiliate_welcome':
        result = await sendAffiliateWelcome(data);
        break;
      default:
        return NextResponse.json({ error: `Unknown email type: ${type}` }, { status: 400 });
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: result.id });
  } catch (error: any) {
    console.error('Email API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}
