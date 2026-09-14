'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { X, ShoppingCart, Zap, Minus, Plus, Beaker, Check } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useCustomer } from '@/contexts/CustomerContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { productUsdPrice, usdFromCad } from '@/lib/pricing';

export interface AddToCartProduct {
  id: string;
  name: string;
  price: number; // catalog CAD price — the price of a pack of 10 vials
  /** Explicit single-vial price; falls back to price/10 when not set. */
  vial_price?: number | null;
  /** Optional explicit USD box price; else derived from price × rate. */
  price_usd?: number | null;
  /** True when `price` is a per-customer CAD override (USD then follows the rate). */
  has_override?: boolean;
  strength: string;
  image_url?: string;
  box_image_url?: string; // packaging shot, shown for the pack of 10
}

// The catalog price is for a 10-vial pack.
const PACK_OF_TEN = 10;

interface PackOption {
  size: 1 | 10;
  label: string;
  sublabel: string;
}

const PACK_OPTIONS: PackOption[] = [
  { size: 1, label: 'Single vial', sublabel: '1 vial' },
  { size: 10, label: 'Pack of 10', sublabel: '10 vials' },
];

export default function AddToCartModal({
  product,
  onClose,
  allowedPackSizes = [1, 10],
}: {
  product: AddToCartProduct | null;
  onClose: () => void;
  /**
   * Which pack sizes to offer. Defaults to both. Callers (e.g. the PuraMass
   * checkout upsell) narrow this to only the forms that can actually be
   * fulfilled — e.g. `[1]` to offer the single vial only when the product has no
   * valid pack-of-10 mapping.
   */
  allowedPackSizes?: (1 | 10)[];
}) {
  const { addItem, setIsOpen: setCartOpen } = useCart();
  const { customer } = useCustomer();
  // Prices are only shown to signed-in customers; guests add to cart without
  // seeing pricing here (prices appear in the cart drawer & checkout).
  const showPrices = !!customer;
  const { currency, rate, convert } = useCurrency();
  const router = useRouter();
  const options = PACK_OPTIONS.filter((o) => allowedPackSizes.includes(o.size));
  const defaultSize: 1 | 10 = allowedPackSizes.includes(10)
    ? 10
    : allowedPackSizes[0] ?? 1;
  const [packSize, setPackSize] = useState<1 | 10>(defaultSize);
  const [packs, setPacks] = useState(1);

  // Reset the form whenever a new product is opened (to the default allowed size).
  useEffect(() => {
    if (product) {
      setPackSize(defaultSize);
      setPacks(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  if (!product) return null;

  // A single vial uses the explicit vial_price (falling back to price/10 if it
  // isn't set); within a pack of 10 each vial is the box price split ten ways
  // so the pack still totals the box price. The cart stores a per-vial price.
  const singleVialPrice =
    product.vial_price != null && product.vial_price > 0
      ? product.vial_price
      : product.price / PACK_OF_TEN;
  const boxPerVialPrice = product.price / PACK_OF_TEN;
  const perVialPrice = packSize === 1 ? singleVialPrice : boxPerVialPrice;
  const vials = packSize * packs;
  const lineTotal = perVialPrice * vials;

  // USD per-vial equivalents, captured into the cart so a USD-tagged customer
  // is billed in USD (honouring a product's price_usd override for the box).
  const boxPerVialUsd = productUsdPrice(product, rate, convert) / PACK_OF_TEN;
  const singleVialUsd =
    product.vial_price != null && product.vial_price > 0
      ? usdFromCad(product.vial_price, rate)
      : boxPerVialUsd;
  const perVialUsd = packSize === 1 ? singleVialUsd : boxPerVialUsd;

  // Pick the amount to show in the active display currency.
  const disp = (cad: number, usd: number) => (currency === 'USD' ? usd : cad);
  const money = (cad: number, usd: number) => `$${disp(cad, usd).toFixed(2)}`;

  // Show the packaging shot for the pack of 10 (when one exists), and fall
  // back to the single-vial image for single vials or when no box exists.
  // Vial artwork is square; the pack-of-10 box is a 16:9 landscape shot, so
  // the image area changes aspect ratio between the two (animated below).
  const isBox = packSize === 10 && !!product.box_image_url;
  const displayImage = isBox ? product.box_image_url : product.image_url;

  const addToCart = () => {
    addItem(
      {
        id: product.id,
        name: product.name,
        price: perVialPrice,
        priceUsd: perVialUsd,
        strength: product.strength,
        image_url: product.image_url,
        box_image_url: product.box_image_url,
        packSize,
        priceType: packSize === 1 ? 'vial' : 'box',
      },
      packs
    );
  };

  // Add and slide the cart drawer open — one click from checkout, no page nav.
  const handleAdd = () => {
    addToCart();
    onClose();
    setCartOpen(true);
  };

  // Skip the cart entirely and go straight to checkout.
  const handleBuyNow = () => {
    addToCart();
    onClose();
    router.push('/checkout');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-x-0 top-0 h-[100dvh] z-[100] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.98 }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          className={`relative w-full max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-t-2xl sm:rounded-2xl border border-line shadow-xl flex flex-col sm:flex-row transition-[max-width] duration-300 ease-out ${
            isBox ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 text-ink-muted hover:text-ink transition-colors p-2 rounded-full bg-white/80 hover:bg-white border border-line/60 shadow-sm backdrop-blur-sm"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Image (left) — vials are square, the pack-of-10 box is 16:9, so
              the image area changes aspect ratio with the selection and the
              modal smoothly resizes to match. */}
          <div
            className={`relative w-full flex-shrink-0 bg-surface border-b sm:border-b-0 sm:border-r border-line flex items-center justify-center p-5 sm:p-6 transition-[width] duration-300 ease-out ${
              isBox ? 'sm:w-3/5' : 'sm:w-1/2'
            }`}
          >
            <div
              className={`relative w-full transition-[aspect-ratio] duration-300 ease-out ${
                isBox ? 'aspect-video' : 'aspect-square'
              }`}
            >
              <AnimatePresence initial={false}>
                {displayImage ? (
                  <motion.img
                    key={displayImage}
                    src={displayImage}
                    alt={product.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Beaker className="w-12 h-12 text-line" />
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Content (right) */}
          <div className="flex flex-col flex-1 min-w-0">
          {/* Header */}
          <div className="p-4 sm:p-5 pr-12 border-b border-line">
            <h3 className="font-semibold text-ink text-base sm:text-lg leading-snug line-clamp-2">
              {product.name}
            </h3>
            <div className="mt-1.5">
              <span className="inline-flex items-center rounded-full bg-vital-50 border border-vital/20 px-2 py-0.5 text-[11px] font-medium text-vital">
                {product.strength}
              </span>
            </div>
            {showPrices && (
              <p className="text-xs text-ink-muted mt-2 tabular-nums">
                <span className="font-medium text-ink">
                  {money(product.price, productUsdPrice(product, rate, convert))}
                </span>{' '}
                / pack of 10
                <span className="mx-1.5 text-line">·</span>
                <span className="font-medium text-ink">
                  {money(singleVialPrice, singleVialUsd)}
                </span>{' '}
                / vial
              </p>
            )}
          </div>

          {/* Body — extra bottom padding (plus the iOS safe-area inset) keeps the
              Add-to-cart button clear of the home indicator / browser bottom bar. */}
          <div className="p-4 sm:p-5 space-y-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-5">
            {/* Pack size — only the allowed options. Collapses to a static
                label when just one form is available. */}
            {options.length > 1 ? (
              <div>
                <label className="block text-xs font-medium text-ink mb-2">
                  Choose option
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {options.map((opt) => {
                    const active = packSize === opt.size;
                    return (
                      <button
                        key={opt.size}
                        type="button"
                        onClick={() => setPackSize(opt.size)}
                        className={`relative rounded-xl border p-3 text-left transition-all ${
                          active
                            ? 'border-ink bg-ink text-white shadow-sm'
                            : 'border-line bg-surface text-ink hover:border-ink/40 hover:bg-white'
                        }`}
                      >
                        {active && (
                          <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-white">
                            <Check className="h-3 w-3 text-ink" />
                          </span>
                        )}
                        <span className="block text-sm font-semibold">{opt.label}</span>
                        <span
                          className={`block text-[11px] ${
                            active ? 'text-white/70' : 'text-ink-muted'
                          }`}
                        >
                          {opt.sublabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-xs text-ink-muted">
                Sold as{' '}
                <span className="font-medium text-ink">
                  {options[0]?.label ?? 'Single vial'}
                </span>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="block text-xs font-medium text-ink mb-2">
                Quantity ({packSize === 1 ? 'vials' : 'packs'})
              </label>
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-surface border border-line rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPacks((p) => Math.max(1, p - 1))}
                    className="px-3.5 py-2.5 hover:bg-white transition-colors"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4 text-ink" />
                  </button>
                  <span className="px-4 py-2.5 font-semibold tabular-nums bg-white border-x border-line min-w-[3rem] text-center text-sm">
                    {packs}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPacks((p) => p + 1)}
                    className="px-3.5 py-2.5 hover:bg-white transition-colors"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4 text-ink" />
                  </button>
                </div>
                <span className="text-xs text-ink-muted">
                  = {vials} {vials === 1 ? 'vial' : 'vials'} total
                </span>
              </div>
            </div>

            {/* Total */}
            {showPrices && (
              <div className="flex items-end justify-between border-t border-line pt-4">
                <div>
                  <span className="block text-sm text-ink-muted">Subtotal</span>
                  <span className="block text-[11px] text-ink-light tabular-nums">
                    {money(perVialPrice, perVialUsd)} × {vials} {vials === 1 ? 'vial' : 'vials'}
                  </span>
                </div>
                <span className="text-xl font-bold text-ink tabular-nums">
                  {money(lineTotal, perVialUsd * vials)}
                  {currency === 'USD' && <span className="text-xs font-medium text-ink-muted ml-1">USD</span>}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleAdd}
                className="font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm bg-white hover:bg-surface text-ink border border-line hover:border-ink/30"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Add to cart</span>
              </button>
              <button
                onClick={handleBuyNow}
                className="font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm bg-ink hover:bg-ink/90 text-white shadow-sm hover:shadow-md"
              >
                <Zap className="w-4 h-4" />
                <span>Buy now</span>
              </button>
            </div>
          </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
