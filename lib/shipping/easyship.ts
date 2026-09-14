/**
 * Easyship shipping integration: live rates + shipment creation.
 *
 * Configuration is read from the `site_settings` row (editable in the admin
 * Settings page) and falls back to environment variables, then to safe
 * defaults. The Easyship API key is read from the DB or env and is never
 * exposed to the client.
 *
 * SAFETY: every entry point falls back to a flat shipping rate whenever
 * Easyship is disabled, unconfigured, errors, or returns no rates — so the
 * checkout keeps working exactly as before until it is turned on.
 */

import { getSupabase } from '@/lib/supabase';
import { DEFAULT_CLIENT_EMAIL, DEFAULT_CLIENT_PHONE } from '@/lib/shipping/contact-defaults';

const RATES_PATH = '/2024-09/rates';
const SHIPMENTS_PATH = '/2024-09/shipments';
const EASYSHIP_BASE_URL =
  process.env.EASYSHIP_API_URL?.replace(/\/?(2024-09\/rates)?$/, '') ||
  'https://public-api.easyship.com';
const REQUEST_TIMEOUT_MS = 8000;
// Shipment creation can be slower than a rate quote (label/courier work).
const SHIPMENT_TIMEOUT_MS = 25000;

export interface ShippingConfig {
  enabled: boolean;
  apiKey: string;
  origin: {
    line_1: string;
    city: string;
    state: string;
    postal_code: string;
    country_alpha2: string;
  };
  /** Sender contact details — required by Easyship to CREATE a shipment. */
  originContact: {
    company_name: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
  };
  box: { length: number; width: number; height: number };
  itemWeightKg: number;
  flatRate: number;
  /**
   * Markup added on top of each live Easyship rate to cover packing and other
   * manual labour. Baked into the quoted price, never shown as a separate line.
   */
  handlingFeeType: 'flat' | 'percent';
  /** Fee amount: CAD dollars when type is 'flat', percentage points when 'percent'. */
  handlingFeeValue: number;
  /** Easyship item category slug — resolved to an HS code per item. */
  itemCategoryId: string;
  /** Optional explicit HS code (overrides the category's default). */
  hsCode: string;
  /** Customs description sent on each item. */
  itemDescription: string;
}

export interface ShippingDestination {
  address?: string;
  city?: string;
  state?: string;
  postalCode: string;
  country?: string;
}

export interface ShippingRateItem {
  quantity: number;
  /** Declared value (CAD) used for customs — typically line price * qty. */
  declaredValue: number;
}

export interface ShippingQuote {
  cost: number;
  courier: string;
  minDays?: number;
  maxDays?: number;
  currency: string;
  /** True when this is the flat fallback rather than a live Easyship rate. */
  estimated: boolean;
}

export interface ShippingRate {
  /** Easyship courier_service id — used to re-select the rate server-side. */
  courierId: string;
  courier: string;
  cost: number;
  minDays?: number;
  maxDays?: number;
  currency: string;
}

