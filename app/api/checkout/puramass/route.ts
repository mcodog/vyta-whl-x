import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabase, supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import {
  isPuramassConfigured,
  createPuramassOrder,
  isPuramassPriceRejection,
  PuramassApiError,
  type PuramassCreateOrderInput,
  type PuramassOrderLine,
} from '@/lib/payments/puramass';
import {
  declaredValueItems,
  priceCheckoutLines,
  subtotalCents,
  type CheckoutLine,
} from '@/lib/payments/puramass-pricing';
import {
  getPuramassShippingSettings,
  parseFulfillmentType,
  resolvePuramassShipping,
} from '@/lib/payments/puramass-shipping';
import { getDefaultRecipientPhone } from '@/lib/shipping/easyship';
import { createStealthHealthFulfillmentInvoice } from '@/lib/admin/invoices';
import { puramassCheckoutEnabledByConfig } from '@/puramass.config';

/**
 * POST /api/checkout/puramass
 *
 * Hand a storefront cart off to the PuraMass hosted checkout: map each cart line
 * to its `puramass_sku`, create a hosted-checkout order, record the hand-off in
 * `puramass_orders`, and return the `payment_link` to redirect the customer to.
 *
 * There are two shapes of hand-off, chosen by the
 * `puramass_customer_checkout_enabled` setting:
 *
 *  - **Off (the original behaviour).** SKUs and quantities only. PuraMass prices
 *    the order from its own catalog and collects the shipping address on its
 *    page. Per-customer pricing and courier choice do not apply.
 *
 *  - **On.** The order names its own amounts: each line carries the
 *    `unit_price_cents` this customer sees on the storefront, the order carries
 *    their `currency` and a `shipping_total_cents` for the courier they picked
 *    here. The recipient address and courier are recorded on the ledger so an
 *    Easyship shipment can be created when the order is paid.
 *
 *    A customer collecting their order in person picks **pickup** instead of a
 *    courier: no address, no rate, and `shipping_total_cents: 0` — which is also
 *    what switches off PuraMass's own default shipping rate, so "pickup" really
 *    is nothing charged for shipping. Nothing is shipped for such an order, so
 *    no Easyship shipment is created when it is paid.
 *
 * Gated by the config-file switch, the admin toggle, and the server credentials.
 * **Never trusts a price, a SKU, or a shipping cost sent by the client** — all
 * three are re-resolved here.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface IncomingItem {
  id: string;
  quantity: number;
  packSize?: number;
  name?: string;
}

/**
 * The recipient address the customer entered.
 *
 * Field names follow the `orders.shipping_address` convention already used
 * across the app (camelCase, `address` for the street line) so the same object
 * drops straight into the order row and into `createEasyshipShipment` without
 * a translation step.
 */
