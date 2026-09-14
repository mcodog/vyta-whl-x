'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, Trash2, Plus, Minus, ArrowLeft, ArrowRight, ShoppingBag, Lock, Beaker } from 'lucide-react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useCart, cartLineKey } from '@/contexts/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useCustomer } from '@/contexts/CustomerContext';
import FreeShippingBar from '@/components/FreeShippingBar';
import CheckoutAddons from '@/components/CheckoutAddons';
import PriceAmount from '@/components/PriceAmount';
import CartPriceNotice from '@/components/CartPriceNotice';

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalPrice, clearCart, pricesReady } = useCart();
  const { currency, rate, ready: currencyReady } = useCurrency();
  const { customer } = useCustomer();
  // Prices only render for signed-in customers; guests are routed to sign in.
  const signedIn = !!customer;
  const checkoutUrl = '/checkout';

  // Per-vial unit price in the active currency. The line's `price`/`priceUsd`
  // are the customer's own once the cart has re-priced against their account —
  // until then `ready` is false and a shimmer stands in for the figure.
  const unit = (item: { price: number; priceUsd?: number | null }) =>
    currency === 'USD' ? (item.priceUsd != null ? item.priceUsd : item.price * rate) : item.price;
  const cartTotal =
    currency === 'USD'
      ? items.reduce((s, i) => s + unit(i) * i.quantity, 0)
      : totalPrice;
  const ready = currencyReady && pricesReady;

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8"
          >
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors mb-4 sm:mb-6 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Continue Shopping</span>
            </Link>

            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink tracking-tight">
              Your Cart
            </h1>
          </motion.div>

          <CartPriceNotice className="mb-4 sm:mb-6" />

          {items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12 sm:py-16 md:py-20"
            >
              <div className="w-16 sm:w-20 h-16 sm:h-20 bg-surface rounded-2xl flex items-center justify-center mx-auto mb-5 sm:mb-6 border border-line">
                <ShoppingBag className="w-8 sm:w-10 h-8 sm:h-10 text-ink-muted" />
              </div>
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2 sm:mb-3">Your cart is empty</h2>
              <p className="text-ink-muted mb-6 sm:mb-8 text-sm">
                Looks like you haven&apos;t added any products yet.
              </p>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold px-5 sm:px-6 py-3 rounded-xl transition-all text-sm"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Browse Products</span>
              </Link>
            </motion.div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
              {/* Cart Items */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="lg:col-span-2"
              >
                <div className="bg-white rounded-xl border border-line overflow-hidden">
                  <div className="p-3 sm:p-4 md:p-5 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm sm:text-base md:text-lg font-semibold text-ink">
                        Cart Items ({items.length})
                      </h2>
                      <button
                        onClick={clearCart}
                        className="text-red-500 hover:text-red-600 text-xs sm:text-sm font-medium transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-line">
                    {items.map((item, index) => {
                      const key = cartLineKey(item.id, item.packSize);
                      const packLabel =
                        item.packSize === 1 ? 'Single vial' : `Pack of ${item.packSize}`;
                      // Show the packaging shot for pack-of-10 lines when available.
                      const displayImage =
                        item.packSize !== 1 && item.box_image_url
                          ? item.box_image_url
                          : item.image_url;
                      return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="p-3 sm:p-4 md:p-5"
                      >
                        <div className="flex items-start gap-3 sm:gap-4">
                          {/* Product Image */}
                          <div className="bg-surface w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 border border-line">
                            {displayImage ? (
                              <img
                                src={displayImage}
                                alt={item.name}
                                className="w-full h-full object-contain rounded-lg sm:rounded-xl p-1"
                              />
                            ) : (
                              <Beaker className="w-6 sm:w-8 h-6 sm:h-8 text-line" />
                            )}
                          </div>

                          {/* Product Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="font-semibold text-ink text-xs sm:text-sm md:text-base line-clamp-1">{item.name}</h3>
                                <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5">{item.strength}</p>
                                <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full bg-surface border border-line text-[9px] sm:text-[10px] font-medium text-ink-muted">
                                  {packLabel}
                                </span>
                              </div>
                              {/* Remove Button - Mobile */}
                              <button
                                onClick={() => removeItem(key)}
                                aria-label={`Remove ${item.name} from cart`}
                                className="text-ink-muted hover:text-red-500 transition-colors p-1 md:hidden"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Mobile: Price and Controls inline */}
                            <div className="flex items-center justify-between mt-2 sm:mt-3">
                              {signedIn ? (
                                <p className="text-ink-muted text-[11px] sm:text-xs tabular-nums">
                                  <PriceAmount value={unit(item)} ready={ready} w="w-12" /> <span className="text-ink-muted">each</span>
                                </p>
                              ) : (
                                <span />
                              )}

                              {/* Quantity Controls */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateQuantity(key, item.quantity - item.packSize)}
                                  aria-label={`Decrease quantity of ${item.name}`}
                                  className="w-7 sm:w-8 h-7 sm:h-8 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors"
                                >
                                  <Minus className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-ink" />
                                </button>
                                <span className="w-8 sm:w-10 text-center font-semibold text-xs sm:text-sm tabular-nums">{item.quantity}</span>
                                <button
                                  onClick={() => updateQuantity(key, item.quantity + item.packSize)}
                                  aria-label={`Increase quantity of ${item.name}`}
                                  className="w-7 sm:w-8 h-7 sm:h-8 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors"
                                >
                                  <Plus className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-ink" />
                                </button>
                              </div>
                            </div>

                            {/* Mobile: line total (desktop shows it in the right column) */}
                            {signedIn && (
                              <div className="flex justify-end mt-2 md:hidden">
                                <span className="text-xs text-ink-muted">
                                  Line total:{' '}
                                  <span className="font-bold text-ink tabular-nums"><PriceAmount value={unit(item) * item.quantity} ready={ready} w="w-14" /></span>
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Item Total & Remove - Desktop */}
                          <div className="hidden md:flex items-center gap-4">
                            {signedIn && (
                              <div className="text-right min-w-[80px]">
                                <p className="font-bold text-ink tabular-nums">
                                  <PriceAmount value={unit(item) * item.quantity} ready={ready} w="w-16" />
                                </p>
                              </div>
                            )}
                            <button
                              onClick={() => removeItem(key)}
                              aria-label={`Remove ${item.name} from cart`}
                              className="text-ink-muted hover:text-red-500 transition-colors p-2"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Upsell: bacteriostatic water & other add-ons (prices — signed-in only) */}
                {signedIn && (
                  <div className="mt-4 sm:mt-6">
                    <CheckoutAddons />
                  </div>
                )}

              </motion.div>

              {/* Order Summary */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="lg:col-span-1"
              >
                <div className="bg-white rounded-xl border border-line p-4 sm:p-5 lg:sticky lg:top-36">
                  <h2 className="text-sm sm:text-base md:text-lg font-semibold text-ink mb-4 sm:mb-5">Order Summary</h2>

                  {signedIn ? (
                    <>
                      {/* totalPrice is the CAD-base subtotal checkout compares against. */}
                      <div className="mb-4 sm:mb-5">
                        <FreeShippingBar subtotalCad={totalPrice} />
                      </div>

                      <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-5">
                        <div className="flex justify-between text-ink-muted text-xs sm:text-sm">
                          <span>Subtotal</span>
                          <span className="font-medium text-ink tabular-nums"><PriceAmount value={cartTotal} ready={ready} /></span>
                        </div>
                        <div className="flex justify-between text-ink-muted text-xs sm:text-sm">
                          <span>Shipping</span>
                          <span className="font-medium text-ink-muted">Calculated at checkout</span>
                        </div>
                        <div className="border-t border-line pt-2 sm:pt-3">
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm sm:text-base font-semibold text-ink">Total</span>
                            <span className="text-lg sm:text-xl font-bold text-ink tabular-nums">
                              <PriceAmount value={cartTotal} ready={ready} w="w-20" />
                              <span className="text-ink-muted text-xs font-normal ml-1">{currency} + shipping</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-ink-muted text-xs sm:text-sm mb-4 sm:mb-5">
                      Sign in to see pricing and check out.
                    </p>
                  )}

                  {signedIn ? (
                    <Link
                      href={checkoutUrl}
                      className="group w-full bg-ink hover:bg-ink/90 text-white font-semibold py-3 sm:py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <span>Proceed to Checkout</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ) : (
                    <Link
                      href="/login?redirect=/checkout"
                      className="group w-full bg-ink hover:bg-ink/90 text-white font-semibold py-3 sm:py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <span>Sign in to checkout</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  )}

                  <p className="text-[10px] sm:text-xs text-ink-muted text-center mt-3 sm:mt-4 flex items-center justify-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Secure checkout
                  </p>

                  {/* Trust Badges */}
                  <div className="flex justify-center gap-4 sm:gap-6 mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-line">
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">🔒</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">Secure</span>
                    </div>
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">💳</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">Payment</span>
                    </div>
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">🇨🇦</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">Canada</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      <Footer />
    </main>
  );
}