export interface CreatedShipment {
  shipmentId: string;
  trackingNumber?: string;
  trackingUrl?: string;
  courier?: string;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Resolve the effective shipping config: DB settings override env vars which
 * override built-in defaults.
 */
export async function getShippingConfig(): Promise<ShippingConfig> {
  let row: Record<string, any> = {};
  try {
    const db = getSupabase();
    // Try with the handling-fee columns; if that migration hasn't run yet, fall
    // back to the original column set so live rates keep working unchanged.
    let { data, error } = await db
      .from('site_settings')
      .select(
        'easyship_enabled, easyship_api_key, shipping_origin, shipping_box, shipping_item_weight_kg, shipping_flat_rate, shipping_handling_fee_type, shipping_handling_fee_value',
      )
      .single();
    if (error) {
      ({ data } = await db
        .from('site_settings')
        .select(
          'easyship_enabled, easyship_api_key, shipping_origin, shipping_box, shipping_item_weight_kg, shipping_flat_rate',
        )
        .single());
    }
    row = data || {};
  } catch {
    // Settings table/columns unavailable — fall back to env/defaults.
  }

  const origin = row.shipping_origin || {};
  const box = row.shipping_box || {};

  return {
    enabled:
      typeof row.easyship_enabled === 'boolean'
        ? row.easyship_enabled
        : Boolean(process.env.EASYSHIP_API_KEY),
    apiKey: row.easyship_api_key || process.env.EASYSHIP_API_KEY || '',
    origin: {
      line_1: origin.line_1 || process.env.SHIP_ORIGIN_LINE1 || '',
      city: origin.city || process.env.SHIP_ORIGIN_CITY || '',
      state: origin.state || process.env.SHIP_ORIGIN_STATE || '',
      postal_code: origin.postal_code || process.env.SHIP_ORIGIN_POSTAL || '',
      country_alpha2:
        origin.country_alpha2 || process.env.SHIP_ORIGIN_COUNTRY || 'CA',
    },
    originContact: {
      company_name: origin.company_name || process.env.SHIP_ORIGIN_COMPANY || '',
      contact_name: origin.contact_name || process.env.SHIP_ORIGIN_CONTACT_NAME || '',
      contact_email: origin.contact_email || process.env.SHIP_ORIGIN_CONTACT_EMAIL || '',
      contact_phone: origin.contact_phone || process.env.SHIP_ORIGIN_CONTACT_PHONE || '',
    },
    box: {
      length: num(box.length ?? process.env.SHIP_BOX_LENGTH_CM, 20),
      width: num(box.width ?? process.env.SHIP_BOX_WIDTH_CM, 15),
      height: num(box.height ?? process.env.SHIP_BOX_HEIGHT_CM, 10),
    },
    itemWeightKg: num(
      row.shipping_item_weight_kg ?? process.env.SHIP_ITEM_WEIGHT_KG,
      0.05,
    ),
    flatRate: num(
      row.shipping_flat_rate ?? process.env.SHIP_FALLBACK_FLAT_RATE,
      20,
    ),
    handlingFeeType:
      (row.shipping_handling_fee_type ?? process.env.SHIP_HANDLING_FEE_TYPE) ===
      'percent'
        ? 'percent'
        : 'flat',
    handlingFeeValue: num(
      row.shipping_handling_fee_value ?? process.env.SHIP_HANDLING_FEE_VALUE,
      0,
    ),
    itemCategoryId: process.env.SHIP_ITEM_CATEGORY || 'dry_food_supplements',
    hsCode: process.env.SHIP_HS_CODE || '',
    itemDescription: process.env.SHIP_ITEM_DESCRIPTION || 'Supplements',
  };
}

/**
 * The phone number to put on a shipment when the recipient gave none. Couriers
 * require a destination phone, but we don't require one from the customer — so
 * the house number stands in. Configured in Settings
 * (`shipping_default_recipient_phone`); falls back to the built-in default when
 * blank or before that migration has run.
 *
 * Isolated from {@link getShippingConfig} for the same reason as the
 * free-shipping threshold: a pre-migration database must not break live rates.
 */
export async function getDefaultRecipientPhone(): Promise<string> {
  try {
    const db = getSupabase();
    const { data } = await db
      .from('site_settings')
      .select('shipping_default_recipient_phone')
      .maybeSingle();
    const phone = String(data?.shipping_default_recipient_phone ?? '').trim();
    if (phone) return phone;
  } catch {
    /* column/table missing — use the built-in default */
  }
  return DEFAULT_CLIENT_PHONE;
}

/**
 * Read the configured free-shipping threshold (CAD-base subtotal). Returns 0
 * when the feature is disabled, the column/table is missing, or the value is
 * invalid — callers treat 0 as "no free shipping". Isolated from
 * {@link getShippingConfig} so a pre-migration database never breaks live rates.
 */
export async function getFreeShippingThreshold(): Promise<number> {
  try {
    const db = getSupabase();
    const { data } = await db
      .from('site_settings')
      .select('free_shipping_threshold')
      .maybeSingle();
    const n = Number(data?.free_shipping_threshold);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply the free-shipping threshold to a resolved shipping cost. When a
 * positive `threshold` is set and the discounted product subtotal (CAD) reaches
 * it, shipping is free (0); otherwise the original cost stands. `threshold <= 0`
 * disables the feature.
 */
export function applyFreeShipping(
  shippingCost: number,
  discountedSubtotalCad: number,
  threshold: number,
): number {
  if (threshold > 0 && discountedSubtotalCad >= threshold) return 0;
  return shippingCost;
}

async function easyshipFetch(
  path: string,
  apiKey: string,
  body: unknown,
): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${EASYSHIP_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        'Easyship request error:',
        path,
        res.status,
        await res.text().catch(() => ''),
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('Easyship request failed:', path, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRatesBody(
  config: ShippingConfig,
  destination: ShippingDestination,
  items: ShippingRateItem[],
) {
  return {
    origin_address: { ...config.origin },
    destination_address: {
      line_1: destination.address || '',
      city: destination.city || '',
      state: destination.state || '',
      postal_code: destination.postalCode,
      country_alpha2: destination.country || 'CA',
    },
    incoterms: 'DDU',
    insurance: { is_insured: false },
    shipping_settings: {
      units: { weight: 'kg', dimensions: 'cm' },
      output_currency: 'CAD',
    },
    parcels: buildParcels(config, items),
  };
}

// Standard Easyship item categories → HS code. Easyship's 2024-09 schema wants
// hs_code (or a numeric item_category_id) on each item, NOT the category slug.
const CATEGORY_HS_CODES: Record<string, string> = {
  mobile_phones: '85171300',
  tablets: '84713000',
  computers_laptops: '84713000',
  cameras: '85258900',
  accessory_no_battery: '85171400',
  accessory_with_battery: '85171400',
  health_beauty: '33040000',
  fashion: '62032900',
  watches: '91021900',
  home_appliances: '85098000',
  home_decor: '94038990',
  toys: '95030099',
  sport_leisure: '9506910000',
  bags_luggages: '42029210',
  audio_video: '85198160',
  documents: '49011000',
  jewelry: '71022900',
  dry_food_supplements: '17049000',
  books_collectibles: '49019900',
  pet_accessory: '42010000',
};

/** Resolve the HS code to send: explicit override, else the category's code. */
function resolveHsCode(config: ShippingConfig): string {
  if (config.hsCode) return config.hsCode;
  const slug = (config.itemCategoryId || '').toLowerCase();
  return CATEGORY_HS_CODES[slug] || CATEGORY_HS_CODES.dry_food_supplements;
}

// Easyship rejects the whole rates/shipment request (HTTP 422) when any item's
// declared_customs_value is 0 — which happens for $0 line items (freebies,
// promos, a price not yet typed). Customs always needs a positive figure, so we
// floor every item's declared value at this minimum (CAD) rather than let the
// request fail.
const MIN_DECLARED_CUSTOMS_VALUE = 1;

function buildParcels(
  config: ShippingConfig,
  items: ShippingRateItem[],
) {
  const totalQty = items.reduce((sum, it) => sum + (it.quantity || 0), 0) || 1;
  return [
    {
      total_actual_weight: Math.max(
        config.itemWeightKg * totalQty,
        config.itemWeightKg,
      ),
      box: {
        length: config.box.length,
        width: config.box.width,
        height: config.box.height,
      },
      items: items.map((it) => ({
        quantity: it.quantity,
        actual_weight: config.itemWeightKg,
        declared_currency: 'CAD',
        // Never send 0 — Easyship 422s. Floor at MIN_DECLARED_CUSTOMS_VALUE.
        declared_customs_value: Math.max(
          Number(it.declaredValue) || 0,
          MIN_DECLARED_CUSTOMS_VALUE,
        ),
        hs_code: resolveHsCode(config),
        description: config.itemDescription,
      })),
    },
  ];
}

/** Read the courier display name from a rate object across API versions. */
function courierName(rate: any): string {
  return (
    rate?.courier_service?.name ||
    rate?.courier_service?.umbrella_name ||
    rate?.courier_service_name ||
    rate?.courier_name ||
    'Courier'
  );
}

/**
 * Couriers offered at checkout. Only rates from one of these umbrella couriers
 * are shown to the customer and charged — every other courier (e.g. Canpar,
 * Canada Post, Purolator) is excluded. Easyship groups every service under an
 * `umbrella_name` ("UPS Standard®", "FedEx Ground®" → "UPS", "FedEx"), which is
 * what we match on.
 */
const ALLOWED_COURIERS = ['ups', 'fedex'];

/**
 * Couriers offered at the PuraMass hosted checkout (the signed-in customer
 * flow). Same idea as {@link ALLOWED_COURIERS}, but that list is the in-house
 * checkout's and changing it would change what every existing flow offers — so
 * this flow names its own scope: UPS, FedEx and Canada Post.
 *
 * The deny-list still wins, and a courier only appears if the Easyship account
 * actually returns rates for it.
 */
export const PURAMASS_CHECKOUT_COURIERS = ['ups', 'fedex', 'canada post'];

/**
 * Couriers we never ship with, regardless of the allow-list. This is a hard
 * block that takes precedence over {@link ALLOWED_COURIERS}: even if a courier
 * were added to the allow-list (or matched loosely by name), anything here is
 * always filtered out of every rate list — checkout, the admin invoice courier
 * picker, the admin order rates, and auto-shipment selection all funnel through
 * {@link isAllowedCourier}. UniUni is blocked here.
 */
const BLOCKED_COURIERS = ['uniuni'];

/** True when `rate`'s courier appears on the {@link BLOCKED_COURIERS} deny-list. */
export function isBlockedCourier(rate: any): boolean {
  const umbrella = String(rate?.courier_service?.umbrella_name ?? '')
    .toLowerCase()
    .trim();
  if (umbrella && BLOCKED_COURIERS.includes(umbrella)) return true;
  // Also match the display name (whole word) so shapes without umbrella_name —
  // and multi-word service names like "UniUni Standard" — are still caught.
  const name = courierName(rate).toLowerCase();
  return BLOCKED_COURIERS.some((c) => new RegExp(`\\b${c}\\b`).test(name));
}

/**
 * True when `rate`'s courier may be offered: it's on the allow-list AND not on
 * the {@link BLOCKED_COURIERS} deny-list (the deny-list always wins).
 *
 * `allowed` names the scope to check against, defaulting to the in-house
 * checkout's {@link ALLOWED_COURIERS}. The hosted checkout passes its own
 * {@link PURAMASS_CHECKOUT_COURIERS}.
 */
export function isAllowedCourier(
  rate: any,
  allowed: string[] = ALLOWED_COURIERS,
): boolean {
  if (isBlockedCourier(rate)) return false;
  const umbrella = String(rate?.courier_service?.umbrella_name ?? '')
    .toLowerCase()
    .trim();
  if (umbrella) return allowed.includes(umbrella);
  // Older API shapes don't carry umbrella_name — match the display name as a
  // whole word instead so e.g. "UPS Standard" / "FedEx Ground" still pass.
  const name = courierName(rate).toLowerCase();
  return allowed.some((c) => new RegExp(`\\b${c}\\b`).test(name));
}

/**
 * Add the configured handling fee on top of a live courier cost. The fee is a
 * flat CAD amount or a percentage of the rate; it's folded into the quoted
 * price so the customer sees a single shipping figure (never an itemised fee).
 */
export function applyHandlingFee(cost: number, config: ShippingConfig): number {
  const value = config.handlingFeeValue;
  if (!Number.isFinite(value) || value <= 0) return cost;
  const fee = config.handlingFeeType === 'percent' ? cost * (value / 100) : value;
  return Math.round((cost + fee) * 100) / 100;
}

/**
 * A per-request override of the handling ("processing") fee. Used by the admin
 * invoice form so an individual invoice can turn the fee off, or charge a
 * different amount, without touching the global Settings default.
 */
export interface HandlingFeeChoice {
  /** When false, no handling fee is added to the courier rate. */
  apply?: boolean;
  /** Override the fee amount (flat CAD or percentage points). null = use default. */
  value?: number | null;
}

/**
 * Resolve the effective shipping config for a rate request, folding in a
 * per-request {@link HandlingFeeChoice}: `apply: false` zeroes the fee, a
 * finite `value` overrides the configured amount, and anything else leaves the
 * global default in place.
 */
function withHandlingFeeChoice(
  config: ShippingConfig,
  choice?: HandlingFeeChoice,
): ShippingConfig {
  if (!choice) return config;
  if (choice.apply === false) return { ...config, handlingFeeValue: 0 };
  if (choice.value != null && Number.isFinite(choice.value) && choice.value >= 0) {
    return { ...config, handlingFeeValue: choice.value };
  }
  return config;
}

/** Read the total shipping cost from a rate object across API versions. */
function rateCost(rate: any): number | null {
  const value =
    rate?.total_charge ??
    rate?.total_charge_value ??
    rate?.shipment_charge_total ??
    rate?.shipment_charge;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ask Easyship for the cheapest available courier rate to `destination`.
 * Returns `null` if Easyship is disabled/unconfigured/errors/returns nothing.
 */
export async function getEasyshipRates(
  destination: ShippingDestination,
  items: ShippingRateItem[],
  feeChoice?: HandlingFeeChoice,
  /** Courier scope to offer. Defaults to the in-house {@link ALLOWED_COURIERS}. */
  couriers: string[] = ALLOWED_COURIERS,
): Promise<ShippingRate[]> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey || !destination?.postalCode) return [];

  // Per-request fee override (admin invoice form) folds into the config used to
  // compute the quoted cost; everything else keeps the global Settings default.
  const feeConfig = withHandlingFeeChoice(config, feeChoice);
  const body = buildRatesBody(config, destination, items);
  const json = await easyshipFetch(RATES_PATH, config.apiKey, body);
  const rates: any[] = json?.rates || [];

  return rates
    .filter((r) => isAllowedCourier(r, couriers))
    .map((r): ShippingRate | null => {
      const cost = rateCost(r);
      if (cost === null) return null;
      return {
        courierId: String(r?.courier_service?.id || r?.courier_id || ''),
        courier: courierName(r),
        cost: applyHandlingFee(cost, feeConfig),
        minDays: r.min_delivery_time ?? undefined,
        maxDays: r.max_delivery_time ?? undefined,
        currency: r.currency || 'CAD',
      };
    })
    .filter((r): r is ShippingRate => r !== null)
    .sort((a, b) => a.cost - b.cost);
}

export async function getCheapestEasyshipRate(
  destination: ShippingDestination,
  items: ShippingRateItem[],
): Promise<ShippingQuote | null> {
  const rates = await getEasyshipRates(destination, items);
  if (!rates.length) return null;
  const c = rates[0];
  return {
    cost: c.cost,
    courier: c.courier,
    minDays: c.minDays,
    maxDays: c.maxDays,
    currency: c.currency,
    estimated: false,
  };
}

/**
 * Resolve the shipping cost to charge for an order. Always returns a number:
 * the live Easyship rate when available, otherwise the configured flat rate.
 */
export async function resolveShippingCost(
  destination: ShippingDestination,
  items: ShippingRateItem[],
  courierId?: string,
): Promise<number> {
  const rates = await getEasyshipRates(destination, items);
  if (rates.length) {
    // Honor the customer's chosen courier when it's a real returned rate;
    // otherwise charge the cheapest. Cost is taken from Easyship, never the
    // client, so it can't be tampered with.
    if (courierId) {
      const chosen = rates.find((r) => r.courierId === courierId);
      if (chosen) return chosen.cost;
    }
    return rates[0].cost;
  }
  const config = await getShippingConfig();
  return config.flatRate;
}

/** Like {@link getCheapestEasyshipRate} but never null — falls back to flat. */
export async function getShippingQuoteOrFallback(
  destination: ShippingDestination,
  items: ShippingRateItem[],
): Promise<ShippingQuote> {
  const quote = await getCheapestEasyshipRate(destination, items);
  if (quote) return quote;
  const config = await getShippingConfig();
  return {
    cost: config.flatRate,
    courier: 'Standard Shipping',
    currency: 'CAD',
    estimated: true,
  };
}

export interface ShippingDiagnostics {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
  apiKeyLast4: string | null;
  apiBaseUrl: string;
  ratesEndpoint: string;
  origin: ShippingConfig['origin'];
  originComplete: boolean;
  box: ShippingConfig['box'];
  itemWeightKg: number;
  flatRate: number;
  reason: string | null;
  test: {
    httpStatus: number | null;
    ok: boolean;
    rateCount: number;
    cheapestCost: number | null;
    cheapestCourier: string | null;
    error: string | null;
    /** First rate or, on error, the raw response body (truncated). */
    sample: any;
  } | null;
}

/**
 * Run the live Easyship rate path against `destination` and report exactly what
 * happened — config state, HTTP status, rate count, and a sample/error. Never
 * returns the API key (only a masked suffix). Admin diagnostic only.
 */
export async function diagnoseShipping(
  destination: ShippingDestination,
  items: ShippingRateItem[],
): Promise<ShippingDiagnostics> {
  const config = await getShippingConfig();
  const envKey = process.env.EASYSHIP_API_KEY || '';
  // config.apiKey is `db || env`, so if it differs from env it came from the DB.
  const fromDb = Boolean(config.apiKey) && config.apiKey !== envKey;
  const originComplete = Boolean(
    config.origin.line_1 &&
      config.origin.city &&
      config.origin.postal_code &&
      config.origin.country_alpha2,
  );

  const diag: ShippingDiagnostics = {
    enabled: config.enabled,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeySource: config.apiKey ? (fromDb ? 'database' : 'env') : 'none',
    apiKeyLast4: config.apiKey ? config.apiKey.slice(-4) : null,
    apiBaseUrl: EASYSHIP_BASE_URL,
    ratesEndpoint: `${EASYSHIP_BASE_URL}${RATES_PATH}`,
    origin: config.origin,
    originComplete,
    box: config.box,
    itemWeightKg: config.itemWeightKg,
    flatRate: config.flatRate,
    reason: null,
    test: null,
  };

  if (!config.enabled) {
    diag.reason = 'Easyship is disabled (easyship_enabled is false / not turned on in Settings).';
    return diag;
  }
  if (!config.apiKey) {
    diag.reason = 'No API key configured (set it in Settings or EASYSHIP_API_KEY).';
    return diag;
  }
  if (!originComplete) {
    diag.reason = 'Origin address is incomplete — Easyship needs line_1, city, postal_code, country.';
  }

  const body = buildRatesBody(config, destination, items);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${EASYSHIP_BASE_URL}${RATES_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    const rates: any[] = json?.rates || [];
    const cheapest = rates.reduce((min, r) => {
      const c = rateCost(r);
      return c !== null && (min === null || c < rateCost(min)!) ? r : min;
    }, null as any);

    diag.test = {
      httpStatus: res.status,
      ok: res.ok,
      rateCount: rates.length,
      cheapestCost: cheapest ? rateCost(cheapest) : null,
      cheapestCourier: cheapest ? courierName(cheapest) : null,
      error: res.ok ? null : json?.error?.message || json?.message || text.slice(0, 800),
      sample: rates[0] ?? (res.ok ? null : json ?? text.slice(0, 800)),
    };

    if (!diag.reason) {
      if (!res.ok) diag.reason = `Easyship returned HTTP ${res.status}.`;
      else if (rates.length === 0)
        diag.reason = 'Easyship returned 0 rates (often: no courier connected, or address/parcel rejected).';
    }
  } catch (e: any) {
    diag.test = {
      httpStatus: null,
      ok: false,
      rateCount: 0,
      cheapestCost: null,
      cheapestCourier: null,
      error: e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e),
      sample: null,
    };
    if (!diag.reason) diag.reason = 'Request to Easyship failed (network/timeout).';
  } finally {
    clearTimeout(timeout);
  }

  return diag;
}

/**
 * Create an Easyship shipment for a paid order so a label + tracking number
 * exist and tracking webhooks start flowing. Best-effort: returns `null` on
 * any failure. The order's `order_number` is sent as `platform_order_number`
 * so webhooks can be matched back even if the shipment id isn't stored.
 */
export interface ShipmentCreateResult {
  shipment: CreatedShipment | null;
  error?: string;
  httpStatus?: number;
}

export async function createEasyshipShipment(order: {
  order_number: string;
  email?: string | null;
  shipping_address: any;
  items: any[];
  /** Optional Easyship courier_service id to lock the shipment to. */
  courierId?: string | null;
  /** Insure the parcel (Easyship covers the declared value). Defaults to off. */
  insured?: boolean;
}): Promise<ShipmentCreateResult> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey) {
    return { shipment: null, error: 'Easyship not enabled/configured' };
  }

  const ship = order.shipping_address || {};
  if (!ship.postalCode && !ship.postal_code) {
    return { shipment: null, error: 'Order has no shipping postal code' };
  }

  // Easyship rejects a shipment without a destination phone, but phone is
  // optional on our side: fall back to the sender's number, then the house
  // default (Settings → `shipping_default_recipient_phone`), so a missing
  // customer phone never blocks the label.
  const destinationPhone =
    ship.phone || config.originContact.contact_phone || (await getDefaultRecipientPhone());

  const items: ShippingRateItem[] = (order.items || []).map((it: any) => ({
    quantity: Number(it.quantity) || 1,
    declaredValue: Number(it.price) * (Number(it.quantity) || 1) || 0,
  }));

  const body = {
    // NOTE: the 2024-09 ShipmentCreate schema rejects platform_name /
    // platform_order_number. Webhooks are matched by the stored
    // easyship_shipment_id (saved right after creation) instead.
    origin_address: {
      ...config.origin,
      company_name: config.originContact.company_name || undefined,
      contact_name: config.originContact.contact_name || undefined,
      contact_email: config.originContact.contact_email || undefined,
      contact_phone: config.originContact.contact_phone || undefined,
    },
    destination_address: {
      contact_name:
        `${ship.firstName || ''} ${ship.lastName || ''}`.trim() || 'Customer',
      // Prefer the destination's own email (e.g. a client's, for a client
      // shipment) over the account email, then the sender's contact email, then
      // the house default — email is optional on our side, so a missing address
      // email never blocks the label.
      contact_email:
        ship.email || order.email || config.originContact.contact_email || DEFAULT_CLIENT_EMAIL,
      // Phone falls back to the sender's number, then the house default (above).
      contact_phone: destinationPhone,
      line_1: ship.address || ship.line_1 || '',
      city: ship.city || '',
      state: ship.state || '',
      postal_code: ship.postalCode || ship.postal_code || '',
      country_alpha2: ship.country || 'CA',
    },
    incoterms: 'DDU',
    // Insurance is opt-in per shipment; when on, Easyship covers the parcel's
    // declared value (summed from the item declared values above).
    insurance: { is_insured: Boolean(order.insured) },
    // Lock the shipment to the chosen courier when one was selected; otherwise
    // Easyship picks per the account's defaults. NOTE: the 2024-09 schema
    // renamed `courier_selection` → `courier_settings`, `selected_courier_id`
    // → `courier_service_id`, and `allow_courier_fallback` → `allow_fallback`.
    // Sending the old names returns "ShipmentCreate does not define properties:
    // courier_selection".
    ...(order.courierId
      ? {
          courier_settings: {
            courier_service_id: order.courierId,
            allow_fallback: false,
            apply_shipping_rules: false,
          },
        }
      : {}),
    shipping_settings: {
      units: { weight: 'kg', dimensions: 'cm' },
      output_currency: 'CAD',
      buy_label: false,
      buy_label_synchronous: false,
    },
    parcels: buildParcels(config, items),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHIPMENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }

    if (!res.ok) {
      const details = Array.isArray(json?.error?.details)
        ? ` — ${json.error.details.join('; ')}`
        : '';
      const msg =
        (json?.error?.message || json?.message || text.slice(0, 300)) + details;
      console.error('Easyship shipment create error:', res.status, msg);
      return { shipment: null, error: msg, httpStatus: res.status };
    }

    const shipment = json?.shipment || json;
    const shipmentId =
      shipment?.easyship_shipment_id || shipment?.shipment_id || shipment?.id;
    if (!shipmentId) {
      return {
        shipment: null,
        error: 'Easyship response had no shipment id',
        httpStatus: res.status,
      };
    }

    return {
      shipment: {
        shipmentId,
        trackingNumber: shipment?.tracking_number || undefined,
        trackingUrl:
          shipment?.tracking_page_url || shipment?.tracking_url || undefined,
        courier:
          shipment?.courier_service?.name ||
          shipment?.courier_service_name ||
          shipment?.courier_name ||
          undefined,
      },
    };
  } catch (e: any) {
    const error = e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
    console.error('Easyship shipment create failed:', error);
    return { shipment: null, error };
  } finally {
    clearTimeout(timeout);
  }
}

