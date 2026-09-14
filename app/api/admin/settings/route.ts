import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import {
  DEFAULT_ADMIN_BODY,
  DEFAULT_ADMIN_SUBJECT,
  DEFAULT_CUSTOMER_BODY,
  DEFAULT_CUSTOMER_SUBJECT,
} from '@/lib/invoice-email-templates';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';
import { isPuramassConfigured } from '@/lib/payments/puramass';
import { puramassCheckoutEnabledByConfig } from '@/puramass.config';
import {
  DEFAULT_PAYMENT_BODY,
  DEFAULT_PAYMENT_SUBJECT,
} from '@/lib/payment-email-templates';
import { normaliseReceivingWallets } from '@/lib/payments/receiving-wallets';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Original columns that always exist.
const BASE_SETTINGS_COLUMNS =
  'checkout_type, admin_emails, pickup_address, guest_checkout_enabled, invoice_cc_emails, invoice_customer_email_subject, invoice_customer_email_body, invoice_admin_email_subject, invoice_admin_email_body';
// Easyship columns added by easyship-settings-migration.sql.
const EASYSHIP_COLUMNS =
  'easyship_enabled, easyship_api_key, shipping_origin, shipping_box, shipping_item_weight_kg, shipping_flat_rate';
// Handling-fee columns added by shipping-handling-fee-migration.sql.
const HANDLING_FEE_COLUMNS =
  'shipping_handling_fee_type, shipping_handling_fee_value';
// Auto-shipment columns added by easyship-auto-shipment-migration.sql.
const AUTO_SHIPMENT_COLUMNS =
  'easyship_auto_create_shipment, easyship_auto_courier_preference, easyship_auto_buy_label';
// Inactive-customer alert columns added by
// inactive-customer-notifications-and-takeover-migration.sql.
const INACTIVE_CUSTOMER_COLUMNS =
  'inactive_customer_notification_enabled, inactive_customer_notify_days';
// E-Transfer email automation column added by
// etransfer-email-automation-migration.sql.
const ETRANSFER_EMAIL_COLUMNS = 'etransfer_email_delay_minutes';
// CAD→USD multiplier column added by product-usd-price-migration.sql.
const USD_RATE_COLUMNS = 'usd_exchange_rate';
// Scheduled Stock Report email columns added by stock-report-email-migration.sql.
const STOCK_REPORT_EMAIL_COLUMNS =
  'stock_report_email_enabled, stock_report_email_recipients, stock_report_email_frequency, stock_report_email_last_sent_at';
// Fulfillment-queue "expired" (aged) threshold added by
// fulfillment-expired-queue-days-migration.sql.
const FULFILLMENT_EXPIRED_COLUMNS = 'fulfillment_expired_days';
// Free-shipping threshold added by free-shipping-threshold-migration.sql.
const FREE_SHIPPING_COLUMNS = 'free_shipping_threshold';
// PuraMass hosted-checkout toggle added by puramass-hosted-checkout-migration.sql.
// Read on its own (see readSettingsRow) so it is never dropped when an unrelated
// optional column is missing from the progressive fallback below.
const PURAMASS_COLUMN = 'puramass_checkout_enabled';
// Signed-in customer hosted-checkout columns added by
// puramass-customer-checkout-migration.sql (the feature toggle, its shipping
// processing fee, and the house recipient phone). Read on their own for the
// same reason as the PuraMass toggle above: they must not be dropped just
// because an unrelated optional column is missing.
const PURAMASS_CUSTOMER_COLUMNS =
  'puramass_customer_checkout_enabled, puramass_shipping_fee_type, puramass_shipping_fee_value, shipping_default_recipient_phone';
// Invoice payment-request columns added by invoice-payment-request-migration.sql
// (receiving crypto wallets + the payment-email template + the per-method
// toggles). Read on their own for the same reason as the PuraMass toggle: they
// must not be dropped just because an unrelated optional column is missing.
const PAYMENT_REQUEST_COLUMNS =
  'crypto_wallets, crypto_payment_instructions, payment_email_subject, payment_email_body, payment_crypto_enabled, payment_card_enabled';
