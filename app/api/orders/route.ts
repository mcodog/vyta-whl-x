import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { deriveAddress, getNextIndex } from '@/lib/crypto-wallets';
import type { CryptoChain } from '@/lib/crypto-wallets';
import { cadToCrypto } from '@/lib/price-feed';
import { sendOrderConfirmation } from '@/lib/email';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { autoCreateInvoiceFromOrder } from '@/lib/admin/invoices';
import { resolveShippingCost, getFreeShippingThreshold, applyFreeShipping } from '@/lib/shipping/easyship';
import {
  resolveAffiliateAttribution,
  AFFILIATE_DISCOUNT_RATE,
  AFFILIATE_COMMISSION_RATE,
  round2,
} from '@/lib/affiliate/commission';

const VALID_CHAINS: CryptoChain[] = ['btc', 'eth', 'sol'];
const ORDER_EXPIRY_HOURS = 3;

function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `AMC-${code}`;
}

export async function POST(req: Request) {
  // Crypto checkout is disabled site-wide — the store uses the email/invoice
  // flow (/api/orders-email) instead. Reject any direct crypto order creation.
  return NextResponse.json(
    { error: 'Crypto checkout is disabled. Please use the email/invoice checkout.' },
    { status: 410 },
  );

  // eslint-disable-next-line no-unreachable
  const ip = getClientIp(req);
  const rl = checkRateLimit(`orders:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many orders. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 }
    );
  }

  const body = await req.json();
  const { items, shipping, crypto, referralCode, customerId, shippingCourierId } = body;

  if (!items?.length || !crypto) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!VALID_CHAINS.includes(crypto)) {
    return NextResponse.json({ error: 'Invalid crypto selection' }, { status: 400 });
  }

  if (!shipping?.firstName || !shipping?.lastName || !shipping?.email || !shipping?.address) {
    return NextResponse.json({ error: 'Missing shipping information' }, { status: 400 });
  }

  const subtotal = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

  const db = getSupabase();

  // Verify customer_id if provided (don't trust client blindly)
  let verifiedCustomerId: string | null = null;
  if (customerId) {
    const { data: customer } = await db.from('customers').select('id').eq('id', customerId).single();
    if (customer) verifiedCustomerId = customer.id;
  }

  // Affiliate attribution: if the customer is bound to an affiliate (or a valid
  // referral code was used), the customer gets a discount on the product
  // subtotal and the affiliate later earns a commission on the discounted
  // subtotal.
  const attribution = await resolveAffiliateAttribution(db, {
    customerId: verifiedCustomerId,
    referralCode,
  });
  const discountAmount = attribution ? round2(subtotal * AFFILIATE_DISCOUNT_RATE) : 0;
  const discountedSubtotal = round2(subtotal - discountAmount);

  // Resolve shipping server-side (re-validated via Easyship, not trusted from
  // the client) so the charged total can't be tampered with.
  const resolvedShipping = await resolveShippingCost(
    {
      address: shipping.address,
      city: shipping.city,
      state: shipping.state,
      postalCode: shipping.postalCode,
      country: shipping.country,
    },
    items.map((item: any) => ({ quantity: item.quantity, declaredValue: item.price * item.quantity })),
    shippingCourierId,
  );
  // Free shipping once the discounted CAD subtotal clears the admin threshold.
  const shippingCost = applyFreeShipping(
    resolvedShipping,
    discountedSubtotal,
    await getFreeShippingThreshold(),
  );
  const total = round2(discountedSubtotal + shippingCost);

  // Retry loop for unique order number
  for (let i = 0; i < 5; i++) {
    const orderNumber = generateOrderNumber();

    const { data: order, error } = await db
      .from('orders')
      .insert({
        customer_id: verifiedCustomerId,
        order_number: orderNumber,
        items,
        total,
        discount_amount: discountAmount,
        email: shipping.email,
        shipping_address: shipping,
        crypto,
        status: 'pending',
        referral_code: referralCode || null,
      })
      .select('id, order_number')
      .single();

    if (error?.code === '23505') continue; // duplicate order number, retry
    if (error) {
      console.error('Order insert error:', error);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // Insert order items
    const orderItems = items.map((item: any) => ({
      order_id: order.id,
      product_name: item.name,
      product_id: item.id || null,
      quantity: item.quantity,
      price_at_time: item.price,
      strength: item.strength || null,
      price_type: item.priceType === 'vial' || item.priceType === 'box' ? item.priceType : null,
    }));

    await db.from('order_items').insert(orderItems);

    // Create the matching invoice for this order (idempotent). Never let an
    // invoice failure break checkout — the order is already committed.
    try {
      await autoCreateInvoiceFromOrder(db, order.id);
    } catch (err) {
      console.error('Invoice creation failed for order', order.id, err);
    }

    // Handle affiliate commission when the order is attributed to an affiliate
    // (bound customer or referral code). The affiliate earns a percentage of
    // the discounted product subtotal. Never let a commission failure 500 the
    // request — the order is already committed.
    if (attribution) {
      try {
        await db.from('commissions').insert({
          affiliate_id: attribution.affiliateId,
          order_id: order.id,
          referral_code_id: attribution.referralCodeId,
          amount: round2(discountedSubtotal * AFFILIATE_COMMISSION_RATE),
          order_total: total,
          commission_rate: AFFILIATE_COMMISSION_RATE,
          status: 'pending',
        });

        // First-touch bind: when attribution came from a referral code, attach
        // this customer to the affiliate if they aren't already bound.
        if (attribution.viaCode && verifiedCustomerId && verifiedCustomerId !== attribution.affiliateId) {
          await db
            .from('customers')
            .update({ affiliate_id: attribution.affiliateId })
            .eq('id', verifiedCustomerId)
            .is('affiliate_id', null);
        }
      } catch (err) {
        console.error('Commission creation failed for order', order.id, err);
      }
    }

    // Derive payment address and crypto amount
    try {
      const derivationIndex = await getNextIndex(crypto as CryptoChain);
      const paymentAddress = await deriveAddress(crypto as CryptoChain, derivationIndex, order.id);
      const paymentAmount = await cadToCrypto(total, crypto as CryptoChain);
      const expiresAt = new Date(Date.now() + ORDER_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

      await db.from('orders').update({
        payment_address: paymentAddress,
        payment_amount_expected: paymentAmount,
        payment_derivation_index: derivationIndex,
        payment_expires_at: expiresAt,
      }).eq('id', order.id);

      // Send order confirmation email
      if (shipping.email) {
        sendOrderConfirmation({
          to: shipping.email,
          customerName: `${shipping.firstName} ${shipping.lastName}`,
          orderNumber: order.order_number,
          items,
          subtotal: discountedSubtotal,
          shipping: shippingCost,
          total,
          currency: 'CAD',
        }).catch((err) => console.error('Order email failed:', err));
      }

      return NextResponse.json({
        orderNumber: order.order_number,
        paymentAddress,
        paymentAmount,
        crypto,
        expiresAt,
        total,
      });
    } catch (err) {
      console.error('Payment address generation failed:', err);
      return NextResponse.json({
        orderNumber: order.order_number,
        error: 'Payment address generation temporarily unavailable. Contact support.',
      }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Failed to generate order number' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const orderNumber = req.nextUrl.searchParams.get('orderNumber');
  if (!orderNumber) {
    return NextResponse.json({ error: 'Order number required' }, { status: 400 });
  }

  const db = getSupabase();
  const { data, error } = await db
    .from('orders')
    .select('order_number, status, items, total, crypto, payment_address, payment_amount_expected, payment_amount_received, payment_tx_hash, payment_confirmations, payment_confirmed_at, payment_expires_at, shipping_address, tracking_number, tracking_status, tracking_url, carrier, created_at')
    .eq('order_number', orderNumber)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