export interface LabelInfo {
  labelState?: string;
  labelUrl?: string;
  trackingNumber?: string;
}

/** Pull label state / PDF url / tracking number from a shipment payload. */
export function extractLabelInfo(shipment: any): LabelInfo {
  if (!shipment) return {};
  const docs: any[] = Array.isArray(shipment.shipping_documents)
    ? shipment.shipping_documents
    : [];
  const labelDoc =
    docs.find((d) => (d?.category || d?.type || '').toLowerCase().includes('label')) ||
    docs[0];
  const labelUrl =
    shipment.label_url ||
    shipment.label?.url ||
    labelDoc?.url ||
    labelDoc?.label_url ||
    undefined;
  const trackingNumber =
    shipment.tracking_number ||
    shipment.trackings?.[0]?.tracking_number ||
    shipment.parcels?.[0]?.tracking_number ||
    undefined;
  return {
    labelState: shipment.label_state || undefined,
    labelUrl,
    trackingNumber,
  };
}

/** Fetch a shipment and return its current label state / url / tracking. */
export async function getEasyshipShipmentLabel(shipmentId: string): Promise<LabelInfo> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey || !shipmentId) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}/${encodeURIComponent(shipmentId)}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      },
    );
    if (!res.ok) return {};
    const json = await res.json();
    return extractLabelInfo(json?.shipment || json);
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/** A shipment pulled from Easyship's list endpoint, flattened for syncing. */
export interface EasyshipShipmentRecord {
  shipmentId: string;
  /** ISO timestamp the shipment was created in Easyship. */
  createdAt: string | null;
  /** Destination contact name — matched against invoice customer names. */
  destinationName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingStatus: string | null;
  labelState: string | null;
  labelUrl: string | null;
  courier: string | null;
  /** The platform order number Easyship carries, when set. */
  platformOrderNumber: string | null;
}

