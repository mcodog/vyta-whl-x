'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useCustomer } from '@/contexts/CustomerContext';
import {
  DEFAULT_USD_RATE,
  formatMoney,
  inCurrency,
  toPriceCurrency,
  type PriceCurrency,
} from '@/lib/pricing';

interface CurrencyContextType {
  /** The active display/billing currency, from the signed-in customer's tag. */
  currency: PriceCurrency;
  /**
   * The multiplier to apply to a configured CAD figure to reach the active
   * currency — **already folded**, so a surface can always just multiply.
   *
   * It is the Site Settings CAD→USD rate when this customer's prices convert,
   * and **1** when they don't (`customers.convert_storefront_prices = false`,
   * the default): their configured figure is shown and billed as-is, just
   * denominated in `currency`. Everything that does `cad * rate` or
   * `usdFromCad(cad, rate)` therefore needs no further branching.
   */
  rate: number;
  /**
   * Whether this customer's prices convert. Surfaces only need this for the one
   * thing `rate` can't express: a product's explicit `price_usd` is itself a
   * converted figure, so it must be ignored when `convert` is false. Pass it to
   * `productUsdPrice` / `inCurrency`.
   */
  convert: boolean;
  /** The store's real CAD→USD rate, whether or not this customer converts. */
  storeRate: number;
  /**
   * True once both the customer (for the tag) and the exchange rate have
   * resolved. Price UIs gate on this so a CAD amount never flashes before the
   * USD one is known.
   */
  ready: boolean;
  /**
   * Express a CAD base amount in the active currency. `usdOverride` supplies an
   * explicit USD amount (e.g. a product's `price_usd`) that wins over the rate.
   */
  toDisplay: (cad: number, usdOverride?: number | null) => number;
  /** Format a CAD base amount as `$X.XX CAD` / `$X.XX USD` in the active currency. */
  fmt: (cad: number, usdOverride?: number | null) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { customer, isLoading: customerLoading } = useCustomer();
  const [rate, setRate] = useState<number>(DEFAULT_USD_RATE);
  const [rateLoaded, setRateLoaded] = useState(false);

  // Fetch the stored CAD→USD rate once. Best-effort — on failure we keep the
  // default and still mark it loaded so USD customers aren't blocked forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/currency');
        if (res.ok) {
          const { usd_exchange_rate } = await res.json();
          const n = Number(usd_exchange_rate);
          if (!cancelled && Number.isFinite(n) && n > 0) setRate(n);
        }
      } catch {
        /* keep default rate */
      } finally {
        if (!cancelled) setRateLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = toPriceCurrency(customer?.price_currency);
  // Whether this customer's configured prices are converted into their billing
  // currency, or shown as-is and merely denominated in it. Default (and the
  // value for a customer whose column predates the migration) is "as-is".
  const convert = customer?.convert_storefront_prices === true;
  // The effective multiplier: 1 when not converting, so every `cad * rate` and
  // `usdFromCad(cad, rate)` on the storefront leaves the figure untouched
  // without needing to know about the toggle.
  const effectiveRate = currency === 'USD' && !convert ? 1 : rate;
  const ready = rateLoaded && !customerLoading;

  const toDisplay = (cad: number, usdOverride?: number | null) =>
    inCurrency(Number(cad) || 0, currency, effectiveRate, usdOverride, convert);
  const fmt = (cad: number, usdOverride?: number | null) =>
    formatMoney(toDisplay(cad, usdOverride), currency);

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        rate: effectiveRate,
        convert,
        storeRate: rate,
        ready,
        toDisplay,
        fmt,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
