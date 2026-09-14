import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkPayment, REQUIRED_CONFIRMATIONS } from '@/lib/payment-monitor';
import type { CryptoChain } from '@/lib/crypto-wallets';
import { sendPaymentConfirmed, sendAdminPaymentNotification } from '@/lib/email';
import { checkLowStockForProducts } from '@/lib/admin/low-stock';

export async function GET(req: NextRequest) {
  const orderNumber = req.nextUrl.searchParams.get('orderNumber');
  if (!orderNumber) {
    return NextResponse.json({ error: 'Order number required' }, { status: 400 });
  }

  const db = getSupabase();
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, email, crypto, payment_address, payment_amount_expected, payment_expires_at, total, items, status, payment_confirmations')
    .eq('order_number', orderNumber)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Already confirmed or not pending/received — just return current status
  if (!['pending', 'received'].includes(order.status)) {
    return NextResponse.json({
      status: order.status,
      confirmations: order.payment_confirmations || 0,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[order.crypto as CryptoChain] || 1,
    });
  }

  // Check if expired
  if (order.status === 'pending' && order.payment_expires_at && new Date(order.payment_expires_at) < new Date()) {
    await db.from('orders').update({ status: 'expired' }).eq('id', order.id);
    return NextResponse.json({ status: 'expired', confirmations: 0, requiredConfirmations: 1 });
  }

  // Check blockchain directly
  const result = await checkPayment(
    order.crypto as CryptoChain,
    order.payment_address!,
    order.payment_amount_expected!
  );

  if (!result?.received) {
    return NextResponse.json({
      status: order.status,
      confirmations: order.payment_confirmations || 0,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[order.crypto as CryptoChain] || 1,
    });
  }

  if (result.confirmed) {
    // Fully confirmed
    await db.from('orders').update({
      status: 'confirmed',
      payment_amount_received: result.amount,
      payment_tx_hash: result.txHash,
      payment_confirmations: result.confirmations,
      payment_confirmed_at: new Date().toISOString(),
    }).eq('id', order.id);

    // Decrement product stock for the purchased line items (idempotent).
    const { error: stockErr } = await db.rpc('adjust_stock_for_order', { p_order_id: order.id });
    if (stockErr) console.error('Stock adjustment failed for order', order.id, stockErr);
    const { data: oiRows } = await db
      .from('order_items')
      .select('product_id')
      .eq('order_id', order.id);
    const lowStockIds = (oiRows ?? []).map((r: any) => r.product_id).filter(Boolean);
    await checkLowStockForProducts(db, lowStockIds).catch((e) => console.error('low-stock check failed:', e));

    // Send emails
    if (order.email) {
      sendPaymentConfirmed({ to: order.email, orderNumber: order.order_number })
        .catch((err) => console.error('Confirmed email failed:', err));
    }
    const orderItems = Array.isArray(order.items) ? order.items as Array<{ name: string; quantity: number }> : [];
    sendAdminPaymentNotification({
      orderNumber: order.order_number,
      total: Number(order.total),
      crypto: order.crypto,
      paymentAmount: result.amount,
      customerEmail: order.email || undefined,
      items: orderItems,
    }).catch((err) => console.error('Admin notification failed:', err));

    return NextResponse.json({
      status: 'confirmed',
      confirmations: result.confirmations,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[order.crypto as CryptoChain] || 1,
    });
  } else {
    // Payment detected but not enough confirmations
    await db.from('orders').update({
      status: 'received',
      payment_amount_received: result.amount,
      payment_tx_hash: result.txHash,
      payment_confirmations: result.confirmations,
    }).eq('id', order.id);

    return NextResponse.json({
      status: 'received',
      confirmations: result.confirmations,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[order.crypto as CryptoChain] || 1,
    });
  }
}