/** Flatten a raw Easyship shipment payload into an {@link EasyshipShipmentRecord}. */
function extractShipmentRecord(shipment: any): EasyshipShipmentRecord | null {
  const shipmentId =
    shipment?.easyship_shipment_id || shipment?.shipment_id || shipment?.id;
  if (!shipmentId) return null;
  const dest = shipment?.destination_address || {};
  const destinationName =
    dest.contact_name ||
    [dest.first_name, dest.last_name].filter(Boolean).join(' ').trim() ||
    null;
  const label = extractLabelInfo(shipment);
  const tracking = extractTrackingInfo(shipment);
  return {
    shipmentId: String(shipmentId),
    createdAt: shipment?.created_at || shipment?.created_at_utc || null,
    destinationName: destinationName || null,
    trackingNumber: tracking.trackingNumber || label.trackingNumber || null,
    trackingUrl: tracking.trackingUrl || null,
    trackingStatus: tracking.trackingStatus || null,
    labelState: label.labelState || null,
    labelUrl: label.labelUrl || null,
    courier: tracking.carrier || null,
    platformOrderNumber:
      shipment?.platform_order_number || shipment?.order_number || null,
  };
}

// Listing shipments can page through more records than a single rate quote, so
// give it a longer ceiling than the standard request timeout.
const LIST_TIMEOUT_MS = 15000;

