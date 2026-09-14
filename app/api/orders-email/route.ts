import { NextRequest, NextResponse, after } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { sendAdminInvoiceNotificationSMTP } from '@/lib/email-smtp';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveShippingCost, getFreeShippingThreshold, applyFreeShipping } from '@/lib/shipping/easyship';
import { autoCreateShipmentForOrder } from '@/lib/shipping/auto-shipment';
import { autoCreateInvoiceFromOrder } from '@/lib/admin/invoices';
import { claimAndSendEtransferEmail } from '@/lib/etransfer-email';
import {
  resolveAffiliateAttribution,
  AFFILIATE_DISCOUNT_RATE,
  AFFILIATE_COMMISSION_RATE,
  round2,
} from '@/lib/affiliate/commission';
import { DEFAULT_USD_RATE, toPriceCurrency, usdFromCad } from '@/lib/pricing';
import { resolveCheckoutPaymentMethod } from '@/lib/paymentMethod';
import { qtyToVials, resolveVialsPerBox } from '@/lib/admin/stock-units';
import { cartPriceKey, cartPriceMap, resolveCartPrices } from '@/lib/cart-pricing';

// Basic, permissive email shape check — rejects obvious typos like a missing
// domain (`john@gmial`) or missing @, without trying to fully validate RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PICKUP_ADDRESS = {
  address: "123 Main St",
  city: "", // TODO: fill in before going live
  state: "", // TODO: fill in before going live
  postalCode: "", // TODO: fill in before going live
  country: "CA",
};

