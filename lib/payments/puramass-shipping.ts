/**
 * Shipping for the PuraMass hosted checkout (the signed-in customer flow).
 *
 * SERVER-ONLY. The customer picks a courier on our side before they are
 * redirected, so we quote the rates, add the configured processing fee, and
 * send the result to PuraMass as the order's `shipping_total_cents`. The same
 * address and courier later drive the Easyship shipment created when the order
 * is paid.
 *
 * Two rules shape everything here:
 *
 *  1. **A rate is never taken from the browser.** The checkout asks for rates,
 *     the customer picks one by its Easyship `courier_service` id, and the
 *     hand-off re-quotes that id server-side. What is charged is what Easyship
 *     just said, plus the fee this module applies — never a number the client
 *     sent back.
 *
 *  2. **One fee, not two.** Easyship rates normally carry the global handling
 *     markup (`shipping_handling_fee_*`). At this checkout that markup is
 *     suppressed and the hosted-checkout processing fee
 *     (`puramass_shipping_fee_*`) is applied instead, so the two can never
 *     stack into a charge nobody configured.
 */

import {
  getEasyshipRates,
  PURAMASS_CHECKOUT_COURIERS,
  type ShippingDestination,
  type ShippingRate,
  type ShippingRateItem,
} from '@/lib/shipping/easyship';
import { usdFromCad } from '@/lib/pricing';
import type { PuramassCurrency } from '@/lib/payments/puramass';

type Db = { from: (table: string) => any };

/** How the customer is getting their order. */
export type PuramassFulfillmentType = 'shipment' | 'pickup';

/**
 * The fulfillment a checkout request asked for.
 *
 * Anything but an explicit 'pickup' is a shipment: the shipping path is the one
 * with an address and a charge, so a malformed or missing value must never fall
 * into pickup (which would send `shipping_total_cents: 0` and charge the
 * customer nothing for a parcel we then have to send).
 */
export function parseFulfillmentType(value: unknown): PuramassFulfillmentType {
  return value === 'pickup' ? 'pickup' : 'shipment';
}

export interface PuramassShippingSettings {
  /** The feature master toggle (`puramass_customer_checkout_enabled`). */
  enabled: boolean;
  /** How the processing fee is calculated. */
  feeType: 'flat' | 'percent';
  /** CAD dollars when the type is flat, percentage points when percent. */
  feeValue: number;
}

const DEFAULTS: PuramassShippingSettings = {
  enabled: false,
  feeType: 'flat',
  feeValue: 0,
};

/**
 * Read the hosted-checkout shipping settings. Every failure — a missing column
 * before the migration has run, no settings row at all — reads as "feature
 * off", so the hosted checkout keeps behaving exactly as it did before rather
 * than half-enabling itself.
 */
export async function getPuramassShippingSettings(
  db: Db,
): Promise<PuramassShippingSettings> {
  try {
    const { data, error } = await db
      .from('site_settings')
      .select(
        'puramass_customer_checkout_enabled, puramass_shipping_fee_type, puramass_shipping_fee_value',
      )
      .maybeSingle();
    if (error || !data) return DEFAULTS;
    const value = Number(data.puramass_shipping_fee_value);
    return {
      enabled: Boolean(data.puramass_customer_checkout_enabled),
      feeType: data.puramass_shipping_fee_type === 'percent' ? 'percent' : 'flat',
      feeValue: Number.isFinite(value) && value > 0 ? value : 0,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Add the configured processing fee on top of a courier rate. A flat fee is a
 * CAD amount, so it is converted alongside the rate when the customer bills in
 * USD; a percentage needs no conversion.
 */
export function applyProcessingFee(
  cost: number,
  settings: PuramassShippingSettings,
  opts?: { currency?: PuramassCurrency; rate?: number },
): number {
  const base = Number(cost) || 0;
  const { feeType, feeValue } = settings;
  if (!Number.isFinite(feeValue) || feeValue <= 0) return round2(base);
  if (feeType === 'percent') return round2(base * (1 + feeValue / 100));
  const flat =
    opts?.currency === 'usd' ? usdFromCad(feeValue, opts.rate ?? 1) : feeValue;
  return round2(base + flat);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** A courier option as the checkout shows it, already in the customer's currency. */
export interface PuramassShippingOption {
  /** Easyship `courier_service` id — what the client sends back on hand-off. */
  courierId: string;
  courier: string;
  /** Total the customer pays for shipping, processing fee included. */
  cost: number;
  /** The currency `cost` is expressed in (the customer's billing currency). */
  currency: PuramassCurrency;
  minDays?: number;
  maxDays?: number;
}

/**
 * Quote the courier options for this destination and cart, in the customer's
 * currency and with the processing fee folded in.
 *
 * Scoped to {@link PURAMASS_CHECKOUT_COURIERS} (UPS, FedEx, Canada Post) — a
 * courier outside that list is never offered even if the Easyship account
 * returns a rate for it. Returns an empty list when Easyship is disabled,
 * unconfigured, or has nothing for the address; the checkout then tells the
 * customer rather than inventing a figure.
 *
 * Easyship quotes in CAD (the store's base currency), so a USD customer's
 * options are converted at the same rate their prices were.
 */
export async function getPuramassShippingOptions(
  db: Db,
  destination: ShippingDestination,
  items: ShippingRateItem[],
  money: { currency: PuramassCurrency; rate: number },
): Promise<PuramassShippingOption[]> {
  const settings = await getPuramassShippingSettings(db);
  const rates = await getEasyshipRates(
    destination,
    items,
    // Suppress the global handling markup — see rule 2 in the file header.
    { apply: false },
    PURAMASS_CHECKOUT_COURIERS,
  );

  return rates
    .filter((r) => r.courierId)
    .map((r) => ({
      courierId: r.courierId,
      courier: r.courier,
      cost: applyProcessingFee(toCustomerCurrency(r, money), settings, money),
      currency: money.currency,
      minDays: r.minDays,
      maxDays: r.maxDays,
    }))
    .sort((a, b) => a.cost - b.cost);
}

/** A rate's cost in the customer's billing currency. */
function toCustomerCurrency(
  rate: ShippingRate,
  money: { currency: PuramassCurrency; rate: number },
): number {
  // Easyship is asked for CAD; honour an unexpected currency rather than
  // converting an amount that is already in the target currency.
  const quotedUsd = String(rate.currency || 'CAD').toUpperCase() === 'USD';
  if (money.currency === 'usd') return quotedUsd ? rate.cost : usdFromCad(rate.cost, money.rate);
  return quotedUsd ? round2(rate.cost / (money.rate || 1)) : rate.cost;
}

/**
 * Re-quote the courier the customer chose, at hand-off time, and return what to
 * charge for shipping in whole cents.
 *
 * `null` means no rate could be resolved at all — the caller must refuse the
 * hand-off rather than send `0`, which the partner API reads as free shipping.
 * When the chosen courier is no longer on offer (the rate lapsed, the account
 * changed), the cheapest remaining option is charged instead, and the courier
 * actually charged is returned so the ledger and the shipment agree with it.
 */
export async function resolvePuramassShipping(
  db: Db,
  destination: ShippingDestination,
  items: ShippingRateItem[],
  money: { currency: PuramassCurrency; rate: number },
  courierId: string,
): Promise<{ cents: number; option: PuramassShippingOption } | null> {
  const options = await getPuramassShippingOptions(db, destination, items, money);
  if (!options.length) return null;
  const option = options.find((o) => o.courierId === courierId) ?? options[0];
  return { cents: Math.round(option.cost * 100), option };
}