/**
 * List Easyship shipments created on or after `sinceDate` (a YYYY-MM-DD day,
 * interpreted as the start of that day in UTC). Pages newest-first through the
 * list endpoint and stops once it crosses the cutoff, so a "today" sync only
 * touches the first page or two. Returns the flattened records plus an error
 * string when the fetch failed outright (empty records + error).
 */
export async function listEasyshipShipments(
  sinceDate: string,
): Promise<{ records: EasyshipShipmentRecord[]; error: string | null }> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey) {
    return { records: [], error: 'Easyship is not enabled/configured in Settings' };
  }

  const sinceMs = Date.parse(`${sinceDate}T00:00:00Z`);
  const since = Number.isFinite(sinceMs) ? sinceMs : 0;

  const PER_PAGE = 100;
  const MAX_PAGES = 20; // hard ceiling: up to 2000 shipments per sync
  const records: EasyshipShipmentRecord[] = [];
  let firstError: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
    let json: any = null;
    try {
      const res = await fetch(
        `${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}?page=${page}&per_page=${PER_PAGE}`,
        {
          headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        firstError = `Easyship returned HTTP ${res.status}`;
        console.error('Easyship list shipments error:', res.status, text.slice(0, 300));
        break;
      }
      json = await res.json();
    } catch (e: any) {
      firstError = e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
      console.error('Easyship list shipments failed:', firstError);
      break;
    } finally {
      clearTimeout(timeout);
    }

    const pageShipments: any[] = Array.isArray(json?.shipments)
      ? json.shipments
      : Array.isArray(json?.data)
        ? json.data
        : [];
    if (pageShipments.length === 0) break;

    let inRangeThisPage = 0;
    for (const s of pageShipments) {
      const rec = extractShipmentRecord(s);
      if (!rec) continue;
      const created = rec.createdAt ? Date.parse(rec.createdAt) : NaN;
      // Keep shipments created on/after the cutoff. When created_at can't be
      // read, keep it — better to over-include for the admin to review.
      if (!Number.isFinite(created) || created >= since) {
        records.push(rec);
        inRangeThisPage++;
      }
    }

    // Easyship returns newest-first, so once a whole page falls before the
    // cutoff every later page is older too — stop. Guarded on having already
    // collected something so an all-undefined first page doesn't end early.
    if (inRangeThisPage === 0 && records.length > 0) break;
    if (pageShipments.length < PER_PAGE) break;
  }

  // De-dupe by shipment id in case pages overlapped as new shipments arrived.
  const seen = new Set<string>();
  const deduped = records.filter((r) => {
    if (seen.has(r.shipmentId)) return false;
    seen.add(r.shipmentId);
    return true;
  });

  return { records: deduped, error: deduped.length === 0 ? firstError : null };
}