const SETTINGS_COLUMNS = `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}, ${ETRANSFER_EMAIL_COLUMNS}, ${USD_RATE_COLUMNS}, ${STOCK_REPORT_EMAIL_COLUMNS}, ${FULFILLMENT_EXPIRED_COLUMNS}, ${FREE_SHIPPING_COLUMNS}`;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseEmailList(value: unknown): string[] | { error: string } {
  if (!Array.isArray(value)) return { error: 'must be an array' };
  const cleaned: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return { error: `invalid email entry: ${String(raw)}` };
    const v = raw.trim();
    if (!v) continue;
    if (!emailRegex.test(v)) return { error: `Invalid email format: ${v}` };
    cleaned.push(v);
  }
  return cleaned;
}

function shape(data: Record<string, unknown>) {
  return {
    // Crypto checkout is disabled site-wide — the store always uses the
    // email/invoice flow. Any legacy 'crypto' value is surfaced as 'email'.
    checkout_type: 'email',
    admin_emails: data.admin_emails ?? [],
    pickup_address: data.pickup_address ?? '',
    guest_checkout_enabled: data.guest_checkout_enabled ?? true,
    invoice_cc_emails: data.invoice_cc_emails ?? [],
    invoice_customer_email_subject:
      data.invoice_customer_email_subject || DEFAULT_CUSTOMER_SUBJECT,
    invoice_customer_email_body:
      data.invoice_customer_email_body || DEFAULT_CUSTOMER_BODY,
    invoice_admin_email_subject:
      data.invoice_admin_email_subject || DEFAULT_ADMIN_SUBJECT,
    invoice_admin_email_body:
      data.invoice_admin_email_body || DEFAULT_ADMIN_BODY,
    // Shipping (Easyship). The API key itself is never returned — only
    // whether one is configured.
    easyship_enabled: data.easyship_enabled ?? false,
    easyship_api_key_set: Boolean(data.easyship_api_key),
    shipping_origin: data.shipping_origin ?? {},
    shipping_box: data.shipping_box ?? {},
    shipping_item_weight_kg:
      data.shipping_item_weight_kg != null
        ? Number(data.shipping_item_weight_kg)
        : 0.05,
    shipping_flat_rate:
      data.shipping_flat_rate != null ? Number(data.shipping_flat_rate) : 20,
    // Handling/packing markup applied on top of live rates.
    shipping_handling_fee_type:
      data.shipping_handling_fee_type === 'percent' ? 'percent' : 'flat',
    shipping_handling_fee_value:
      data.shipping_handling_fee_value != null
        ? Number(data.shipping_handling_fee_value)
        : 0,
    // Auto-shipment (server-side, best-effort) toggles.
    easyship_auto_create_shipment: data.easyship_auto_create_shipment ?? false,
    easyship_auto_courier_preference:
      data.easyship_auto_courier_preference === 'ups' ||
      data.easyship_auto_courier_preference === 'fedex'
        ? data.easyship_auto_courier_preference
        : 'cheapest',
    easyship_auto_buy_label: data.easyship_auto_buy_label ?? false,
    // Inactive-customer (registered but hasn't ordered) admin alert.
    inactive_customer_notification_enabled:
      data.inactive_customer_notification_enabled ?? false,
    inactive_customer_notify_days: Array.isArray(data.inactive_customer_notify_days)
      ? (data.inactive_customer_notify_days as unknown[])
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d > 0)
      : [],
    // Default minutes to delay the customer e-Transfer invoice email. 0 = instant.
    etransfer_email_delay_minutes:
      data.etransfer_email_delay_minutes != null &&
      Number.isFinite(Number(data.etransfer_email_delay_minutes))
        ? Number(data.etransfer_email_delay_minutes)
        : 0,
    // CAD→USD multiplier used to compute auto USD prices (USD = CAD × rate).
    usd_exchange_rate:
      data.usd_exchange_rate != null &&
      Number.isFinite(Number(data.usd_exchange_rate)) &&
      Number(data.usd_exchange_rate) > 0
        ? Number(data.usd_exchange_rate)
        : 0.73,
    // Scheduled Stock Report email. `last_sent_at` is read-only (stamped by the
    // cron / manual send) and surfaced for display only.
    stock_report_email_enabled: data.stock_report_email_enabled ?? false,
    stock_report_email_recipients: Array.isArray(data.stock_report_email_recipients)
      ? (data.stock_report_email_recipients as unknown[]).map((e) => String(e))
      : [],
    stock_report_email_frequency:
      data.stock_report_email_frequency === 'daily' ||
      data.stock_report_email_frequency === 'monthly'
        ? data.stock_report_email_frequency
        : 'weekly',
    stock_report_email_last_sent_at: data.stock_report_email_last_sent_at ?? null,
    // Fulfillment queue: a card is "expired" (aged) once it is at least this
    // many days old. Hidden by default in the warehouse queue.
    fulfillment_expired_days:
      data.fulfillment_expired_days != null &&
      Number.isInteger(Number(data.fulfillment_expired_days)) &&
      Number(data.fulfillment_expired_days) > 0
        ? Number(data.fulfillment_expired_days)
        : 3,
    // Free shipping: discounted product subtotal (CAD) at/above which shipping
    // is free. 0 disables the feature.
    free_shipping_threshold:
      data.free_shipping_threshold != null &&
      Number.isFinite(Number(data.free_shipping_threshold)) &&
      Number(data.free_shipping_threshold) > 0
        ? Number(data.free_shipping_threshold)
        : 0,
    // PuraMass hosted checkout: admin toggle to route the storefront checkout
    // through the PuraMass hosted flow. `puramass_configured` is read-only and
    // reflects whether the server has the API credentials (env). The config-file
    // master switch (puramass.config.ts) is a hard override: when it's off, the
    // effective enabled state is forced false so the storefront falls back to
    // the in-house checkout — regardless of the DB toggle. `puramass_config_disabled`
    // surfaces that state to the admin UI.
    puramass_checkout_enabled:
      (data.puramass_checkout_enabled ?? false) && puramassCheckoutEnabledByConfig(),
    puramass_configured: isPuramassConfigured(),
    puramass_config_disabled: !puramassCheckoutEnabledByConfig(),
    // Signed-in customer hosted checkout: the customer's own prices and currency
    // are sent to PuraMass, they pick a courier here, and an Easyship shipment
    // is created when the order is paid. It only has any effect while the
    // hosted checkout itself is on, so it follows the same config override.
    puramass_customer_checkout_enabled:
      (data.puramass_customer_checkout_enabled ?? false) && puramassCheckoutEnabledByConfig(),
    // Processing fee added on top of each courier rate at that checkout. The
    // general Easyship handling fee is NOT applied there, so the two can't stack.
    puramass_shipping_fee_type:
      data.puramass_shipping_fee_type === 'percent' ? 'percent' : 'flat',
    puramass_shipping_fee_value:
      data.puramass_shipping_fee_value != null &&
      Number.isFinite(Number(data.puramass_shipping_fee_value))
        ? Number(data.puramass_shipping_fee_value)
        : 0,
    // House phone used as the shipment recipient contact when the customer
    // leaves theirs blank (phone is optional at checkout; email is not).
    shipping_default_recipient_phone:
      typeof data.shipping_default_recipient_phone === 'string'
        ? data.shipping_default_recipient_phone
        : '',
    // Invoice payment requests: the receiving crypto wallets the payment page
    // offers, the instructions shown beside them, the payment-email template,
    // and which of the two methods are on. Card payments ride the PuraMass
    // hosted checkout, so they also need its credentials + config switch — the
    // read-only `payment_card_available` folds that in for the admin UI.
    crypto_wallets: normaliseReceivingWallets(data.crypto_wallets),
    crypto_payment_instructions:
      typeof data.crypto_payment_instructions === 'string'
        ? data.crypto_payment_instructions
        : '',
    payment_email_subject: data.payment_email_subject || DEFAULT_PAYMENT_SUBJECT,
    payment_email_body: data.payment_email_body || DEFAULT_PAYMENT_BODY,
    payment_crypto_enabled: data.payment_crypto_enabled ?? false,
    payment_card_enabled: data.payment_card_enabled ?? true,
    payment_card_available:
      (data.payment_card_enabled ?? true) &&
      isPuramassConfigured() &&
      puramassCheckoutEnabledByConfig(),
  };
}