interface ShippingAddress {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  phone: string;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`puramass-checkout:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  // Config-file master switch (puramass.config.ts). When off, no new orders are
  // handed to PuraMass — the storefront uses the in-house checkout instead.
  if (!puramassCheckoutEnabledByConfig()) {
    return NextResponse.json(
      { error: 'PuraMass checkout is disabled.' },
      { status: 403 },
    );
  }

  // The API credentials must be present server-side.
  if (!isPuramassConfigured()) {
    return NextResponse.json(
      { error: 'PuraMass checkout is not configured.' },
      { status: 503 },
    );
  }

  const db = getSupabase();

  // The admin toggle must be on. Read defensively so a pre-migration database
  // (no column) is treated as "disabled" rather than 500ing.
  try {
    const { data: settings } = await db
      .from('site_settings')
      .select('puramass_checkout_enabled')
      .single();
    if (!settings?.puramass_checkout_enabled) {
      return NextResponse.json(
        { error: 'PuraMass checkout is disabled.' },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'PuraMass checkout is disabled.' },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const rawItems: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];
  const customer = body?.customer ?? {};
  const email = typeof customer.email === 'string' ? customer.email.trim() : '';
  const firstName =
    typeof customer.firstName === 'string' ? customer.firstName.trim() : undefined;
  const lastName =
    typeof customer.lastName === 'string' ? customer.lastName.trim() : undefined;
  // Phone is optional everywhere: a blank one falls back to the house number
  // when the shipment is created, and is simply not sent to PuraMass.
  const phone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
  const referralCode =
    typeof body?.referralCode === 'string' && body.referralCode.trim()
      ? body.referralCode.trim().slice(0, 32)
      : null;

  if (!rawItems.length) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  // Keep each line's pack size + quantity so the right SKU can be picked below:
  // a single-vial line (packSize 1) hands off the vial SKU with quantity =
  // vials; a pack-of-10 line hands off the case SKU with quantity = packs.
  const lines: CheckoutLine[] = [];
  for (const it of rawItems) {
    if (!it || typeof it.id !== 'string') {
      return NextResponse.json({ error: 'Invalid cart item.' }, { status: 400 });
    }
    const qty = Number(it.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Invalid cart quantity.' }, { status: 400 });
    }
    lines.push({ id: it.id, packSize: it.packSize === 1 ? 1 : 10, quantity: qty });
  }

  // Best-effort: attach the signed-in customer if a valid token is present.
  // Their identity is what selects their price list and billing currency.
  let customerId: string | null = null;
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    try {
      const { data } = await supabase.auth.getUser(token);
      customerId = data.user?.id ?? null;
    } catch {
      customerId = null;
    }
  }

  // Resolve the SKUs and the customer's own prices from the database. The
  // prices are only *sent* when the feature is on (below), but resolving them
  // either way keeps SKU mapping and its 409 in one place.
  let pricing;
  try {
    pricing = await priceCheckoutLines(db, customerId, lines);
  } catch {
    return NextResponse.json(
      { error: 'Could not load products. Please try again.' },
      { status: 500 },
    );
  }

  if (pricing.unmapped.length) {
    return NextResponse.json(
      {
        error:
          'Some items are not yet available through the hosted checkout. Please contact support.',
        unmapped: pricing.unmapped,
      },
      { status: 409 },
    );
  }
  if (!pricing.lines.length) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  }

  const shippingSettings = await getPuramassShippingSettings(db);

  // Pickup is a choice about OUR amounts (shipping charged as zero), so it only
  // exists in the mode where we name them. With the customer checkout off,
  // PuraMass prices the order and applies its own shipping on its own page —
  // refuse rather than hand back a link that charges for delivery the customer
  // just said they don't want.
  const fulfillment = parseFulfillmentType(body?.fulfillment);
  const isPickup = fulfillment === 'pickup';
  if (isPickup && !shippingSettings.enabled) {
    return NextResponse.json(
      { error: 'Pickup is not available at this checkout.' },
      { status: 409 },
    );
  }

  // ---- Shipping + pricing (feature on) -------------------------------------
  let shippingAddress: ShippingAddress | null = null;
  let shippingTotalCents: number | undefined;
  let courierId: string | null = null;
  let courierName: string | null = null;

  if (isPickup) {
    // Nothing to quote and nothing to deliver: the customer collects it. Zero
    // is sent explicitly — it is what tells the partner API not to apply its
    // own default rate — and the ledger keeps no address, which is what stops a
    // shipment being created when the order is paid.
    shippingTotalCents = 0;
  } else if (shippingSettings.enabled) {
    const ship = body?.shipping ?? {};
    const address: ShippingAddress = {
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      address: str(ship.line1),
      city: str(ship.city),
      state: str(ship.state),
      postalCode: str(ship.postalCode),
      country: str(ship.country) || 'CA',
      email,
      // Phone is optional for the customer; the house number stands in so the
      // courier always has a contact. Configured in Settings.
      phone: phone || (await getDefaultRecipientPhone()),
    };
    if (!address.address || !address.city || !address.postalCode) {
      return NextResponse.json(
        { error: 'A complete shipping address is required.' },
        { status: 400 },
      );
    }

    courierId = str(ship.courierId);
    if (!courierId) {
      return NextResponse.json(
        { error: 'Please choose a shipping method.' },
        { status: 400 },
      );
    }

    // Re-quote the chosen courier now. The client's figure is ignored: this is
    // the amount the customer is actually charged.
    const rateItems = declaredValueItems(pricing);
    const resolved = await resolvePuramassShipping(
      db,
      {
        address: address.address,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      },
      rateItems,
      { currency: pricing.currency, rate: pricing.rate },
      courierId,
    );
    if (!resolved) {
      // No live rate. Refuse rather than send 0, which the partner API reads as
      // free shipping — the customer would be undercharged and we'd eat it.
      return NextResponse.json(
        {
          error:
            'Shipping could not be quoted for that address. Please check it, or contact support.',
        },
        { status: 409 },
      );
    }
    shippingTotalCents = resolved.cents;
    courierId = resolved.option.courierId;
    courierName = resolved.option.courier;
    shippingAddress = address;
  }

  // Line items: SKU + quantity always; the customer's own price only when the
  // feature is on (otherwise PuraMass prices the order from its catalog, which
  // is the original behaviour).
  const lineItems: PuramassOrderLine[] = pricing.lines.map((l) => ({
    sku: l.sku,
    quantity: l.quantity,
    ...(shippingSettings.enabled ? { unit_price_cents: l.unitPriceCents } : {}),
  }));

  const partnerReference = `amc_${randomUUID()}`;
  const orderInput: PuramassCreateOrderInput = {
    items: lineItems,
    customer: {
      email,
      first_name: firstName,
      last_name: lastName,
      ...(phone ? { phone } : {}),
    },
    partnerReference,
    ...(shippingSettings.enabled
      ? { currency: pricing.currency, shippingTotalCents }
      : {}),
  };

  let order;
  try {
    order = await createPuramassOrder(orderInput);
  } catch (err) {
    if (isPuramassPriceRejection(err)) {
      // The API refused one of our amounts — most often a line under the
      // wholesale price it invoices us for. That floor is our cost, so it stays
      // out of the customer's view; the detail is logged for an admin.
      console.error('PuraMass rejected checkout pricing:', (err as PuramassApiError).message);
      return NextResponse.json(
        {
          error:
            'Checkout could not be completed for one of these items. Please contact support.',
        },
        { status: 409 },
      );
    }
    if (err instanceof PuramassApiError) {
      // Surface client (4xx) messages; collapse everything else to a gateway
      // error. Never echo credentials.
      const status = err.status >= 400 && err.status < 500 ? err.status : 502;
      return NextResponse.json(
        { error: err.message || 'PuraMass could not create the order.' },
        { status },
      );
    }
    console.error('PuraMass checkout error:', err);
    return NextResponse.json(
      { error: 'Checkout failed. Please try again.' },
      { status: 502 },
    );
  }

  // Record the hand-off for reconciliation, and so the paid-order webhook can
  // create the Easyship shipment against the address and courier chosen here.
  // A failure must not block the customer's redirect — log and continue.
  const ledgerItems = pricing.lines.map((l) => ({
    sku: l.sku,
    quantity: l.quantity,
    name: l.name,
    ...(shippingSettings.enabled ? { unit_price_cents: l.unitPriceCents } : {}),
  }));
  const ledgerRow: Record<string, unknown> = {
    partner_reference: partnerReference,
    transaction_id: order.transaction_id,
    payment_link: order.payment_link,
    status: order.status,
    subtotal_cents: order.subtotal_cents || subtotalCents(pricing.lines),
    customer_id: customerId,
    customer_email: email,
    items: ledgerItems,
    referral_code: referralCode,
  };
  if (shippingSettings.enabled) {
    Object.assign(ledgerRow, {
      currency: pricing.currency,
      shipping_total_cents: shippingTotalCents ?? 0,
      shipping_address: shippingAddress,
      shipping_courier_id: courierId,
      shipping_courier: courierName,
      // Why this row has no address or courier, so a pickup can be told apart
      // from a hand-off that let PuraMass collect the address on its own page.
      fulfillment_type: fulfillment,
    });
  }
  let ledgerId: string | null = null;
  try {
    const insert = (row: Record<string, unknown>) =>
      db.from('puramass_orders').insert(row).select('id').single();
    let { data, error } = await insert(ledgerRow);
    if (error && 'fulfillment_type' in ledgerRow) {
      // `fulfillment_type` is the newest column here. Drop just that one first:
      // falling straight to the minimal row below would cost every order its
      // currency, shipping and address on a database that has only this one
      // migration left to run.
      const { fulfillment_type: _dropped, ...withoutFulfillment } = ledgerRow;
      ({ data, error } = await insert(withoutFulfillment));
    }
    if (error) {
      // A column from a migration that hasn't run yet must not lose the row —
      // fall back to the columns that have always existed.
      console.error('PuraMass hand-off insert failed, retrying minimal:', error.message);
      const { data: minimal } = await db
        .from('puramass_orders')
        .insert({
          partner_reference: partnerReference,
          transaction_id: order.transaction_id,
          payment_link: order.payment_link,
          status: order.status,
          subtotal_cents: ledgerRow.subtotal_cents,
          customer_id: customerId,
          customer_email: email,
          items: ledgerItems,
          referral_code: referralCode,
        })
        .select('id')
        .single();
      ledgerId = minimal?.id ?? null;
    } else {
      ledgerId = data?.id ?? null;
    }
  } catch (err) {
    console.error('Failed to record PuraMass hand-off:', err);
  }

  // Raise the invoice now, in `pending_payment`, rather than waiting for the
  // payment webhook. The customer gets something to look at on their account
  // dashboard — and a link to finish paying — the moment they are handed off,
  // and an order that is paid but whose webhook never lands still leaves a
  // record behind instead of vanishing.
  //
  // Only when the customer checkout is on: that is the mode where we name the
  // amounts, so the invoice can state what will actually be charged. With it
  // off, PuraMass prices the order from its own catalog and we don't know the
  // figures until its webhook reports them — so that path still raises the
  // invoice on payment, as it always has.
  if (ledgerId && shippingSettings.enabled) {
    try {
      await createStealthHealthFulfillmentInvoice(
        db as any,
        {
          id: ledgerId,
          transaction_id: order.transaction_id,
          customer_id: customerId,
          customer_email: email,
          items: ledgerItems,
          invoice_id: null,
        },
        pricing.lines.map((l) => ({
          sku: l.sku,
          name: l.name,
          quantity: l.quantity,
          unit_price_cents: l.unitPriceCents,
        })),
        {
          status: 'pending_payment',
          paymentLink: order.payment_link,
          shippingCents: shippingTotalCents ?? 0,
          currency: pricing.currency,
          recipient: {
            name: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
            // A pickup has no address to take the phone from, so the one the
            // customer typed stands on its own.
            phone: shippingAddress?.phone || phone || null,
          },
          courier: courierName,
          // A pickup invoice is held at the counter rather than packed for a
          // courier — the warehouse queue reads this off the invoice.
          fulfillmentType: fulfillment,
        },
      );
    } catch (err) {
      // Never block the redirect on the invoice — the customer has a live
      // payment link and the webhook can still create one on payment.
      console.error('PuraMass pending invoice creation failed:', err);
    }
  }

  return NextResponse.json({
    payment_link: order.payment_link,
    transaction_id: order.transaction_id,
    status: order.status,
  });
}

/** A trimmed string from untrusted JSON, or '' for anything else. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