export interface TrackingInfo {
  trackingNumber?: string;
  /** Easyship's tracking state, e.g. "in_transit", "delivered". */
  trackingStatus?: string;
  /** Customer-facing tracking page URL. */
  trackingUrl?: string;
  /** Courier/carrier name, e.g. "UPS", "FedEx". */
  carrier?: string;
  labelState?: string;
}

/** Pull the current tracking snapshot from a shipment payload. */
export function extractTrackingInfo(shipment: any): TrackingInfo {
  if (!shipment) return {};
  const tracking =
    (Array.isArray(shipment.trackings) ? shipment.trackings[0] : undefined) ?? {};
  const courierService = shipment.courier_service || shipment.selected_courier_service || {};
  return {
    trackingNumber:
      shipment.tracking_number ||
      tracking.tracking_number ||
      shipment.parcels?.[0]?.tracking_number ||
      undefined,
    trackingStatus:
      shipment.tracking_state ||
      shipment.tracking_status ||
      tracking.tracking_state ||
      tracking.status ||
      undefined,
    trackingUrl:
      shipment.tracking_page_url ||
      shipment.tracking_url ||
      tracking.tracking_page_url ||
      undefined,
    carrier:
      courierService.name ||
      shipment.courier_service_name ||
      shipment.courier_name ||
      undefined,
    labelState: shipment.label_state || undefined,
  };
}