/**
 * Read the settings row with a progressive column fallback so it keeps working
 * even when an optional migration (auto-shipment → handling-fee → Easyship)
 * hasn't run yet. Used by both GET and the PUT response so neither 500s on a
 * pre-migration database.
 */
async function readSettingsRow(db: ReturnType<typeof getSupabase>) {
  const columnSets = [
    SETTINGS_COLUMNS,
    // Same as above but without the free-shipping threshold (its migration may
    // not have run yet).
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}, ${ETRANSFER_EMAIL_COLUMNS}, ${USD_RATE_COLUMNS}, ${STOCK_REPORT_EMAIL_COLUMNS}, ${FULFILLMENT_EXPIRED_COLUMNS}`,
    // Same as above but without the fulfillment "expired" threshold (its
    // migration may not have run yet).
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}, ${ETRANSFER_EMAIL_COLUMNS}, ${USD_RATE_COLUMNS}, ${STOCK_REPORT_EMAIL_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}, ${ETRANSFER_EMAIL_COLUMNS}, ${USD_RATE_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}, ${ETRANSFER_EMAIL_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}, ${INACTIVE_CUSTOMER_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}, ${AUTO_SHIPMENT_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}, ${HANDLING_FEE_COLUMNS}`,
    `${BASE_SETTINGS_COLUMNS}, ${EASYSHIP_COLUMNS}`,
    BASE_SETTINGS_COLUMNS,
  ];
  let data: Record<string, unknown> | null = null;
  let error: unknown = null;
  for (const cols of columnSets) {
    ({ data, error } = await db.from('site_settings').select(cols).single() as any);
    if (!error) break;
  }

  // Read the PuraMass toggle on its own and merge it in. It's orthogonal to the
  // other optional migrations, so folding it into the progressive fallback above
  // would silently drop it whenever any *unrelated* optional column is missing
  // from this database (which would make the admin toggle appear to revert and
  // the storefront ignore it, even though the column is set in the DB).
  let puramassEnabled = false;
  const { data: pm, error: pmErr } = (await db
    .from('site_settings')
    .select(PURAMASS_COLUMN)
    .single()) as any;
  if (!pmErr && pm) puramassEnabled = pm.puramass_checkout_enabled ?? false;

  // Same treatment for the invoice payment-request columns: an independent read
  // so they survive whichever optional column set the fallback above settled on,
  // and an empty object (rather than a throw) before their migration has run.
  let paymentRequest: Record<string, unknown> = {};
  const { data: pr, error: prErr } = (await db
    .from('site_settings')
    .select(PAYMENT_REQUEST_COLUMNS)
    .single()) as any;
  if (!prErr && pr) paymentRequest = pr;

  // And for the signed-in customer checkout columns, so a database that hasn't
  // run their migration reads them as defaults (feature off) instead of losing
  // every other optional column alongside them.
  let customerCheckout: Record<string, unknown> = {};
  const { data: pc, error: pcErr } = (await db
    .from('site_settings')
    .select(PURAMASS_CUSTOMER_COLUMNS)
    .single()) as any;
  if (!pcErr && pc) customerCheckout = pc;

  if (!error && data) {
    return {
      data: {
        ...data,
        ...paymentRequest,
        ...customerCheckout,
        puramass_checkout_enabled: puramassEnabled,
      },
      error: null,
    };
  }
  // The base read failed entirely (e.g. no row yet). Still surface the toggles so
  // the admin UI and storefront reflect them; shape() defaults the rest.
  if (!pmErr) {
    return {
      data: {
        ...paymentRequest,
        ...customerCheckout,
        puramass_checkout_enabled: puramassEnabled,
      },
      error: null,
    };
  }
  return { data, error };
}

