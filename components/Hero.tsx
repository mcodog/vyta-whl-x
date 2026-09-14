'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight,
  Award,
  Beaker,
  FileCheck,
  MapPin,
  Microscope,
  Pause,
  Play,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { supabase, type Product } from '@/lib/supabase';
import { useCustomer } from '@/contexts/CustomerContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { productUsdPrice } from '@/lib/pricing';
import AddToCartModal, { type AddToCartProduct } from '@/components/AddToCartModal';

// Muted background loop. Hosted on public Supabase Storage; swap for any public
// HTTPS URL (ideally re-hosted in this project's own `products` bucket). When
// empty the hero runs permanently on the graded still.
const HERO_VIDEO_URL =
  'https://didnmcyrxgubgesiaatj.supabase.co/storage/v1/object/public/products/Video%20Project.mp4';
// Dark still shown immediately (the LCP element) and behind the video.
const HERO_FALLBACK_IMAGE = '/images/hero-bg.jpeg';

const TICKER_CLAIMS = [
  'HPLC-UV tested — PPB Analytical Inc.',
  'Full COA on every order',
  'GMP certified facilities',
  'Canadian supplier — ships from Canada',
  '50+ research compounds',
  '24h order processing',
];

const TRUST_CHIPS = [
  { icon: ShieldCheck, label: 'GMP Certified' },
  { icon: Microscope, label: 'HPLC Tested' },
  { icon: Award, label: '99%+ Purity' },
] as const;

// Inline film-grain texture (no asset needed).
const GRAIN_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Just the columns the hero needs — keeps the anon read lean.
type FeaturedProduct = Pick<
  Product,
  | 'id'
  | 'name'
  | 'slug'
  | 'price'
  | 'price_usd'
  | 'vial_price'
  | 'vials_per_box'
  | 'purity'
  | 'strength'
  | 'image_url'
  | 'box_image_url'
  | 'box_image_first'
  | 'stock_quantity'
>;

const FEATURED_COLUMNS =
  'id, name, slug, price, price_usd, vial_price, vials_per_box, purity, strength, image_url, box_image_url, box_image_first, stock_quantity';