/**
 * Fetch an Easyship shipment and return its current tracking snapshot
 * (number, state, page URL, carrier). Returns {} when Easyship is disabled,
 * the id is missing, or the request fails — callers treat that as "no live
 * update available" and fall back to stored values.
 */
export async function getEasyshipShipmentTracking(shipmentId: string): Promise<TrackingInfo> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey || !shipmentId) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}/${encodeURIComponent(shipmentId)}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      },
    );
    if (!res.ok) return {};
    const json = await res.json();
    return extractTrackingInfo(json?.shipment || json);
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download an Easyship document URL (e.g. the label PDF) using the API key.
 * The doc endpoint may return the PDF directly or JSON pointing at a signed
 * URL — both are handled.
 */
export async function fetchEasyshipDocument(
  url: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const config = await getShippingConfig();
  if (!config.apiKey || !url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/pdf, application/json' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json().catch(() => null);
      const inner = json?.url || json?.label_url || json?.download_url;
      if (!inner) return null;
      const res2 = await fetch(inner, { headers: { Accept: 'application/pdf' } });
      if (!res2.ok) return null;
      return {
        buffer: await res2.arrayBuffer(),
        contentType: res2.headers.get('content-type') || 'application/pdf',
      };
    }
    return { buffer: await res.arrayBuffer(), contentType: contentType || 'application/pdf' };
  } catch {
    return null;
  }
}