export async function GET() {
  try {
    const db = getSupabase();
    const { data, error } = await readSettingsRow(db);

    if (error) {
      console.error('Error fetching settings:', error);
      return NextResponse.json(shape({}));
    }
    // `data` can be null when the settings row doesn't exist yet — shape() then
    // fills in every default.
    return NextResponse.json(shape(data ?? {}));
  } catch (err) {
    console.error('Settings fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let actorId: string | null = null;
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    actorId = user.id;
    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = customer?.role || 'customer';
    if (!canAccessAdmin(role) || role === 'assistant') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      checkout_type,
      admin_emails,
      pickup_address,
      guest_checkout_enabled,
      invoice_cc_emails,
      invoice_customer_email_subject,
      invoice_customer_email_body,
      invoice_admin_email_subject,
      invoice_admin_email_body,
      easyship_enabled,
      easyship_api_key,
      shipping_origin,
      shipping_box,
      shipping_item_weight_kg,
      shipping_flat_rate,
      shipping_handling_fee_type,
      shipping_handling_fee_value,
      easyship_auto_create_shipment,
      easyship_auto_courier_preference,
      easyship_auto_buy_label,
      inactive_customer_notification_enabled,
      inactive_customer_notify_days,
      etransfer_email_delay_minutes,
      usd_exchange_rate,
      stock_report_email_enabled,
      stock_report_email_recipients,
      stock_report_email_frequency,
      fulfillment_expired_days,
      free_shipping_threshold,
      puramass_checkout_enabled,
      puramass_customer_checkout_enabled,
      puramass_shipping_fee_type,
      puramass_shipping_fee_value,
      shipping_default_recipient_phone,
      crypto_wallets,
      crypto_payment_instructions,
      payment_email_subject,
      payment_email_body,
      payment_crypto_enabled,
      payment_card_enabled,
    } = body;

    const updates: Record<string, unknown> = {};
    // Crypto checkout is disabled site-wide — the only supported mode is
    // email/invoice. Any value provided is coerced to 'email'.
    if (checkout_type !== undefined) updates.checkout_type = 'email';

    if (admin_emails !== undefined) {
      const result = normaliseEmailList(admin_emails);
      if (!Array.isArray(result)) {
        return NextResponse.json({ error: `admin_emails ${result.error}` }, { status: 400 });
      }
      updates.admin_emails = result;
    }

    if (invoice_cc_emails !== undefined) {
      const result = normaliseEmailList(invoice_cc_emails);
      if (!Array.isArray(result)) {
        return NextResponse.json({ error: `invoice_cc_emails ${result.error}` }, { status: 400 });
      }
      updates.invoice_cc_emails = result;
    }

    if (pickup_address !== undefined) updates.pickup_address = pickup_address;
    if (guest_checkout_enabled !== undefined) {
      if (typeof guest_checkout_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'guest_checkout_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.guest_checkout_enabled = guest_checkout_enabled;
    }

    for (const [k, v] of Object.entries({
      invoice_customer_email_subject,
      invoice_customer_email_body,
      invoice_admin_email_subject,
      invoice_admin_email_body,
    })) {
      if (v !== undefined) {
        if (typeof v !== 'string') {
          return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
        }
        updates[k] = v;
      }
    }

    // Shipping (Easyship) config
    if (easyship_enabled !== undefined) {
      if (typeof easyship_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'easyship_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.easyship_enabled = easyship_enabled;
    }
    // Only overwrite the API key when a non-empty value is supplied, so saving
    // other settings never wipes it. Send a single space to intentionally clear.
    if (typeof easyship_api_key === 'string' && easyship_api_key.length > 0) {
      updates.easyship_api_key = easyship_api_key.trim();
    }
    if (shipping_origin !== undefined) {
      if (typeof shipping_origin !== 'object' || shipping_origin === null || Array.isArray(shipping_origin)) {
        return NextResponse.json({ error: 'shipping_origin must be an object' }, { status: 400 });
      }
      const o = shipping_origin as Record<string, unknown>;
      updates.shipping_origin = {
        line_1: String(o.line_1 ?? ''),
        city: String(o.city ?? ''),
        state: String(o.state ?? ''),
        postal_code: String(o.postal_code ?? ''),
        country_alpha2: String(o.country_alpha2 ?? 'CA'),
        // Sender contact — Easyship requires these to create a shipment/label.
        company_name: String(o.company_name ?? ''),
        contact_name: String(o.contact_name ?? ''),
        contact_email: String(o.contact_email ?? ''),
        contact_phone: String(o.contact_phone ?? ''),
      };
    }
    if (shipping_box !== undefined) {
      if (typeof shipping_box !== 'object' || shipping_box === null || Array.isArray(shipping_box)) {
        return NextResponse.json({ error: 'shipping_box must be an object' }, { status: 400 });
      }
      const b = shipping_box as Record<string, unknown>;
      updates.shipping_box = {
        length: Number(b.length) || 0,
        width: Number(b.width) || 0,
        height: Number(b.height) || 0,
      };
    }
    if (shipping_handling_fee_type !== undefined) {
      if (!['flat', 'percent'].includes(shipping_handling_fee_type)) {
        return NextResponse.json(
          { error: 'shipping_handling_fee_type must be "flat" or "percent"' },
          { status: 400 },
        );
      }
      updates.shipping_handling_fee_type = shipping_handling_fee_type;
    }
    // Auto-shipment toggles.
    for (const [k, v] of Object.entries({
      easyship_auto_create_shipment,
      easyship_auto_buy_label,
    })) {
      if (v !== undefined) {
        if (typeof v !== 'boolean') {
          return NextResponse.json({ error: `${k} must be a boolean` }, { status: 400 });
        }
        updates[k] = v;
      }
    }
    if (easyship_auto_courier_preference !== undefined) {
      if (!['cheapest', 'ups', 'fedex'].includes(easyship_auto_courier_preference)) {
        return NextResponse.json(
          { error: 'easyship_auto_courier_preference must be "cheapest", "ups" or "fedex"' },
          { status: 400 },
        );
      }
      updates.easyship_auto_courier_preference = easyship_auto_courier_preference;
    }
    // Inactive-customer alert config.
    if (inactive_customer_notification_enabled !== undefined) {
      if (typeof inactive_customer_notification_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'inactive_customer_notification_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.inactive_customer_notification_enabled =
        inactive_customer_notification_enabled;
    }
    if (inactive_customer_notify_days !== undefined) {
      if (!Array.isArray(inactive_customer_notify_days)) {
        return NextResponse.json(
          { error: 'inactive_customer_notify_days must be an array of days' },
          { status: 400 },
        );
      }
      const days: number[] = [];
      for (const raw of inactive_customer_notify_days) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 3650) {
          return NextResponse.json(
            { error: 'Each day threshold must be a whole number between 1 and 3650' },
            { status: 400 },
          );
        }
        days.push(n);
      }
      // De-duplicate and sort ascending so the nudges read in order.
      updates.inactive_customer_notify_days = Array.from(new Set(days)).sort(
        (a, b) => a - b,
      );
    }

    // E-Transfer email delay (minutes). 0 = instant. Cap at 7 days so a typo
    // can't strand an order's email indefinitely.
    if (etransfer_email_delay_minutes !== undefined) {
      const n = Number(etransfer_email_delay_minutes);
      if (!Number.isInteger(n) || n < 0 || n > 10080) {
        return NextResponse.json(
          { error: 'etransfer_email_delay_minutes must be a whole number of minutes between 0 and 10080' },
          { status: 400 },
        );
      }
      updates.etransfer_email_delay_minutes = n;
    }

    // CAD→USD multiplier. Must be a positive number. Capped generously so a
    // stray keystroke can't produce absurd USD prices.
    if (usd_exchange_rate !== undefined) {
      const n = Number(usd_exchange_rate);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        return NextResponse.json(
          { error: 'usd_exchange_rate must be a positive number' },
          { status: 400 },
        );
      }
      updates.usd_exchange_rate = n;
    }

    // Scheduled Stock Report email config.
    if (stock_report_email_enabled !== undefined) {
      if (typeof stock_report_email_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'stock_report_email_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.stock_report_email_enabled = stock_report_email_enabled;
    }
    if (stock_report_email_recipients !== undefined) {
      const result = normaliseEmailList(stock_report_email_recipients);
      if (!Array.isArray(result)) {
        return NextResponse.json(
          { error: `stock_report_email_recipients ${result.error}` },
          { status: 400 },
        );
      }
      updates.stock_report_email_recipients = result;
    }
    if (stock_report_email_frequency !== undefined) {
      if (!['daily', 'weekly', 'monthly'].includes(stock_report_email_frequency)) {
        return NextResponse.json(
          { error: 'stock_report_email_frequency must be "daily", "weekly" or "monthly"' },
          { status: 400 },
        );
      }
      updates.stock_report_email_frequency = stock_report_email_frequency;
    }

    // Fulfillment-queue "expired" (aged) threshold, in days. Must be a positive
    // whole number; capped so a typo can't hide the entire queue forever.
    if (fulfillment_expired_days !== undefined) {
      const n = Number(fulfillment_expired_days);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return NextResponse.json(
          { error: 'fulfillment_expired_days must be a whole number of days between 1 and 365' },
          { status: 400 },
        );
      }
      updates.fulfillment_expired_days = n;
    }

    // Free-shipping threshold (CAD). Non-negative; 0 disables it. Capped so a
    // stray keystroke can't set an absurd figure.
    if (free_shipping_threshold !== undefined) {
      const n = Number(free_shipping_threshold);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        return NextResponse.json(
          { error: 'free_shipping_threshold must be a non-negative number' },
          { status: 400 },
        );
      }
      updates.free_shipping_threshold = n;
    }

    // PuraMass hosted-checkout toggle.
    if (puramass_checkout_enabled !== undefined) {
      if (typeof puramass_checkout_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'puramass_checkout_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.puramass_checkout_enabled = puramass_checkout_enabled;
    }

    // ---- Signed-in customer hosted checkout --------------------------------
    // The feature master toggle: customer pricing + currency, courier choice,
    // and the Easyship shipment created when the order is paid.
    if (puramass_customer_checkout_enabled !== undefined) {
      if (typeof puramass_customer_checkout_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'puramass_customer_checkout_enabled must be a boolean' },
          { status: 400 },
        );
      }
      updates.puramass_customer_checkout_enabled = puramass_customer_checkout_enabled;
    }
    if (puramass_shipping_fee_type !== undefined) {
      if (!['flat', 'percent'].includes(puramass_shipping_fee_type)) {
        return NextResponse.json(
          { error: 'puramass_shipping_fee_type must be "flat" or "percent"' },
          { status: 400 },
        );
      }
      updates.puramass_shipping_fee_type = puramass_shipping_fee_type;
    }
    // The fee rides on top of every courier rate the customer sees, so it's
    // capped: a flat fee at $10,000 and a percentage at 100% of the rate, so a
    // stray keystroke can't quietly double a shipping charge.
    if (puramass_shipping_fee_value !== undefined) {
      const n = Number(puramass_shipping_fee_value);
      const max = puramass_shipping_fee_type === 'percent' ? 100 : 10000;
      if (!Number.isFinite(n) || n < 0 || n > max) {
        return NextResponse.json(
          { error: `puramass_shipping_fee_value must be between 0 and ${max}` },
          { status: 400 },
        );
      }
      updates.puramass_shipping_fee_value = n;
    }
    // House phone used as the shipment recipient contact when the customer
    // gives none. Blank is valid — the built-in default then applies.
    if (shipping_default_recipient_phone !== undefined) {
      if (typeof shipping_default_recipient_phone !== 'string') {
        return NextResponse.json(
          { error: 'shipping_default_recipient_phone must be a string' },
          { status: 400 },
        );
      }
      updates.shipping_default_recipient_phone = shipping_default_recipient_phone.trim();
    }

    // ---- Invoice payment requests ------------------------------------------
    // Receiving crypto wallets shown on the payment page. Normalised through the
    // shared helper so a malformed row is dropped rather than stored — the
    // customer-facing page reads these straight out of the database.
    if (crypto_wallets !== undefined) {
      if (!Array.isArray(crypto_wallets)) {
        return NextResponse.json(
          { error: 'crypto_wallets must be an array' },
          { status: 400 },
        );
      }
      // Report the rows that were dropped rather than silently losing an edit —
      // a wallet needs both a label and an address to be worth showing.
      const incomplete = crypto_wallets.filter((w: unknown) => {
        if (!w || typeof w !== 'object') return true;
        const r = w as Record<string, unknown>;
        const hasLabel = typeof r.label === 'string' && r.label.trim().length > 0;
        const hasAddress = typeof r.address === 'string' && r.address.trim().length > 0;
        // An entirely blank row is just an unused editor slot — ignore it.
        return (hasLabel || hasAddress) && !(hasLabel && hasAddress);
      });
      if (incomplete.length > 0) {
        return NextResponse.json(
          { error: 'Every crypto wallet needs both a label and an address.' },
          { status: 400 },
        );
      }
      updates.crypto_wallets = normaliseReceivingWallets(crypto_wallets);
    }

    for (const [k, v] of Object.entries({
      crypto_payment_instructions,
      payment_email_subject,
      payment_email_body,
    })) {
      if (v !== undefined) {
        if (typeof v !== 'string') {
          return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
        }
        updates[k] = v;
      }
    }

    for (const [k, v] of Object.entries({
      payment_crypto_enabled,
      payment_card_enabled,
    })) {
      if (v !== undefined) {
        if (typeof v !== 'boolean') {
          return NextResponse.json({ error: `${k} must be a boolean` }, { status: 400 });
        }
        updates[k] = v;
      }
    }

    for (const [k, v] of Object.entries({
      shipping_item_weight_kg,
      shipping_flat_rate,
      shipping_handling_fee_value,
    })) {
      if (v !== undefined) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
        }
        updates[k] = n;
      }
    }

    const db = getSupabase();
    const { data: existing } = await db
      .from('site_settings')
      .select('id')
      .single();

    let writeError: { message?: string } | null = null;
    if (existing) {
      // Write without RETURNING, then re-read with the progressive column
      // fallback so an unrelated save (e.g. admin emails) never 500s on a
      // database where the optional auto-shipment migration hasn't run yet.
      const { error } = await db
        .from('site_settings')
        .update(updates)
        .eq('id', existing.id);
      writeError = error;
    } else {
      const { error } = await db.from('site_settings').insert({
        checkout_type: 'email',
        admin_emails: updates.admin_emails ?? [],
        pickup_address: updates.pickup_address ?? '',
        guest_checkout_enabled: updates.guest_checkout_enabled ?? true,
        invoice_cc_emails: updates.invoice_cc_emails ?? [],
        invoice_customer_email_subject:
          updates.invoice_customer_email_subject ?? DEFAULT_CUSTOMER_SUBJECT,
        invoice_customer_email_body:
          updates.invoice_customer_email_body ?? DEFAULT_CUSTOMER_BODY,
        invoice_admin_email_subject:
          updates.invoice_admin_email_subject ?? DEFAULT_ADMIN_SUBJECT,
        invoice_admin_email_body:
          updates.invoice_admin_email_body ?? DEFAULT_ADMIN_BODY,
        easyship_enabled: updates.easyship_enabled ?? false,
        easyship_api_key: updates.easyship_api_key ?? '',
        shipping_origin: updates.shipping_origin ?? {},
        shipping_box: updates.shipping_box ?? {},
        shipping_item_weight_kg: updates.shipping_item_weight_kg ?? 0.05,
        shipping_flat_rate: updates.shipping_flat_rate ?? 20,
        shipping_handling_fee_type: updates.shipping_handling_fee_type ?? 'flat',
        shipping_handling_fee_value: updates.shipping_handling_fee_value ?? 0,
        easyship_auto_create_shipment: updates.easyship_auto_create_shipment ?? false,
        easyship_auto_courier_preference:
          updates.easyship_auto_courier_preference ?? 'cheapest',
        easyship_auto_buy_label: updates.easyship_auto_buy_label ?? false,
        inactive_customer_notification_enabled:
          updates.inactive_customer_notification_enabled ?? false,
        inactive_customer_notify_days:
          updates.inactive_customer_notify_days ?? [],
        etransfer_email_delay_minutes:
          updates.etransfer_email_delay_minutes ?? 0,
        usd_exchange_rate: updates.usd_exchange_rate ?? 0.73,
        stock_report_email_enabled: updates.stock_report_email_enabled ?? false,
        stock_report_email_recipients: updates.stock_report_email_recipients ?? [],
        stock_report_email_frequency: updates.stock_report_email_frequency ?? 'weekly',
        fulfillment_expired_days: updates.fulfillment_expired_days ?? 3,
        free_shipping_threshold: updates.free_shipping_threshold ?? 0,
        puramass_checkout_enabled: updates.puramass_checkout_enabled ?? false,
      });
      writeError = error;
    }

    if (writeError) {
      console.error('Error updating settings:', writeError);
      return NextResponse.json(
        { error: writeError.message || 'Failed to update settings' },
        { status: 500 },
      );
    }

    const { data: fresh } = await readSettingsRow(db);
    await logAuditServer(supabase, {
      actor_id: user.id,
      action: 'settings.update',
      entity_type: 'settings',
      entity_id: null,
      // Only the names of the changed setting keys are recorded — never any
      // secret values (e.g. easyship_api_key is logged as a key name only).
      payload: { keys: Object.keys(updates) },
    });
    return NextResponse.json({ success: true, settings: shape(fresh ?? {}) });
  } catch (err) {
    console.error('Settings update error:', err);
    await logErrorServer(supabase, {
      area: 'settings',
      route: '/api/admin/settings',
      method: 'PUT',
      error: err,
      actor_id: actorId,
    });
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