export default function Hero() {
  const { customer } = useCustomer();
  // Prices are only shown to signed-in customers; guests browse without pricing.
  const showPrices = !!customer;
  const { currency, rate, convert, ready: currencyReady } = useCurrency();
  const prefersReducedMotion = useReducedMotion();

  const [featured, setFeatured] = useState<FeaturedProduct[]>([]);
  const [productLoading, setProductLoading] = useState(true);
  const [allowVideo, setAllowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [modalProduct, setModalProduct] = useState<AddToCartProduct | null>(null);

  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Media parallaxes slower than the page; content eases up and dissolves.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const mediaY = useTransform(scrollYProgress, [0, 1], ['0%', '10%']);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  // Only download the video on wider viewports, and never under reduced motion —
  // phones and reduced-motion users stay on the graded still.
  useEffect(() => {
    if (!HERO_VIDEO_URL || prefersReducedMotion) {
      setAllowVideo(false);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setAllowVideo(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefersReducedMotion]);

  // Live featured product(s): read of the public catalog, aborted after 8s. For
  // a signed-in customer we then layer their configured box + vial prices and
  // visibility on top, so the featured card shows the prices set for them (RLS
  // lets a customer read their own customer_price_overrides via this session).
  const customerId = customer?.id;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    (async () => {
      setProductLoading(true);
      try {
        const { data, error } = await supabase
          .from('products')
          .select(FEATURED_COLUMNS)
          .eq('active', true)
          .eq('featured', true)
          .gt('stock_quantity', 0)
          .order('price', { ascending: false })
          .limit(8)
          .abortSignal(controller.signal);
        if (!active || error || !data) return;

        let list = data as unknown as FeaturedProduct[];

        if (customerId) {
          const { data: ov } = await supabase
            .from('customer_price_overrides')
            .select('product_id, override_price, vial_override_price, is_visible')
            .eq('customer_id', customerId)
            .abortSignal(controller.signal);
          if (active && ov && ov.length) {
            // Hidden: explicitly hidden, or a $0 custom box price.
            const hidden = new Set(
              ov.filter((o) => o.is_visible === false || Number(o.override_price) === 0)
                .map((o) => o.product_id),
            );
            const boxMap = new Map(
              ov.filter((o) => o.override_price != null).map((o) => [o.product_id, Number(o.override_price)]),
            );
            const vialMap = new Map(
              ov.filter((o) => o.vial_override_price != null).map((o) => [o.product_id, Number(o.vial_override_price)]),
            );
            list = list
              .filter((p) => !hidden.has(p.id))
              .map((p) => ({
                ...p,
                price: boxMap.has(p.id) ? (boxMap.get(p.id) as number) : p.price,
                vial_price: vialMap.has(p.id) ? (vialMap.get(p.id) as number) : p.vial_price,
              }));
          }
        }

        if (active) setFeatured(list);
      } catch {
        /* aborted / network error — keep the fallback card */
      } finally {
        clearTimeout(timeout);
        if (active) setProductLoading(false);
      }
    })();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [customerId]);

  const product = featured[0] ?? null;
  const tickerProducts = featured.filter((p) => p.purity && p.purity.trim());
  const cardLoading = productLoading || !currencyReady;

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (videoPlaying) {
      video.pause();
      setVideoPlaying(false);
    } else {
      video.play().catch(() => {});
      setVideoPlaying(true);
    }
  };

  const openAdd = (p: FeaturedProduct) => {
    setModalProduct({
      id: p.id,
      name: p.name,
      price: p.price,
      vial_price: p.vial_price,
      price_usd: p.price_usd,
      strength: p.strength ?? '',
      image_url: p.image_url ?? undefined,
      box_image_url: p.box_image_url ?? undefined,
    });
  };

  // Ticker copy: static claims + one line per featured product with a purity.
  const tickerItems = [
    ...TICKER_CLAIMS,
    ...tickerProducts.map((p) => `${p.name} — ${p.purity} verified`),
  ];

  return (
    <>
      <section
        ref={sectionRef}
        className="relative min-h-svh flex items-center overflow-hidden bg-ink text-white"
      >
        {/* Media stack (parallax) — 8% vertical overscan so the drift never
            reveals an edge. Static under reduced motion. */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-x-0 -inset-y-[8%]"
          style={prefersReducedMotion ? undefined : { y: mediaY }}
        >
          {/* Graded fallback still — always rendered, the LCP element. */}
          <img
            src={HERO_FALLBACK_IMAGE}
            alt=""
            className="absolute inset-0 w-full h-full object-cover hero-still-grade"
          />

          {/* Background video — crossfades in once playable. */}
          {allowVideo && (
            <video
              ref={(el) => {
                videoRef.current = el;
                // React can drop `muted` from SSR markup, which blocks autoplay —
                // set it imperatively.
                if (el) el.muted = true;
              }}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
                videoReady ? 'opacity-100' : 'opacity-0'
              }`}
              src={HERO_VIDEO_URL}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              tabIndex={-1}
              onCanPlay={() => setVideoReady(true)}
            />
          )}

          {/* Film grain */}
          <div
            className="absolute inset-0 opacity-[0.07] mix-blend-soft-light"
            style={{ backgroundImage: GRAIN_TEXTURE }}
          />

          {/* Ink scrims: text side darkest, plus top (nav) + bottom (ticker). */}
          <div className="absolute inset-0 bg-gradient-to-r from-ink/95 via-ink/65 to-ink/35" />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-ink/85" />
        </motion.div>

        {/* Content */}
        <motion.div
          className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-32 sm:pt-36 pb-24 sm:pb-28"
          style={
            prefersReducedMotion ? undefined : { y: contentY, opacity: contentOpacity }
          }
        >
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left column */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-7"
            >
              {/* Eyebrow */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/20 border border-bronze/30 rounded-full mb-4 sm:mb-6">
                <Beaker className="w-3.5 h-3.5 text-bronze" />
                <span className="text-[10px] sm:text-xs font-medium text-bronze">
                  Pharmaceutical Grade Research
                </span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold mb-4 sm:mb-6 leading-[1.05] tracking-tight text-white">
                Advanced
                <br />
                Peptide Research
              </h1>

              <p className="text-base sm:text-lg text-white/70 mb-6 sm:mb-8 max-w-lg leading-relaxed">
                HPLC-verified peptides with 99%+ purity for scientific research. Each
                batch independently tested with full Certificate of Analysis.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 mb-8 sm:mb-10">
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-white/90 text-ink px-6 sm:px-7 py-3.5 sm:py-4 font-semibold text-sm rounded-xl transition-all"
                >
                  Browse Catalog
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/lab-results"
                  className="inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/15 text-white border border-white/25 backdrop-blur-sm px-6 sm:px-7 py-3.5 sm:py-4 font-medium text-sm rounded-xl transition-colors"
                >
                  View Lab Results
                </Link>
              </div>

              {/* Trust chips */}
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                {TRUST_CHIPS.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('lab-results')
                        ?.scrollIntoView({ block: 'start' })
                    }
                    aria-label={`${label} — view lab documentation`}
                    className="group inline-flex items-center gap-2 pl-2 pr-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 backdrop-blur-md transition-all hover:-translate-y-0.5"
                  >
                    <span className="w-6 h-6 rounded-full bg-bronze/20 flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5 text-bronze" />
                    </span>
                    <span className="text-[10px] sm:text-xs font-medium text-white/80 group-hover:text-white">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Right column — Featured Compound card */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="lg:col-span-5 w-full max-w-sm mx-auto lg:mx-0 lg:ml-auto"
            >
              {cardLoading ? (
                <FeaturedCardSkeleton />
              ) : product ? (
                <FeaturedCard
                  product={product}
                  currency={currency}
                  rate={rate}
                  convert={convert}
                  showPrices={showPrices}
                  onAdd={openAdd}
                />
              ) : (
                <TrustCard />
              )}
            </motion.div>
          </div>
        </motion.div>

        {/* Pause / play */}
        {allowVideo && videoReady && (
          <button
            type="button"
            onClick={toggleVideo}
            aria-label={videoPlaying ? 'Pause background video' : 'Play background video'}
            className="absolute bottom-16 right-5 sm:right-8 z-20 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center transition-colors"
          >
            {videoPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 ml-0.5" />
            )}
          </button>
        )}

        {/* Purity ticker */}
        <div
          className="absolute bottom-0 inset-x-0 z-10 border-t border-white/10 bg-ink/40 backdrop-blur-sm overflow-hidden"
          aria-hidden="true"
        >
          <div className="flex w-max whitespace-nowrap animate-ticker py-3">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span
                key={i}
                className="flex items-center text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.15em] text-white/45"
              >
                {item}
                <span className="mx-5 sm:mx-8 text-bronze/60">•</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} />
    </>
  );
}

function FeaturedCard({
  product,
  currency,
  rate,
  convert,
  showPrices,
  onAdd,
}: {
  product: FeaturedProduct;
  currency: 'CAD' | 'USD';
  /** Already the effective multiplier — 1 when this customer's prices don't convert. */
  rate: number;
  /** Whether prices convert; a catalog `price_usd` only applies when they do. */
  convert: boolean;
  showPrices: boolean;
  onAdd: (p: FeaturedProduct) => void;
}) {
  const perBox = product.vials_per_box || 10;
  // Single-vial CAD price: explicit vial_price, else the box price split per vial.
  const vialCad =
    product.vial_price != null && product.vial_price > 0
      ? product.vial_price
      : product.price / perBox;
  const vialDisplay = currency === 'USD' ? vialCad * rate : vialCad;
  // The "pack" line uses the real box price this catalog stores.
  const packDisplay =
    currency === 'USD' ? productUsdPrice(product, rate, convert) : product.price;
  const href = product.slug ? `/products/${product.slug}` : '/products';
  // Opted-in products lead with the box / packaging image; everything else
  // shows the vial shot. Falls back to the vial when no box image is set.
  const cardImage =
    product.box_image_first && product.box_image_url
      ? product.box_image_url
      : product.image_url;

  return (
    <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-bronze/20 border border-bronze/30 rounded-full text-[10px] font-medium text-bronze">
          <Beaker className="w-3 h-3" />
          Featured Compound
        </span>
        {product.purity && product.purity.trim() && (
          <span className="text-[10px] font-semibold text-bronze-light bg-bronze/15 border border-bronze/30 px-2 py-0.5 rounded-full">
            {product.purity}
          </span>
        )}
      </div>

      <Link href={href} className="group block">
        {/* Image plate */}
        <div className="relative bg-white/95 rounded-xl aspect-[4/3] p-4 mb-4 overflow-hidden">
          {cardImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cardImage}
              alt={product.name}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Beaker className="w-12 h-12 text-line" />
            </div>
          )}
        </div>

        <h3 className="font-semibold text-white group-hover:text-white/80 line-clamp-1 transition-colors">
          {product.name}
        </h3>
        {product.strength && (
          <p className="text-xs text-white/50 mt-0.5">{product.strength}</p>
        )}
      </Link>

      {/* Price + Add */}
      {product.price > 0 ? (
        <div className="flex items-end justify-between gap-2 mt-3">
          {showPrices ? (
            <div>
              <div>
                <span className="text-xl font-bold text-white tabular-nums">
                  ${vialDisplay.toFixed(2)}
                </span>
                {currency === 'USD' && (
                  <span className="text-[10px] font-medium text-white/50 ml-0.5">USD</span>
                )}
                <span className="text-[10px] font-medium text-white/50"> / vial</span>
              </div>
              <div className="text-[10px] text-white/50 tabular-nums mt-0.5">
                Pack of {perBox} · ${packDisplay.toFixed(2)}
              </div>
            </div>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => onAdd(product)}
            aria-label={`Add ${product.name} to cart`}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-bronze hover:bg-bronze-light text-ink text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      ) : showPrices ? (
        <div className="mt-3">
          <span className="text-lg font-bold text-white/50">N/A</span>
        </div>
      ) : null}

      {/* Footer */}
      <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-white/10 text-[10px] text-white/40">
        <FileCheck className="w-3 h-3 text-bronze" />
        COA verified — PPB Analytical Inc.
      </div>
    </div>
  );
}

function FeaturedCardSkeleton() {
  return (
    <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-4 sm:p-5 animate-pulse">
      <div className="h-5 w-36 bg-white/10 rounded-full mb-4" />
      <div className="aspect-[4/3] bg-white/10 rounded-xl mb-4" />
      <div className="h-4 w-3/4 bg-white/10 rounded mb-2" />
      <div className="h-3 w-1/3 bg-white/10 rounded mb-4" />
      <div className="h-9 bg-white/10 rounded-lg" />
    </div>
  );
}

// Shown when the fetch fails or nothing is featured — never fake product data.
function TrustCard() {
  const rows = [
    { icon: Award, title: '99%+ Purity', sub: 'HPLC-UV verified on every batch' },
    { icon: FileCheck, title: 'COA on Every Order', sub: 'Published third-party lab reports' },
    { icon: MapPin, title: 'Canadian Supplier', sub: 'Sourced and shipped from Canada' },
  ] as const;

  return (
    <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-5 sm:p-6 space-y-5">
      {rows.map(({ icon: Icon, title, sub }) => (
        <div key={title} className="flex items-center gap-4">
          <div className="w-11 h-11 bg-bronze/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-bronze" />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">{title}</p>
            <p className="text-xs text-white/50">{sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
