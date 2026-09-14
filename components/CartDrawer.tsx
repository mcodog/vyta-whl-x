'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, ShoppingCart, Trash2, Plus, Minus, ArrowRight, Lock, Beaker } from 'lucide-react';
import Link from 'next/link';
import { useCart, cartLineKey } from '@/contexts/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useCustomer } from '@/contexts/CustomerContext';
import FreeShippingBar from '@/components/FreeShippingBar';
import PriceAmount from '@/components/PriceAmount';
import CartPriceNotice from '@/components/CartPriceNotice';

/**
 * Slide-out cart drawer. Opens whenever `isOpen` on the cart context flips true
 * (from add-to-cart, "Buy Now", or the nav cart button), keeping shoppers in
 * the catalog and one click from checkout. The full `/cart` page stays as a
 * fallback for anyone who wants the roomier view.
 */
export default function CartDrawer() {
  const { items, removeItem, updateQuantity, totalPrice, clearCart, isOpen, setIsOpen, pricesReady } = useCart();
  const { currency, rate, ready: currencyReady } = useCurrency();
  const { customer } = useCustomer();
  // Prices only render for signed-in customers; guests are routed to sign in.
  const signedIn = !!customer;

  const close = () => setIsOpen(false);

  // Per-vial unit price in the active currency. The line's `price`/`priceUsd`
  // are the customer's own once the cart has re-priced — until then `ready` is
  // false and no figure is printed.
  const unit = (item: { price: number; priceUsd?: number | null }) =>
    currency === 'USD' ? (item.priceUsd != null ? item.priceUsd : item.price * rate) : item.price;
  const cartTotal =
    currency === 'USD' ? items.reduce((s, i) => s + unit(i) * i.quantity, 0) : totalPrice;
  const ready = currencyReady && pricesReady;

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="cart-drawer"
          className="fixed inset-0 z-[110]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          aria-hidden={!isOpen}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={close}
          />

          {/* Panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-ink" />
                <h2 className="text-base font-semibold text-ink">
                  Your Cart{items.length > 0 && <span className="text-ink-muted font-normal"> ({items.length})</span>}
                </h2>
              </div>
              <button
                onClick={close}
                className="text-ink-muted hover:text-ink transition-colors p-1.5 rounded-full hover:bg-surface"
                aria-label="Close cart"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <div className="w-16 h-16 bg-surface rounded-2xl flex items-center justify-center mb-5 border border-line">
                  <ShoppingBag className="w-8 h-8 text-ink-muted" />
                </div>
                <h3 className="text-lg font-bold text-ink mb-2">Your cart is empty</h3>
                <p className="text-ink-muted text-sm mb-6">Add products to get started.</p>
                <Link
                  href="/products"
                  onClick={close}
                  className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold px-5 py-3 rounded-xl transition-all text-sm"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Browse Products
                </Link>
              </div>
            ) : (
              <>
                <CartPriceNotice className="mx-4 mt-3" />

                {/* Items */}
                <div className="flex-1 overflow-y-auto divide-y divide-line">
                  {items.map((item) => {
                    const key = cartLineKey(item.id, item.packSize);
                    const packLabel = item.packSize === 1 ? 'Single vial' : `Pack of ${item.packSize}`;
                    const displayImage =
                      item.packSize !== 1 && item.box_image_url ? item.box_image_url : item.image_url;
                    return (
                      <div key={key} className="p-4 flex items-start gap-3">
                        <div className="bg-surface w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 border border-line">
                          {displayImage ? (
                            <img src={displayImage} alt={item.name} className="w-full h-full object-contain rounded-xl p-1" />
                          ) : (
                            <Beaker className="w-6 h-6 text-line" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-semibold text-ink text-sm line-clamp-1">{item.name}</h3>
                              <p className="text-[11px] text-ink-muted mt-0.5">{item.strength}</p>
                              <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full bg-surface border border-line text-[10px] font-medium text-ink-muted">
                                {packLabel}
                              </span>
                            </div>
                            <button
                              onClick={() => removeItem(key)}
                              className="text-ink-muted hover:text-red-500 transition-colors p-1"
                              aria-label={`Remove ${item.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            {signedIn ? (
                              <p className="text-ink font-bold text-sm tabular-nums">
                                <PriceAmount value={unit(item) * item.quantity} ready={ready} w="w-14" />
                              </p>
                            ) : (
                              <span />
                            )}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateQuantity(key, item.quantity - item.packSize)}
                                className="w-7 h-7 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors"
                                aria-label="Decrease quantity"
                              >
                                <Minus className="w-3.5 h-3.5 text-ink" />
                              </button>
                              <span className="w-9 text-center font-semibold text-sm tabular-nums">{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(key, item.quantity + item.packSize)}
                                className="w-7 h-7 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors"
                                aria-label="Increase quantity"
                              >
                                <Plus className="w-3.5 h-3.5 text-ink" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="p-4">
                    <button
                      onClick={clearCart}
                      className="text-red-500 hover:text-red-600 text-xs font-medium transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-line p-4 space-y-3 bg-white">
                  {signedIn ? (
                    <>
                      {/* totalPrice is the CAD-base subtotal checkout compares against. */}
                      <FreeShippingBar subtotalCad={totalPrice} />

                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-ink-muted">Subtotal</span>
                        <span className="text-lg font-bold text-ink tabular-nums">
                          <PriceAmount value={cartTotal} ready={ready} w="w-20" />
                          <span className="text-ink-muted text-xs font-normal ml-1">{currency}</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted -mt-1">Shipping calculated at checkout.</p>
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted text-center py-1">
                      Sign in to see pricing and check out.
                    </p>
                  )}

                  {signedIn ? (
                    <Link
                      href="/checkout"
                      onClick={close}
                      className="group w-full bg-ink hover:bg-ink/90 text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <span>Proceed to Checkout</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ) : (
                    <Link
                      href="/login?redirect=/checkout"
                      onClick={close}
                      className="group w-full bg-ink hover:bg-ink/90 text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <span>Sign in to checkout</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  )}
                  <Link
                    href="/cart"
                    onClick={close}
                    className="block text-center text-sm text-ink-muted hover:text-ink transition-colors"
                  >
                    View full cart
                  </Link>
                  <p className="text-[11px] text-ink-muted text-center flex items-center justify-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Secure checkout
                  </p>
                </div>
              </>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
