'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useCustomer } from '@/contexts/CustomerContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { productUsdPrice } from '@/lib/pricing';
import { ShoppingCart, ArrowRight, Beaker, FlaskConical } from 'lucide-react';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { useHoverCapable } from '@/lib/hooks/useHoverCapable';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';
import NotifyMeButton from '@/components/NotifyMeButton';
import AddToCartModal, { type AddToCartProduct } from '@/components/AddToCartModal';

interface Product {
  id: string;
  name: string;
  slug: string;
  description_short: string | null;
  price: number;
  vial_price: number | null;
  price_usd: number | null;
  purity: string;
  strength: string;
  image_url: string | null;
  box_image_url: string | null;
  box_image_first?: boolean;
  coa_url: string[] | null;
  stock_quantity: number;
  has_override?: boolean;
  original_price?: number;
}

export default function Products() {
  const { customer } = useCustomer();
  // Prices are only shown to signed-in customers; guests browse without pricing.
  const showPrices = !!customer;
  const { currency, rate, convert, ready: currencyReady } = useCurrency();
  const [modalProduct, setModalProduct] = useState<AddToCartProduct | null>(null);

  const {
    data: productsData,
    loading: productsLoading,
    slow,
    error,
    reload,
  } = useSmartLoad<Product[]>(async () => {
    // Use API endpoint that supports customer-specific pricing
    const url = new URL('/api/products/featured', window.location.origin);
    if (customer?.id) {
      url.searchParams.set('customer_id', customer.id);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to load featured products (${response.status})`);
    }
    const { products: data } = await response.json();
    return data || [];
  }, [customer?.id]);

  const products = productsData ?? [];
  const hoverCapable = useHoverCapable();
  // Hold the skeleton until currency + rate resolve too (no CAD→USD flash).
  const loading = productsLoading || !currencyReady;

  const money = (cad: number, usdOverride?: number | null) =>
    `$${(currency === 'USD'
      ? usdOverride != null
        ? usdOverride
        : cad * rate
      : cad
    ).toFixed(2)}`;

  const handleAddToCart = (product: Product) => {
    setModalProduct({
      id: product.id,
      name: product.name,
      price: product.price,
      vial_price: product.vial_price,
      price_usd: product.price_usd,
      has_override: product.has_override,
      strength: product.strength,
      image_url: product.image_url || undefined,
      box_image_url: product.box_image_url || undefined,
    });
  };

  if (error) {
    return (
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <LoadingError onRetry={reload} />
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="mb-10">
            <div className="h-8 bg-surface rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-surface rounded w-64 animate-pulse" />
          </div>
          {slow && <SlowLoadingNotice onReload={reload} />}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-line overflow-hidden animate-pulse">
                <div className="bg-surface aspect-square" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-surface rounded w-3/4" />
                  <div className="h-4 bg-surface rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
    <section className="py-20 sm:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-vital/10 border border-vital/20 rounded-full mb-3">
              <Beaker className="w-3.5 h-3.5 text-vital" />
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-vital-dark">Featured Compounds</span>
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-3">Popular Research Peptides</h2>
            <div className="brand-rule h-[3px] w-20 rounded-full mb-4" aria-hidden="true" />
            <p className="text-ink-muted">High-purity compounds for scientific research</p>
          </div>
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-ink-muted"
          >
            View full catalog
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-5">
          {products.map((product, index) => {
            // Which image leads the card. Opted-in products lead with the box
            // image and move the vial shot to the hover position; every other
            // product stays vial-first (box on hover) as before.
            const boxFirst = !!product.box_image_first && !!product.box_image_url;
            const primarySrc = boxFirst ? product.box_image_url : product.image_url;
            const hoverSrc = boxFirst ? product.image_url : product.box_image_url;
            const primaryAlt = boxFirst ? `${product.name} packaging` : product.name;
            const hoverAlt = boxFirst ? product.name : `${product.name} packaging`;
            return (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              viewport={{ once: true }}
              className="group bg-white rounded-lg sm:rounded-xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all"
            >
              {/* Product Image */}
              <Link href={`/products/${product.slug}`}>
                <div className="relative bg-surface aspect-square p-2 sm:p-4">
                  {primarySrc ? (
                    <div className="relative w-full h-full">
                      <Image
                        src={primarySrc}
                        alt={primaryAlt}
                        fill
                        sizes="(max-width: 1024px) 50vw, 25vw"
                        className={`object-contain transition-all duration-300 ${
                          hoverCapable && hoverSrc
                            ? 'group-hover:opacity-0'
                            : 'group-hover:scale-105'
                        }`}
                      />
                      {/* The other image (box or vial) — only on hover-capable
                          (mouse) devices, so it's never downloaded on touch
                          screens. */}
                      {hoverCapable && hoverSrc && (
                        <Image
                          src={hoverSrc}
                          alt={hoverAlt}
                          fill
                          sizes="(max-width: 1024px) 50vw, 25vw"
                          className="object-contain opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Beaker className="w-10 sm:w-12 h-10 sm:h-12 text-line" />
                    </div>
                  )}
                  {/* Purity Badge - Bronze accent */}
                  {product.purity && product.purity.trim() && (
                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3">
                      <span className="text-[8px] sm:text-[10px] font-semibold text-vital bg-vital-50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full border border-vital/20">
                        {product.purity}
                      </span>
                    </div>
                  )}
                </div>
              </Link>

              {/* Product Info */}
              <div className="p-2.5 sm:p-4">
                <Link href={`/products/${product.slug}`}>
                  <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors line-clamp-1 mb-0.5 sm:mb-1 text-xs sm:text-base">
                    {product.name}
                  </h3>
                </Link>
                <p className="text-[10px] sm:text-xs text-ink-muted mb-2 sm:mb-3">{product.strength}</p>

                <div className="flex items-center justify-between gap-1">
                  {showPrices ? (
                    <span className="text-sm sm:text-lg font-bold text-ink tabular-nums">
                      {money(product.price, productUsdPrice(product, rate, convert))}
                      {currency === 'USD' && <span className="text-[9px] font-medium text-ink-muted ml-0.5">USD</span>}
                    </span>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-1.5">
                    {/* COA Button - first cert; product detail page lists all */}
                    {product.coa_url && product.coa_url.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Open the first COA; the product detail page lists them all.
                          const first = product.coa_url?.[0];
                          if (first) window.open(first, '_blank', 'noopener,noreferrer');
                        }}
                        className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-2 border border-vital/40 text-vital hover:bg-vital hover:text-white text-xs font-medium rounded-lg transition-all"
                        title={
                          product.coa_url.length > 1
                            ? `View Certificate of Analysis (${product.coa_url.length} available)`
                            : 'View Certificate of Analysis'
                        }
                        type="button"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">
                          COA{product.coa_url.length > 1 ? ` ×${product.coa_url.length}` : ''}
                        </span>
                      </button>
                    )}
                    {!product.stock_quantity || product.stock_quantity === 0 ? (
                      <NotifyMeButton productId={product.id} productName={product.name} />
                    ) : (
                      <button
                        onClick={() => handleAddToCart(product)}
                        className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-2 bg-ink hover:bg-ink/90 text-white text-xs font-medium rounded-lg transition-all"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Add</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
            );
          })}
        </div>
      </div>
    </section>
    <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} />
    </>
  );
}