function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `AMC-${code}`;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`orders:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many orders. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 }
    );
  }

  const body = await req.json();
  const { items, shipping, referralCode, customerId, fulfillmentType, shippingCourierId } = body;
  const isPickup = fulfillmentType === 'pickup';
  // Currency the order is billed in (from the customer's price_currency tag).
  // CAD is the base; USD orders store USD amounts. Product prices are CAD, so
  // shipping/Easyship customs values are always computed in CAD then converted.
  const currency = toPriceCurrency(body.currency);
  // Resolve the requested payment method against the active checkout methods
  // (Interac e-Transfer or Bitcoin). Anything inactive/unknown normalises back
  // to the default rather than being trusted, so the stored order and the email
  // wording can never claim a method we don't actually take.
  const paymentMethod = resolveCheckoutPaymentMethod(body.paymentMethod);

  if (!items?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!shipping?.firstName || !shipping?.lastName || !shipping?.email) {
    return NextResponse.json({ error: 'Missing shipping information' }, { status: 400 });
  }

  // Validate the email shape server-side. The invoice / e-Transfer instructions
  // are delivered *only* by email, so a typo'd address (which otherwise sails
  // through to a "success" screen) means the customer never hears from us and we
  // never collect payment. Reject it up front instead.
  if (!EMAIL_RE.test(String(shipping.email).trim())) {
    return NextResponse.json(
      { error: 'Please enter a valid email address so we can send your invoice.', code: 'invalid_email' },
      { status: 400 },
    );
  }

  if (!isPickup && !shipping?.address) {
    return NextResponse.json({ error: 'Missing shipping address' }, { status: 400 });
  }

  const db = getSupabase();

  // --- Stock availability guard --------------------------------------------
  // The storefront only sells in-stock products (out-of-stock shows a "Notify
  // Me" button, never an Add-to-Cart), so an order must never exceed live
  // stock. Re-validate here so a stale cart or two concurrent checkouts can't
  // oversell a scarce SKU and leave the customer paying for product we can't
  // ship. Stock is counted in vials; a box line consumes vials_per_box vials.
  const stockLines = (items as any[]).filter((it) => it?.id);
  if (stockLines.length > 0) {
    const productIds = [...new Set(stockLines.map((it) => it.id))];
    const { data: prodRows } = await db
      .from('products')
      .select('id, name, stock_quantity, vials_per_box')
      .in('id', productIds);
    const prodMap = new Map((prodRows ?? []).map((p: any) => [p.id, p]));
    // Sum required vials per product across every line referencing it.
    const requiredVials = new Map<string, number>();
    for (const it of stockLines) {
      const p = prodMap.get(it.id);
      const priceType = it.priceType === 'vial' ? 'vial' : it.priceType === 'box' ? 'box' : null;
      const need = qtyToVials(Number(it.quantity) || 0, p?.vials_per_box, priceType);
      requiredVials.set(it.id, (requiredVials.get(it.id) ?? 0) + need);
    }
    const shortfalls: Array<{ product_id: string; name: string; requested_vials: number; available_vials: number; vials_per_box: number }> = [];
    for (const [pid, need] of requiredVials) {
      const p = prodMap.get(pid);
      const available = Math.max(0, Number(p?.stock_quantity) || 0);
      if (need > available) {
        shortfalls.push({
          product_id: pid,
          name: p?.name ?? 'Item',
          requested_vials: need,
          available_vials: available,
          vials_per_box: resolveVialsPerBox(p?.vials_per_box),
        });
      }
    }
    if (shortfalls.length > 0) {
      const names = shortfalls.map((s) => s.name).join(', ');
      return NextResponse.json(
        {
          error: `Some items are no longer available in the quantity requested (${names}). Please adjust your cart and try again.`,
          code: 'insufficient_stock',
          shortfalls,
        },
        { status: 409 },
      );
    }
  }

  // Verify customer_id if provided (don't trust client blindly)
  let verifiedCustomerId: string | null = null;
  if (customerId) {
    const { data: customer } = await db.from('customers').select('id').eq('id', customerId).single();
    if (customer) verifiedCustomerId = customer.id;
  }

  // --- Authoritative line prices -------------------------------------------
  // The cart carries the price that was on screen when each item was added, and
  // it survives in localStorage across reloads, sign-ins and account switches —
  // so the figure the browser sends up can be a price this customer was never
  // entitled to (a guest's catalog price, or an override an admin has since
  // changed). Re-derive every line from the database against the *verified*
  // customer and bill from that. `lib/cart-pricing` is the same resolver the
  // storefront cart re-prices itself against, so the order and the screen agree.
  //
  // Which form a line is priced in comes from `packSize` when the client sent
  // one, and otherwise from `priceType` — a cart open in a tab from before
  // `packSize` was on the wire would otherwise price a single vial as if it
  // were a tenth of a case.
  const lineForm = (item: any): number =>
    Number(item?.packSize) === 1 || item?.priceType === 'vial' ? 1 : 10;
  const pricing = await resolveCartPrices(
    db,
    verifiedCustomerId,
    (items as any[]).map((it) => ({ id: it?.id, packSize: lineForm(it) })),
  );
  const pricedByKey = cartPriceMap(pricing);
  const unsellable: string[] = [];
  const pricedItems = (items as any[]).map((item) => {
    const resolved = item?.id ? pricedByKey.get(cartPriceKey(item.id, lineForm(item))) : undefined;
    // A line with no product behind it (a legacy cart entry) keeps what it came
    // with rather than being dropped — there is nothing to re-derive it from.
    if (!resolved) return item;
    if (!resolved.available) {
      unsellable.push(resolved.name || item.name || 'Item');
      return item;
    }
    return { ...item, price: resolved.price, priceUsd: resolved.priceUsd };
  });
  if (unsellable.length > 0) {
    return NextResponse.json(
      {
        error: `Some items are no longer available on your account (${unsellable.join(', ')}). Please refresh your cart and try again.`,
        code: 'unavailable_items',
        items: unsellable,
      },
      { status: 409 },
    );
  }

  const subtotal = pricedItems.reduce(
    (sum: number, item: any) => sum + item.price * item.quantity,
    0,
  );

  // Affiliate attribution: bound customer or referral code → discount the
  // product subtotal for the customer and earn the affiliate a commission.
  const attribution = await resolveAffiliateAttribution(db, {
    customerId: verifiedCustomerId,
    referralCode,
  });
  const discountAmount = attribution ? round2(subtotal * AFFILIATE_DISCOUNT_RATE) : 0;
  const discountedSubtotal = round2(subtotal - discountAmount);

  // The courier the customer picked at checkout. Only its *id* comes from the
  // client — the cost is re-quoted from Easyship below, and the id is validated
  // by the fact that a rate has to come back for it.
  const chosenCourierId =
    typeof shippingCourierId === 'string' && shippingCourierId.trim()
      ? shippingCourierId.trim()
      : null;

  // Resolve shipping server-side (re-validated via Easyship, not trusted from
  // the client). Pickup is always free.
  const resolvedShipping = isPickup
    ? 0
    : await resolveShippingCost(
        {
          address: shipping.address,
          city: shipping.city,
          state: shipping.state,
          postalCode: shipping.postalCode,
          country: shipping.country,
        },
        pricedItems.map((item: any) => ({ quantity: item.quantity, declaredValue: item.price * item.quantity })),
        chosenCourierId ?? undefined,
      );
  // Free shipping once the discounted CAD subtotal clears the admin threshold.
  const shippingCost = applyFreeShipping(
    resolvedShipping,
    discountedSubtotal,
    await getFreeShippingThreshold(),
  );
  const total = round2(discountedSubtotal + shippingCost);

  // Restate the order in the customer's billing currency. The CAD figures above
  // stay the source of truth for shipping/Easyship customs and affiliate
  // commissions; the *Billed values below are what gets stored, invoiced, and
  // emailed. For CAD orders they equal the CAD figures.
  let usdRate = DEFAULT_USD_RATE;
  if (currency === 'USD') {
    const { data: rateRow } = await db
      .from('site_settings')
      .select('usd_exchange_rate')
      .maybeSingle();
    const n = Number(rateRow?.usd_exchange_rate);
    if (Number.isFinite(n) && n > 0) usdRate = n;
  }
  // Whether this customer's configured prices convert into their billing
  // currency, or are charged as-is and merely denominated in it (the default —
  // see customers.convert_storefront_prices). Read server-side from the
  // verified customer, never from the request body. A guest, or a database
  // whose migration hasn't run, does not convert.
  let convertPrices = false;
  if (currency === 'USD' && verifiedCustomerId) {
    const { data: convRow, error: convErr } = await db
      .from('customers')
      .select('convert_storefront_prices')
      .eq('id', verifiedCustomerId)
      .maybeSingle();
    if (!convErr) convertPrices = convRow?.convert_storefront_prices === true;
  }
  // The multiplier actually applied to a configured figure: 1 when this
  // customer's prices don't convert, so 156 is billed as 156 USD.
  const priceRate = currency === 'USD' && !convertPrices ? 1 : usdRate;
  const lineUnit = (item: any): number =>
    currency === 'USD'
      ? // A cart line's `priceUsd` snapshot is itself a converted figure, so it
        // only applies when this customer converts.
        convertPrices && item.priceUsd != null && Number(item.priceUsd) >= 0
        ? round2(Number(item.priceUsd))
        : usdFromCad(Number(item.price), priceRate)
      : round2(Number(item.price));
  // Items as stored/emailed, with each price restated in the billing currency.
  const storedItems = pricedItems.map((item: any) => ({ ...item, price: lineUnit(item) }));
  const subtotalBilled = round2(
    storedItems.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0),
  );
  const discountBilled = attribution ? round2(subtotalBilled * AFFILIATE_DISCOUNT_RATE) : 0;
  const discountedSubtotalBilled = round2(subtotalBilled - discountBilled);
  // Shipping converts at the REAL rate even for a customer whose prices don't:
  // the courier charges us an actual CAD amount, so billing it as-is in USD
  // would under-recover it by the exchange rate. Only configured prices are
  // exempt from conversion.
  const shippingBilled = currency === 'USD' ? usdFromCad(shippingCost, usdRate) : round2(shippingCost);
  const totalBilled = round2(discountedSubtotalBilled + shippingBilled);

  // How long to wait before sending the customer's Interac e-Transfer invoice
  // email — a store-wide default configured in admin/settings. 0 = instant
  // (the default). Delayed sends are flushed by the send-etransfer-emails cron.
  // Tolerate a pre-migration database (column absent) by defaulting to instant.
  let etransferDelayMinutes = 0;
  {
    const { data: delayRow, error: delayErr } = await db
      .from('site_settings')
      .select('etransfer_email_delay_minutes')
      .maybeSingle();
    if (!delayErr) {
      const n = Number(delayRow?.etransfer_email_delay_minutes);
      if (Number.isFinite(n) && n >= 0) etransferDelayMinutes = n;
    }
  }
  const etransferSendAfter = new Date(
    Date.now() + etransferDelayMinutes * 60_000,
  ).toISOString();

  // Whether to write the per-order e-Transfer scheduling columns. They only
  // exist once etransfer-email-automation-migration.sql has been applied. On a
  // pre-migration database the insert would fail with PGRST204 ("column not
  // found"); we detect that below, drop the columns, and fall back to the
  // pre-automation behaviour (send the invoice email instantly) so checkout
  // never breaks just because the migration hasn't run yet.
  let includeEtransferScheduling = true;

  // Whether to write the currency column. Only present once
  // order-currency-migration.sql has run. On a pre-migration database the
  // insert would fail with PGRST204; we detect that below and retry without it
  // (the order then defaults to CAD, matching pre-USD behaviour).
  let includeCurrency = true;

  // Retry loop for unique order number
  for (let i = 0; i < 5; i++) {
    const orderNumber = generateOrderNumber();

    const { data: order, error } = await db
      .from('orders')
      .insert({
        customer_id: verifiedCustomerId,
        order_number: orderNumber,
        items: storedItems,
        total: totalBilled,
        discount_amount: discountBilled,
        ...(includeCurrency ? { currency } : {}),
        email: shipping.email,
        // Keep the customer name on pickup orders (the pickup address itself has
        // none) so a later/delayed invoice email can still address them by name.
        shipping_address: isPickup
          ? { ...PICKUP_ADDRESS, firstName: shipping.firstName, lastName: shipping.lastName }
          : shipping,
        // `crypto` doubles as the payment-method column: 'email' is the
        // Interac e-Transfer checkout, 'btc' an order placed to be paid in
        // Bitcoin. Both are in-house orders invoiced by email; the value is
        // what decides which payment instructions the customer is sent.
        crypto: paymentMethod === 'btc' ? 'btc' : 'email',
        status: 'pending_invoice',
        referral_code: referralCode || null,
        fulfillment_type: isPickup ? 'pickup' : 'shipment',
        notes: isPickup ? 'PICKUP' : null,
        // Schedule the customer e-Transfer invoice email. Instant orders are
        // sent below in after(); delayed ones are flushed by the cron. Keeping
        // the timestamp on every order also lets the cron retry a failed
        // instant send. Omitted on a pre-migration database (see above).
        ...(includeEtransferScheduling
          ? {
              etransfer_email_send_after: etransferSendAfter,
              etransfer_email_sent_at: null,
            }
          : {}),
      })
      .select('id, order_number')
      .single();

    if (error?.code === '23505') continue; // duplicate order number, retry
    // Pre-migration database: the currency column doesn't exist yet. Retry
    // without it (the order defaults to CAD).
    if (
      error?.code === 'PGRST204' &&
      includeCurrency &&
      /currency/.test(error.message ?? '')
    ) {
      console.warn(
        'Order insert: currency column missing (run order-currency-migration.sql); storing order as CAD.',
      );
      includeCurrency = false;
      i--; // don't consume an order-number attempt for the retry
      continue;
    }
    // Pre-migration database: the scheduling columns don't exist yet. Retry
    // without them and fall back to sending the invoice email instantly.
    if (
      error?.code === 'PGRST204' &&
      includeEtransferScheduling &&
      /etransfer_email_(send_after|sent_at)/.test(error.message ?? '')
    ) {
      console.warn(
        'Order insert: e-Transfer scheduling columns missing (run etransfer-email-automation-migration.sql); falling back to instant send.',
      );
      includeEtransferScheduling = false;
      etransferDelayMinutes = 0; // force the instant send path below
      i--; // don't consume an order-number attempt for the retry
      continue;
    }
    if (error) {
      console.error('Order insert error:', error);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // Insert order items. price_at_time is stored in the order's currency
    // (storedItems already carries the billing-currency unit price).
    const orderItems = storedItems.map((item: any) => ({
      order_id: order.id,
      product_name: item.name,
      product_id: item.id || null,
      quantity: item.quantity,
      price_at_time: item.price,
      strength: item.strength || null,
      // Tag which catalog price the customer chose. 'box' (pack of 10) or
      // 'vial' (single). Null when the cart predates vial pricing.
      price_type: item.priceType === 'vial' || item.priceType === 'box' ? item.priceType : null,
    }));

    await db.from('order_items').insert(orderItems);

    // Create the matching invoice row (idempotent, bound via order_id) so the
    // order shows on the admin invoice page using its canonical design. Never
    // let an invoice failure break checkout — the order is already committed.
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

    const customerName = `${shipping.firstName} ${shipping.lastName}`;

    // The order is fully committed at this point. The remaining work — creating
    // the Easyship shipment (an external API call) and sending the invoice
    // emails over SMTP — is slow and not needed for the checkout response, so
    // run it AFTER the response is sent. `after()` keeps the serverless function
    // alive to finish the work without making the customer wait.
    after(async () => {
      // Auto-create the Easyship shipment (draft, no label bought yet) so the
      // order has a shipment id + tracking page. Gated by the auto-create toggle
      // and the preferred courier (UPS/FedEx/cheapest) in Settings. Best-effort
      // and fully server-side — failures are logged for the admin dashboard and
      // never affect the customer. Skipped for pickup.
      if (!isPickup) {
        // Keep the courier the customer chose on the order. The shipment below
        // carries it too, but an order whose shipment is created later (the
        // auto-create toggle off, a retry from the admin) would otherwise have
        // lost what they paid for. Best-effort: the column arrives with
        // order-shipping-courier-migration.sql and its absence must not matter.
        if (chosenCourierId) {
          try {
            await db
              .from('orders')
              .update({ shipping_courier_id: chosenCourierId })
              .eq('id', order.id);
          } catch (err) {
            console.error('Could not record the chosen courier on order', order.id, err);
          }
        }

        await autoCreateShipmentForOrder(db, {
          id: order.id,
          order_number: order.order_number,
          email: shipping.email,
          shipping_address: shipping,
          items: pricedItems,
          // The service their shipping charge was quoted from — the shipment is
          // locked to it rather than to the site-wide courier preference.
          courierId: chosenCourierId,
          isPickup,
        });
      }

      // Send the customer's Interac e-Transfer invoice email. When the delay is
      // 0 (instant, the default) send it now; otherwise leave it for the
      // send-etransfer-emails cron to flush once it comes due. The claim-based
      // helper stamps etransfer_email_sent_at so the cron never double-sends.
      try {
        if (etransferDelayMinutes <= 0) {
          await claimAndSendEtransferEmail(db, {
            id: order.id,
            order_number: order.order_number,
            email: shipping.email,
            items: storedItems,
            total: totalBilled,
            discount_amount: discountBilled,
            currency,
            shipping_address: isPickup
              ? { ...PICKUP_ADDRESS, firstName: shipping.firstName, lastName: shipping.lastName }
              : shipping,
            referral_code: referralCode || null,
            fulfillment_type: isPickup ? 'pickup' : 'shipment',
            notes: isPickup ? 'PICKUP' : null,
            crypto: paymentMethod === 'btc' ? 'btc' : 'email',
          });
        }
      } catch (err) {
        console.error('Customer e-transfer email send failed:', err);
      }

      // Admin notification always goes out immediately, regardless of the
      // customer email delay — the admin should learn about the order now.
      try {
        // Fetch admin emails from settings
        const { data: settings } = await db
          .from('site_settings')
          .select('admin_emails')
          .single();

        const adminEmails = settings?.admin_emails || [];

        // Send admin notification to all configured admin emails
        const adminEmailResult = await sendAdminInvoiceNotificationSMTP({
          adminEmails,
          orderNumber: order.order_number,
          customerName,
          customerEmail: shipping.email,
          items: storedItems.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            strength: item.strength,
          })),
          subtotal: discountedSubtotalBilled,
          shipping: shippingBilled,
          total: totalBilled,
          shippingAddress: isPickup ? PICKUP_ADDRESS : {
            address: shipping.address,
            city: shipping.city,
            state: shipping.state,
            postalCode: shipping.postalCode,
            country: shipping.country,
          },
          fulfillmentType: isPickup ? 'pickup' : 'shipping',
          paymentMethod,
          referralCode: referralCode || undefined,
          currency,
        });

        if (!adminEmailResult.success) {
          console.error('Failed to send admin notification:', adminEmailResult.error);
        }
      } catch (err) {
        console.error('Email sending failed:', err);
      }
    });

    return NextResponse.json({
      success: true,
      orderNumber: order.order_number,
      total: totalBilled,
      currency,
      message: 'Order created successfully. Invoice sent to your email.',
    });
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
    // `crypto` doubles as the payment-method column, so a confirmation screen
    // rehydrated from an order number can still name the payment instructions
    // that were emailed.
    .select('order_number, status, items, total, email, shipping_address, fulfillment_type, crypto, tracking_number, tracking_status, tracking_url, carrier, created_at')
    .eq('order_number', orderNumber)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
