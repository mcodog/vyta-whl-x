'use client';

import React, { Suspense, useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Filter, X, Search, Scale, Heart, Sparkles, Dumbbell, Brain, Zap, Beaker, ChevronRight, TestTube, Pill, Dna, FlaskConical, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/supabase';
import { useCustomer } from '@/contexts/CustomerContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { productUsdPrice, usdFromCad } from '@/lib/pricing';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { useHoverCapable } from '@/lib/hooks/useHoverCapable';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';
import NotifyMeButton from '@/components/NotifyMeButton';
import AddToCartModal, { type AddToCartProduct } from '@/components/AddToCartModal';
import { rankBySearch } from '@/lib/search';
import { getStoreCategories, getCategoryIcon } from '@/lib/categories';

interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  description_short: string | null;
  price: number;
  vial_price: number | null;
  price_usd: number | null;
  strength: string;
  purity: string;
  form: string;
  active: boolean;
  image_url: string | null;
  box_image_url: string | null;
  box_image_first?: boolean;
  stock_quantity: number;
  coa_url: string[] | null;
  has_override?: boolean;
  original_price?: number;
}

// How many cards to render initially and per "load more" step as the user
// scrolls. Keeps the number of images decoding at once small so packaging
// (hover) shots are ready quickly.
const PAGE_SIZE = 12;

type CategoryChip = { name: string; slug: string; icon: LucideIcon };

// "All" is always first and is not a stored category. The rest are seeded from
// the DB (store_categories) at runtime; this list is the fallback used before
// the fetch resolves or if it fails, so the filter bar always renders.
const ALL_CATEGORY: CategoryChip = { name: 'All', slug: 'All', icon: Beaker };

const FALLBACK_CATEGORIES: CategoryChip[] = [
  ALL_CATEGORY,
  { name: 'Metabolic', slug: 'Weight Loss / Metabolic', icon: TestTube },
  { name: 'Healing', slug: 'Healing / Recovery', icon: Heart },
  { name: 'Anti-Aging', slug: 'Anti-Aging / Beauty', icon: Sparkles },
  { name: 'Performance', slug: 'Bodybuilding / Fitness', icon: Dna },
  { name: 'Cognitive', slug: 'Cognitive / Focus', icon: Brain },
  { name: 'Sexual Health', slug: 'Sexual Health', icon: Zap },
  { name: 'General Health', slug: 'General Health', icon: Pill },
  { name: 'Hormonal', slug: 'Hormonal / Fertility', icon: Scale },
  { name: 'Tanning', slug: 'Beauty / Tanning', icon: Sparkles },
];