export interface BuyLabelResult extends LabelInfo {
  ok: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Buy/confirm the label for an existing Easyship shipment. Charges the account
 * balance; the PDF is generated asynchronously (label_state pending →
 * generated), with the final URL also delivered via the
 * shipment.label.created webhook.
 */
export async function buyEasyshipLabel(shipmentId: string): Promise<BuyLabelResult> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey) {
    return { ok: false, error: 'Easyship not enabled/configured' };
  }
  if (!shipmentId) return { ok: false, error: 'Missing shipment id' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHIPMENT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}/${encodeURIComponent(shipmentId)}/label`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      },
    );
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }

    if (!res.ok) {
      const details = Array.isArray(json?.error?.details)
        ? ` — ${json.error.details.join('; ')}`
        : '';
      const msg = (json?.error?.message || json?.message || text.slice(0, 300)) + details;
      console.error('Easyship buy-label error:', res.status, msg);
      return { ok: false, error: msg, httpStatus: res.status };
    }

    const shipment = json?.shipment || json;
    return { ok: true, ...extractLabelInfo(shipment) };
  } catch (e: any) {
    const error = e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
    console.error('Easyship buy-label failed:', error);
    return { ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

export type HandoverMethod = 'pickup' | 'dropoff';

export interface HandoverResult {
  ok: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Set the courier handover for a shipment: either the courier PICKS UP the
 * parcel from our origin, or WE DROP OFF at the courier (direct handover).
 *
 * This uses Easyship's Carrier Pickup API, which is separate from shipment
 * creation and runs once a label exists. The exact request schema is behind
 * Easyship's authenticated docs, so the body shape here is provisional —
 * verify against a live key and adjust if Easyship rejects it. Callers should
 * treat this as best-effort: a failure must never undo an already-bought label.
 */
export async function setEasyshipHandover(
  shipmentId: string,
  method: HandoverMethod,
): Promise<HandoverResult> {
  const config = await getShippingConfig();
  if (!config.enabled || !config.apiKey) {
    return { ok: false, error: 'Easyship not enabled/configured' };
  }
  if (!shipmentId) return { ok: false, error: 'Missing shipment id' };

  // Drop-off → direct handover; courier pickup → schedule a pickup. Both accept
  // the Easyship shipment id(s); pickup date/time is left to Easyship's default
  // (the admin only chooses who handles the handover, not a slot).
  const path =
    method === 'pickup' ? '/pickup/v1/pickups' : '/pickup/v1/direct_handover';
  const body = { easyship_shipment_ids: [shipmentId] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHIPMENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${EASYSHIP_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const details = Array.isArray(json?.error?.details)
        ? ` — ${json.error.details.join('; ')}`
        : '';
      const msg = (json?.error?.message || json?.message || text.slice(0, 300)) + details;
      console.error('Easyship handover error:', res.status, msg);
      return { ok: false, error: msg, httpStatus: res.status };
    }
    return { ok: true };
  } catch (e: any) {
    const error = e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
    console.error('Easyship handover failed:', error);
    return { ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
}
