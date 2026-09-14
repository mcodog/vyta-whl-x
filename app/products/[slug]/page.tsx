"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  ArrowLeft,
  Check,
  Package,
  Shield,
  Truck,
  Award,
  Beaker,
  BadgeCheck,
  FlaskConical,
  FileText,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import NotifyMeButton from "@/components/NotifyMeButton";
import { supabase } from "@/lib/supabase";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { productUsdPrice, usdFromCad } from "@/lib/pricing";

interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  description_short: string | null;
  benefits: string | null;
  mechanism: string | null;
  price: number;
  vial_price: number | null;
  price_usd: number | null;
  strength: string;
  purity: string;
  form: string;
  stock_quantity: number;
  active: boolean;
  image_url: string | null;
  box_image_url: string | null;
  coa_url: string[] | null;
  has_override?: boolean;
  original_price?: number;
}

export default function ProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [packSize, setPackSize] = useState<1 | 10>(10);
  const [packs, setPacks] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem, setIsOpen: setCartOpen } = useCart();
  const router = useRouter();
  // The main add-to-cart block; the sticky bar shows once it scrolls out of view.
  const buyBoxRef = useRef<HTMLDivElement | null>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const { customer } = useCustomer();
  // Prices are only shown to signed-in customers; guests browse without pricing.
  const showPrices = !!customer;
  const { currency, rate, convert, ready: currencyReady } = useCurrency();

  useEffect(() => {
    async function fetchProduct() {
      setLoadError(false);
      try {
        // Fetch main product with customer-specific pricing
        const url = new URL("/api/products", window.location.origin);
        url.searchParams.set("slug", slug);
        if (customer?.id) {
          url.searchParams.set("customer_id", customer.id);
        }

        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const { products: data } = await response.json();

        setProduct(data);

        // Fetch related products with customer-specific pricing
        if (data?.category) {
          const relatedUrl = new URL("/api/products", window.location.origin);
          relatedUrl.searchParams.set("category", data.category);
          if (customer?.id) {
            relatedUrl.searchParams.set("customer_id", customer.id);
          }

          const relatedResponse = await fetch(relatedUrl.toString());
          const { products: relatedData } = await relatedResponse.json();

          // Filter out current product and limit to 4
          const filtered = (relatedData || [])
            .filter((p: Product) => p.id !== data.id)
            .slice(0, 4);

          setRelatedProducts(filtered);
        }
      } catch (error) {
        console.error("Error fetching product:", error);
        // Distinguish a network/server failure (offer retry) from a product
        // that genuinely doesn't exist (data === null, handled by the render).
        setLoadError(true);
      }
      setProductLoading(false);
    }

    fetchProduct();
  }, [slug, customer?.id, reloadKey]);

  const retryLoad = () => {
    setProductLoading(true);
    setReloadKey((k) => k + 1);
  };

  // Single-vial price: explicit vial_price, falling back to price/10.
  const singleVialPrice =
    product && product.vial_price != null && product.vial_price > 0
      ? product.vial_price
      : (product?.price ?? 0) / 10;
  // Per-vial price for the current selection (single vial vs pack of 10).
  const perVialPrice = packSize === 1 ? singleVialPrice : (product?.price ?? 0) / 10;

  // Hold the page skeleton until currency + rate resolve too (no CAD→USD flash).
  const loading = productLoading || !currencyReady;

  // USD per-vial equivalents (box override honoured via productUsdPrice).
  const boxPerVialUsd = product ? productUsdPrice(product, rate, convert) / 10 : 0;
  const singleVialUsd =
    product && product.vial_price != null && product.vial_price > 0
      ? usdFromCad(product.vial_price, rate)
      : boxPerVialUsd;
  const perVialUsd = packSize === 1 ? singleVialUsd : boxPerVialUsd;

  // Render a CAD-base amount in the active display currency.
  const money = (cad: number, usdOverride?: number | null) =>
    `$${(currency === 'USD'
      ? usdOverride != null
        ? usdOverride
        : usdFromCad(cad, rate)
      : cad
    ).toFixed(2)}`;
  const curCode = currency;

  const addToCart = () => {
    if (!product) return;

    addItem(
      {
        id: product.id,
        name: product.name,
        // A single vial uses the explicit vial_price (fallback price/10); a
        // pack of 10 splits the box price across ten vials. Stored per-vial.
        price: perVialPrice,
        priceUsd: perVialUsd,
        strength: product.strength,
        image_url: product.image_url || undefined,
        box_image_url: product.box_image_url || undefined,
        packSize,
        priceType: packSize === 1 ? 'vial' : 'box',
      },
      packs
    );
  };

  const handleAddToCart = () => {
    if (!product) return;
    addToCart();
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    setCartOpen(true);
  };

  // Skip the cart and go straight to checkout.
  const handleBuyNow = () => {
    if (!product) return;
    addToCart();
    router.push('/checkout');
  };

  // Reveal the sticky add-to-cart bar once the main buy box scrolls above the
  // viewport, so the price + actions stay reachable while reading down the page.
  useEffect(() => {
    const el = buyBoxRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowStickyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [product]);

  if (loading) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
            <div className="h-6 bg-surface rounded w-32 animate-pulse" />
          </div>
        </div>
        <div className="py-8 sm:py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
            <div className="animate-pulse">
              <div className="grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12">
                <div className="h-64 sm:h-80 md:h-[500px] bg-surface rounded-2xl" />
                <div className="space-y-4">
                  <div className="h-8 sm:h-10 bg-surface rounded w-3/4" />
                  <div className="h-5 sm:h-6 bg-surface rounded w-1/4" />
                  <div className="h-20 sm:h-24 bg-surface rounded" />
                  <div className="h-10 sm:h-12 bg-surface rounded w-1/2" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // A network/server error while loading — offer a retry rather than telling the
  // customer the product doesn't exist (which a bare fetch failure would imply).
  if (loadError) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 text-center">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-4">
              Couldn&apos;t load this product
            </h1>
            <p className="text-ink-muted mb-8 text-sm sm:text-base">
              Something went wrong on our end. Please check your connection and try again.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={retryLoad}
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all"
              >
                Try Again
              </button>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 text-bronze hover:text-bronze-dark font-medium text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Products</span>
              </Link>
            </div>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 text-center">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-4">
              Product Not Found
            </h1>
            <p className="text-ink-muted mb-8 text-sm sm:text-base">
              The product you&apos;re looking for doesn&apos;t exist.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-bronze hover:text-bronze-dark font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Products</span>
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero Header */}
      <section className="relative bg-white border-b border-line overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="molecular-grid"
                x="0"
                y="0"
                width="60"
                height="60"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="30" cy="30" r="1.5" fill="#1A1A1A" />
                <circle cx="0" cy="0" r="1" fill="#1A1A1A" />
                <circle cx="60" cy="0" r="1" fill="#1A1A1A" />
                <circle cx="0" cy="60" r="1" fill="#1A1A1A" />
                <circle cx="60" cy="60" r="1" fill="#1A1A1A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#molecular-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-28 pb-6 sm:pb-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors text-sm mb-3 sm:mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Products</span>
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-[10px] sm:text-xs font-medium text-ink bg-surface px-2 sm:px-3 py-1 rounded-full border border-line">
                {product.category}
              </span>
              <span className="text-[10px] sm:text-xs font-semibold text-bronze bg-bronze-50 px-2 sm:px-3 py-1 rounded-full border border-bronze/20">
                {product.purity} Purity
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Product Detail */}
      <section className="py-6 sm:py-10 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
          <div className="grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12 mb-10 sm:mb-16">
            {/* Product Image */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="bg-surface rounded-xl sm:rounded-2xl overflow-hidden border border-line">
                <div className="aspect-square flex items-center justify-center p-4 sm:p-8">
                  {(() => {
                    // Show the packaging shot for the pack of 10 (when one
                    // exists); otherwise fall back to the single-vial image.
                    const displayImage =
                      packSize === 10 && product.box_image_url
                        ? product.box_image_url
                        : product.image_url;
                    return displayImage ? (
                      <img
                        key={displayImage}
                        src={displayImage}
                        alt={product.name}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Beaker className="w-16 sm:w-24 h-16 sm:h-24 text-line" />
                    );
                  })()}
                </div>
              </div>
            </motion.div>

            {/* Product Info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="flex flex-col"
            >
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-ink mb-3 sm:mb-4 tracking-tight">
                {product.name}
              </h1>

              <p className="text-ink-muted mb-4 sm:mb-6 leading-relaxed text-sm sm:text-base">
                {product.description}
              </p>

              {/* Product Specs */}
              {(() => {
                const coas = product.coa_url ?? [];
                const hasCoa = coas.length > 0;
                return (
                  <div className={`grid gap-2 sm:gap-3 mb-4 sm:mb-6 ${hasCoa ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                    <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                      <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">
                        Purity
                      </div>
                      <div className="text-bronze font-bold text-sm sm:text-base">
                        {product.purity}
                      </div>
                    </div>
                    <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                      <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">
                        Strength
                      </div>
                      <div className="text-ink font-bold text-sm sm:text-base">
                        {product.strength}
                      </div>
                    </div>
                    <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                      <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">
                        Form
                      </div>
                      <div className="text-ink font-bold text-sm sm:text-base">
                        {product.form}
                      </div>
                    </div>
                    {hasCoa && (
                      <a
                        href={coas[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line hover:border-bronze hover:bg-bronze/5 transition-all cursor-pointer group"
                        title={coas.length > 1 ? `${coas.length} certificates available` : 'View Certificate of Analysis'}
                      >
                        <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1 group-hover:text-bronze transition-colors">
                          COA{coas.length > 1 ? ` ×${coas.length}` : ''}
                        </div>
                        <div className="flex items-center justify-center">
                          <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-bronze" />
                        </div>
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Additional COAs (beyond the first one shown in the specs grid) */}
              {(product.coa_url ?? []).length > 1 && (
                <div className="mb-4 sm:mb-6">
                  <div className="text-[10px] sm:text-xs text-ink-muted uppercase tracking-wider mb-2">
                    All certificates
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {(product.coa_url ?? []).map((url, i) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-bronze bg-bronze/5 hover:bg-bronze hover:text-white px-3 py-1.5 rounded-full border border-bronze/20 transition-all"
                        >
                          <FileText className="w-3 h-3" />
                          COA #{i + 1}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Benefits */}
              {product.benefits && (
                <div className="mb-4 sm:mb-6">
                  <h3 className="font-semibold text-ink mb-2 sm:mb-3 text-sm">
                    Benefits
                  </h3>
                  <ul className="space-y-1.5 sm:space-y-2">
                    {product.benefits.split(",").map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-bronze flex-shrink-0 mt-0.5" />
                        <span className="text-ink-muted text-xs sm:text-sm">
                          {benefit.trim()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Price and Add to Cart */}
              <div ref={buyBoxRef} className="mt-auto pt-4 sm:pt-6 border-t border-line">
                {showPrices && (
                  <div className="flex items-center justify-between mb-4 sm:mb-6">
                    {product.price === 0 ? (
                      <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink-muted">
                        N/A
                      </div>
                    ) : (
                      <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink tabular-nums">
                        {money(product.price, productUsdPrice(product, rate, convert))}
                        <span className="text-sm font-medium text-ink-muted ml-1">
                          {curCode} / pack of 10
                        </span>
                        <span className="block text-sm font-medium text-ink-muted mt-1 tabular-nums">
                          {money(singleVialPrice, singleVialUsd)} / single vial
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Pack size + quantity */}
                {product.price > 0 && product.stock_quantity > 0 && (
                  <div className="mb-4 sm:mb-6 space-y-3">
                    <div>
                      <span className="block text-xs font-medium text-ink mb-2">Option</span>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { size: 1 as const, label: 'Single vial', sub: '1 vial' },
                          { size: 10 as const, label: 'Pack of 10', sub: '10 vials' },
                        ]).map((opt) => {
                          const active = packSize === opt.size;
                          return (
                            <button
                              key={opt.size}
                              type="button"
                              onClick={() => {
                                setPackSize(opt.size);
                                // Keep the quantity within available stock for
                                // the newly selected pack size.
                                const maxForSize = Math.max(1, Math.floor(product.stock_quantity / opt.size));
                                setPacks((p) => Math.min(p, maxForSize));
                              }}
                              className={`rounded-xl border p-3 text-left transition-all ${
                                active
                                  ? 'border-ink bg-ink text-white'
                                  : 'border-line bg-surface text-ink hover:border-ink/30'
                              }`}
                            >
                              <span className="block text-sm font-semibold">{opt.label}</span>
                              <span className={`block text-[11px] ${active ? 'text-white/70' : 'text-ink-muted'}`}>
                                {opt.sub}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(() => {
                      const maxPacks = Math.max(1, Math.floor(product.stock_quantity / packSize));
                      const atMax = packs >= maxPacks;
                      return (
                        <>
                          <div className="flex items-center gap-3">
                            <span className="text-ink-muted text-xs sm:text-sm">
                              Qty ({packSize === 1 ? 'vials' : 'packs'}):
                            </span>
                            <div className="flex items-center bg-surface border border-line rounded-lg overflow-hidden">
                              <button
                                onClick={() => setPacks(Math.max(1, packs - 1))}
                                aria-label="Decrease quantity"
                                className="px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-white transition-colors font-medium text-sm"
                              >
                                -
                              </button>
                              <span className="px-3 sm:px-4 py-2 sm:py-2.5 font-semibold tabular-nums bg-white border-x border-line text-sm">
                                {packs}
                              </span>
                              <button
                                onClick={() => setPacks(Math.min(maxPacks, packs + 1))}
                                disabled={atMax}
                                aria-label="Increase quantity"
                                className="px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-white transition-colors font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs text-ink-muted">
                              = {packSize * packs} {packSize * packs === 1 ? 'vial' : 'vials'}
                            </span>
                          </div>
                          {product.stock_quantity <= 10 && (
                            <p className="text-xs text-amber-600 mt-2">
                              Only {product.stock_quantity} {product.stock_quantity === 1 ? 'vial' : 'vials'} left in stock
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {product.price === 0 ? (
                  <button
                    disabled
                    className="w-full font-semibold py-3 sm:py-4 rounded-xl bg-surface text-ink-muted cursor-not-allowed flex items-center justify-center gap-2 text-sm border border-line"
                  >
                    <span>Currently Unavailable</span>
                  </button>
                ) : product.stock_quantity === 0 ? (
                  <NotifyMeButton
                    productId={product.id}
                    productName={product.name}
                    variant="full"
                  />
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={handleAddToCart}
                      disabled={added}
                      className={`w-full font-semibold py-3 sm:py-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm ${
                        added
                          ? "bg-emerald-500 text-white"
                          : "bg-surface hover:bg-line/60 text-ink border border-line"
                      }`}
                    >
                      {added ? (
                        <>
                          <Check className="w-5 h-5" />
                          <span>Added to Cart!</span>
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-5 h-5" />
                          <span>
                            {showPrices
                              ? `Add to Cart - ${money(perVialPrice * packSize * packs, perVialUsd * packSize * packs)}`
                              : 'Add to Cart'}
                          </span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleBuyNow}
                      className="w-full font-semibold py-3 sm:py-4 rounded-xl bg-ink hover:bg-ink/90 text-white transition-all duration-200 flex items-center justify-center gap-2 text-sm"
                    >
                      <Zap className="w-5 h-5" />
                      <span>Buy Now</span>
                    </button>
                  </div>
                )}

                {/* Trust Badges */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-line">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Shield className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">
                      Lab Tested
                    </span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Package className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">
                      Secure Pack
                    </span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Truck className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">
                      Fast Ship
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Mechanism of Action */}
          {product.mechanism && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-surface rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 border border-line mb-8 sm:mb-10"
            >
              <div className="flex items-center gap-3 mb-3 sm:mb-4">
                <div className="w-9 sm:w-10 h-9 sm:h-10 bg-bronze/10 rounded-lg sm:rounded-xl flex items-center justify-center">
                  <FlaskConical className="w-4 sm:w-5 h-4 sm:h-5 text-bronze" />
                </div>
                <h2 className="text-base sm:text-lg md:text-xl font-bold text-ink">
                  Mechanism of Action
                </h2>
              </div>
              <p className="text-ink-muted leading-relaxed text-sm sm:text-base">
                {product.mechanism}
              </p>
            </motion.div>
          )}

          {/* Essential Add-on - Bacteriostatic Water */}
          {product.slug !== "bacteriostatic-water-30ml" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mb-8 sm:mb-10"
            >
              <div className="bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 text-white">
                <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                  <div className="w-16 sm:w-20 h-16 sm:h-20 bg-white rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img
                      src="/images/products/Bacteriostatic Water 30ML.png"
                      alt="Bacteriostatic Water"
                      className="w-full h-full object-contain p-1.5 sm:p-2"
                    />
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <div className="text-[10px] sm:text-xs font-medium text-bronze mb-0.5 sm:mb-1">
                      You&apos;ll also need
                    </div>
                    <h3 className="text-base sm:text-lg font-bold mb-0.5 sm:mb-1">
                      Bacteriostatic Water 30ML
                    </h3>
                    <p className="text-white/60 text-xs sm:text-sm">
                      Essential for reconstituting lyophilized peptides.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2 sm:gap-3 flex-shrink-0">
                    {showPrices && (
                      <div className="text-xl sm:text-2xl font-bold tabular-nums">
                        $20.00
                      </div>
                    )}
                    <Link
                      href="/products/bacteriostatic-water-30ml"
                      className="bg-white hover:bg-white/90 text-ink font-semibold px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all text-xs sm:text-sm"
                    >
                      View Product
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Quality Certifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-10 sm:mb-16"
          >
            <div className="bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8">
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-white mb-4 sm:mb-6 text-center">
                Quality Certifications
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-bronze/20 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Beaker className="w-5 sm:w-6 h-5 sm:h-6 text-bronze" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">
                    99%+ Purity
                  </h3>
                  <p className="text-[10px] sm:text-xs text-white/50">
                    Third-party verified
                  </p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Award className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">
                    GMP Certified
                  </h3>
                  <p className="text-[10px] sm:text-xs text-white/50">
                    Good Manufacturing
                  </p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <BadgeCheck className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">
                    ISO Compliant
                  </h3>
                  <p className="text-[10px] sm:text-xs text-white/50">
                    Intl standards
                  </p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Shield className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">
                    COA Available
                  </h3>
                  <p className="text-[10px] sm:text-xs text-white/50">
                    Certificate of Analysis
                  </p>
                </div>
              </div>
              <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 text-center">
                <p className="text-xs sm:text-sm text-white/50">
                  <span className="font-medium text-white/70">
                    For Research Purposes Only
                  </span>{" "}
                  - Not for human consumption.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-ink mb-4 sm:mb-6">
                Related Products
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 md:gap-5">
                {relatedProducts.map((relProduct) => (
                  <Link
                    key={relProduct.id}
                    href={`/products/${relProduct.slug}`}
                  >
                    <div className="group bg-white rounded-lg sm:rounded-xl overflow-hidden border border-line hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all">
                      <div className="bg-surface aspect-square flex items-center justify-center p-2 sm:p-4">
                        {relProduct.image_url ? (
                          <img
                            src={relProduct.image_url}
                            alt={relProduct.name}
                            className="h-full w-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <Beaker className="w-8 sm:w-12 h-8 sm:h-12 text-line" />
                        )}
                      </div>
                      <div className="p-2.5 sm:p-4">
                        <p className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-0.5 sm:mb-1">
                          {relProduct.strength}
                        </p>
                        <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors mb-1.5 sm:mb-2 line-clamp-1 text-xs sm:text-sm">
                          {relProduct.name}
                        </h3>
                        {showPrices && (
                          <div className="flex justify-between items-center">
                            {relProduct.price === 0 ? (
                              <span className="text-ink-muted font-bold text-sm">
                                N/A
                              </span>
                            ) : (
                              <span className="text-ink font-bold tabular-nums text-sm sm:text-base">
                                {money(relProduct.price, productUsdPrice(relProduct, rate, convert))}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* Sticky add-to-cart bar — appears once the main buy box scrolls away */}
      <AnimatePresence>
        {showStickyBar && product.price > 0 && product.stock_quantity > 0 && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink line-clamp-1">{product.name}</p>
                <p className="text-xs text-ink-muted tabular-nums">
                  {showPrices
                    ? `${money(perVialPrice * packSize * packs, perVialUsd * packSize * packs)} · `
                    : ''}
                  {packSize === 1 ? 'Single vial' : 'Pack of 10'} ×{packs}
                </p>
              </div>
              <button
                onClick={handleAddToCart}
                className="flex-shrink-0 font-semibold py-2.5 px-4 rounded-xl bg-surface hover:bg-line/60 text-ink border border-line transition-all flex items-center justify-center gap-2 text-sm"
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Add</span>
              </button>
              <button
                onClick={handleBuyNow}
                className="flex-shrink-0 font-semibold py-2.5 px-5 rounded-xl bg-ink hover:bg-ink/90 text-white transition-all flex items-center justify-center gap-2 text-sm"
              >
                <Zap className="w-4 h-4" />
                <span>Buy Now</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Footer />
    </main>
  );
}