function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Filters are seeded from the URL so browsing into a product and hitting Back
  // keeps the search/category (and the view can be bookmarked/shared). They're
  // written back to the URL whenever they change.
  const [selectedCategory, setSelectedCategory] = useState(() => searchParams.get('category') ?? 'All');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [showCoaOnly, setShowCoaOnly] = useState(() => searchParams.get('coa') === '1');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  // Category filter chips are driven by the controlled store_categories list
  // (editable in /admin/categories). Falls back to the built-in list until the
  // fetch resolves / if it fails, so the bar always renders.
  const [categories, setCategories] = useState<CategoryChip[]>(FALLBACK_CATEGORIES);

  useEffect(() => {
    let cancelled = false;
    getStoreCategories().then((rows) => {
      if (cancelled || rows.length === 0) return;
      setCategories([
        ALL_CATEGORY,
        ...rows.map((c) => ({ name: c.name, slug: c.slug, icon: getCategoryIcon(c.icon) })),
      ]);
    });
    return () => { cancelled = true; };
  }, []);
  // Only mouse-capable devices swap in the packaging image on hover, so we skip
  // rendering (and downloading) it on touch devices entirely.
  const hoverCapable = useHoverCapable();

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    if (searchQuery) params.set('q', searchQuery);
    if (showCoaOnly) params.set('coa', '1');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [selectedCategory, searchQuery, showCoaOnly, pathname, router]);
  const [modalProduct, setModalProduct] = useState<AddToCartProduct | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { customer } = useCustomer();
  // Prices are only shown to signed-in customers; guests browse without pricing.
  const showPrices = !!customer;
  const { currency, rate, ready: currencyReady } = useCurrency();

  const {
    data: productsData,
    loading: productsLoading,
    slow,
    error,
    reload,
  } = useSmartLoad<Product[]>(async () => {
    // Use new API endpoint that supports customer-specific pricing
    const url = new URL('/api/products', window.location.origin);
    if (customer?.id) {
      url.searchParams.set('customer_id', customer.id);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to load products (${response.status})`);
    }
    const { products: data } = await response.json();
    return data || [];
  }, [customer?.id]);

  const products = useMemo(() => productsData ?? [], [productsData]);

  // Hold the price skeleton until the currency + exchange rate resolve too, so a
  // USD-tagged customer never sees a CAD price flash before the USD one.
  const loading = productsLoading || !currencyReady;

  // Render a CAD-base amount in the active display currency.
  const money = (cad: number, usdOverride?: number | null) =>
    `$${(currency === 'USD'
      ? usdOverride != null
        ? usdOverride
        : usdFromCad(cad, rate)
      : cad
    ).toFixed(2)}`;

  const filteredProducts = useMemo(() => {
    let result = products;

    if (selectedCategory !== 'All') {
      result = result.filter((p) => p.category === selectedCategory);
    }

    if (showCoaOnly) {
      result = result.filter((p) => Array.isArray(p.coa_url) && p.coa_url.length > 0);
    }

    // Push products without an image, then out-of-stock items, to the bottom
    // while preserving the original order within each group.
    const byImageThenStock = (a: Product, b: Product) => {
      const aNoImg = a.image_url ? 0 : 1;
      const bNoImg = b.image_url ? 0 : 1;
      if (aNoImg !== bNoImg) return aNoImg - bNoImg;
      const aOut = a.stock_quantity === 0 ? 1 : 0;
      const bOut = b.stock_quantity === 0 ? 1 : 0;
      return aOut - bOut;
    };

    if (searchQuery.trim()) {
      // Relevance-rank matches so a product whose name starts with the query
      // (e.g. "Retatrutide" for "reta") beats products that only mention it in
      // their description. Ties fall back to images-first / in-stock ordering.
      return rankBySearch(
        result,
        searchQuery,
        [
          { value: (p) => p.name, weight: 3 },
          { value: (p) => p.category, weight: 1 },
          { value: (p) => p.description, weight: 1 },
        ],
        byImageThenStock,
      );
    }

    return [...result].sort(byImageThenStock);
  }, [products, selectedCategory, searchQuery, showCoaOnly]);

  // Infinite scroll: only render the first `visibleCount` cards, growing by a
  // page each time the sentinel scrolls into view.
  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );
  const hasMore = visibleCount < filteredProducts.length;

  // Start over from the top whenever the result set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategory, searchQuery, showCoaOnly]);

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      // Begin loading the next batch a little before the sentinel is reached.
      { rootMargin: '600px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleProducts.length]);

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

  const getCategoryCount = (slug: string) => {
    if (slug === 'All') return products.length;
    return products.filter((p) => p.category === slug).length;
  };

  const selectedCategoryData = categories.find(c => c.slug === selectedCategory) || categories[0];

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero Header Section */}
      <section className="relative bg-white border-b border-line overflow-hidden">
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-[0.02]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="molecular-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="#07203A" />
                <circle cx="0" cy="0" r="1" fill="#07203A" />
                <circle cx="60" cy="0" r="1" fill="#07203A" />
                <circle cx="0" cy="60" r="1" fill="#07203A" />
                <circle cx="60" cy="60" r="1" fill="#07203A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#molecular-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-32 sm:pt-44 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-vital/10 border border-vital/20 rounded-full mb-4">
              <Beaker className="w-3.5 h-3.5 text-vital" />
              <span className="text-xs font-medium text-vital">Pharmaceutical Grade Quality</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight text-ink">
              Research Compound Catalog
            </h1>
            <p className="text-base sm:text-lg text-ink-muted max-w-xl mx-auto">
              HPLC-verified peptides with 99%+ purity for scientific research
            </p>
          </motion.div>
        </div>
      </section>

      {/* Category Bar */}
      <section className="bg-surface border-b border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-6">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {categories.map((category) => {
              const isActive = selectedCategory === category.slug;
              const count = getCategoryCount(category.slug);
              return (
                <button
                  key={category.slug}
                  onClick={() => setSelectedCategory(category.slug)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-sm font-medium ${
                    isActive
                      ? 'bg-ink text-white'
                      : 'bg-white text-ink-muted hover:text-ink hover:bg-white border border-line'
                  }`}
                >
                  <category.icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-ink-muted'}`} />
                  <span>{category.name}</span>
                  <span className={`text-xs ${isActive ? 'text-white/70' : 'text-ink-muted'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          {/* Search and Results Bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between mb-8">
            {/* Search */}
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
              <input
                type="text"
                placeholder="Search compounds..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
              />
            </div>

            {/* Results Info */}
            <div className="flex items-center gap-4">
              {/* COA-only toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={showCoaOnly}
                onClick={() => setShowCoaOnly((v) => !v)}
                className="flex items-center gap-2 text-sm select-none"
                title="Show only compounds with a Certificate of Analysis"
              >
                <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showCoaOnly ? 'bg-vital' : 'bg-line'}`}>
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showCoaOnly ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </span>
                <span className={`font-medium ${showCoaOnly ? 'text-ink' : 'text-ink-muted'}`}>COA only</span>
              </button>
              {selectedCategory !== 'All' && (
                <button
                  onClick={() => setSelectedCategory('All')}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                  Clear filter
                </button>
              )}
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="font-semibold text-ink tabular-nums">{filteredProducts.length}</span>
                <span>compounds</span>
                {selectedCategory !== 'All' && (
                  <span className="text-ink-muted">in {selectedCategoryData.name}</span>
                )}
              </div>
            </div>
          </div>

          {/* Products Grid */}
          {error ? (
            <LoadingError onRetry={reload} />
          ) : loading ? (
            <div>
              {slow && <SlowLoadingNotice onReload={reload} />}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl border border-line overflow-hidden animate-pulse"
                  >
                    <div className="bg-surface aspect-square" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-surface rounded w-3/4" />
                      <div className="h-4 bg-surface rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : filteredProducts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 sm:py-20"
            >
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-ink-muted" />
              </div>
              <h3 className="text-lg font-semibold text-ink mb-2">No compounds found</h3>
              <p className="text-ink-muted mb-6">Try adjusting your search or filter</p>
              <button
                onClick={() => {
                  setSelectedCategory('All');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-all"
              >
                View all compounds
                <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          ) : (
            <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {visibleProducts.map((product, index) => {
                // Which image leads the card. Opted-in products lead with the
                // box image and move the vial shot to the hover position; every
                // other product stays vial-first (box on hover) as before.
                const boxFirst = !!product.box_image_first && !!product.box_image_url;
                const primarySrc = boxFirst ? product.box_image_url : product.image_url;
                const hoverSrc = boxFirst ? product.image_url : product.box_image_url;
                const primaryAlt = boxFirst ? `${product.name} packaging` : product.name;
                const hoverAlt = boxFirst ? product.name : `${product.name} packaging`;
                return (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.02 }}
                  className={`group bg-white rounded-xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all ${
                    product.price === 0 ? 'opacity-60' : ''
                  }`}
                >
                  {/* Product Image */}
                  <div className="relative">
                    <Link href={`/products/${product.slug}`}>
                      <div className="relative bg-surface aspect-square p-4">
                        {primarySrc ? (
                          <div className="relative w-full h-full">
                            <Image
                              src={primarySrc}
                              alt={primaryAlt}
                              fill
                              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                              className={`object-contain transition-all duration-300 ${
                                hoverCapable && hoverSrc
                                  ? 'group-hover:opacity-0'
                                  : 'group-hover:scale-105'
                              }`}
                            />
                            {/* The other image (box or vial) is rendered (and
                                preloaded) under the primary one so it's ready the
                                instant a user hovers. Only on hover-capable (mouse)
                                devices — never downloaded on touch screens where
                                hover can't fire. */}
                            {hoverCapable && hoverSrc && (
                              <Image
                                src={hoverSrc}
                                alt={hoverAlt}
                                fill
                                sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                                className="object-contain opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Beaker className="w-12 h-12 text-line" />
                          </div>
                        )}
                        {/* Purity Badge - Bronze accent */}
                        {product.purity && product.purity.trim() && (
                          <div className="absolute top-3 left-3">
                            <span className="text-[10px] font-semibold text-vital bg-vital-50 px-2 py-1 rounded-full border border-vital/20">
                              {product.purity}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  </div>

                  {/* Product Info */}
                  <div className="p-4">
                    <p className="text-[10px] text-ink-muted font-medium uppercase tracking-wider mb-1 line-clamp-1">
                      {product.strength}
                    </p>
                    <Link href={`/products/${product.slug}`}>
                      <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors line-clamp-1 mb-3 text-sm sm:text-base">
                        {product.name}
                      </h3>
                    </Link>

                    <div className="flex items-center justify-between">
                      {!showPrices ? (
                        <span />
                      ) : product.price === 0 ? (
                        <span className="text-lg font-bold text-ink-muted">N/A</span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-lg font-bold text-ink tabular-nums leading-tight">
                            {money(product.price, productUsdPrice(product, rate))}
                            {currency === 'USD' && <span className="text-[9px] font-medium text-ink-muted ml-1">USD</span>}
                          </span>
                          <span className="text-[11px] text-ink-muted tabular-nums">
                            {product.vial_price != null && product.vial_price > 0
                              ? money(product.vial_price, usdFromCad(product.vial_price, rate))
                              : money(product.price / 10, productUsdPrice(product, rate) / 10)} / vial
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        {/* COA Button - first cert; product detail page lists all */}
                        {product.coa_url && product.coa_url.length > 0 && (
                          <a
                            href={product.coa_url[0]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-2 border border-vital/40 text-vital hover:bg-vital hover:text-white text-xs font-medium rounded-lg transition-all"
                            aria-label={
                              product.coa_url.length > 1
                                ? `View Certificate of Analysis for ${product.name} (${product.coa_url.length} available)`
                                : `View Certificate of Analysis for ${product.name}`
                            }
                            title={
                              product.coa_url.length > 1
                                ? `View Certificate of Analysis (${product.coa_url.length} available)`
                                : 'View Certificate of Analysis'
                            }
                          >
                            <FlaskConical className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">
                              COA{product.coa_url.length > 1 ? ` ×${product.coa_url.length}` : ''}
                            </span>
                          </a>
                        )}
                        {product.stock_quantity === 0 && product.price > 0 ? (
                          <NotifyMeButton productId={product.id} productName={product.name} />
                        ) : product.stock_quantity === 0 ? (
                          <span className="text-xs text-red-600 font-medium">Out of Stock</span>
                        ) : product.price === 0 ? (
                          <span className="text-xs text-ink-muted font-medium">Unavailable</span>
                        ) : (
                          <button
                            onClick={() => handleAddToCart(product)}
                            aria-label={`Add ${product.name} to cart`}
                            className="flex items-center gap-1.5 px-3 py-2 bg-ink hover:bg-ink/90 text-white text-xs font-medium rounded-lg transition-all"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {product.price > 0 && product.stock_quantity > 0 && product.stock_quantity <= 10 && (
                      <p className="text-[11px] text-amber-600 font-medium mt-2">
                        Only {product.stock_quantity} left
                      </p>
                    )}
                  </div>
                </motion.div>
                );
              })}
              </div>

              {/* Infinite-scroll trigger + progress indicator */}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-10"
                >
                  <div className="flex items-center gap-2 text-sm text-ink-muted">
                    <div className="w-4 h-4 border-2 border-line border-t-vital rounded-full animate-spin" />
                    Loading more compounds…
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-12 sm:py-16 bg-surface">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="bg-ink rounded-2xl p-6 sm:p-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-vital mb-1 tabular-nums">99%+</div>
                <div className="text-xs sm:text-sm text-white/60">Verified Purity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">3rd Party</div>
                <div className="text-xs sm:text-sm text-white/60">HPLC Tested</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">Same Day</div>
                <div className="text-xs sm:text-sm text-white/60">Order Processing</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">Discreet</div>
                <div className="text-xs sm:text-sm text-white/60">Secure Packaging</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />

      <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} />
    </main>
  );
}

export default function ProductsPageWrapper() {
  // ProductsPage reads the URL via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ProductsPage />
    </Suspense>
  );
}
