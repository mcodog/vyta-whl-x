'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FlaskConical,
  FileText,
  Search,
  ShieldCheck,
  Calendar,
  Beaker,
  Hash,
  ExternalLink,
  BadgeCheck,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import FadeInImage from '@/components/FadeInImage';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { useCountUp } from '@/lib/hooks/useCountUp';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';

interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

interface LabResult {
  id: string;
  report_url: string;
  product_name: string;
  lab: string;
  sample_id: string | null;
  compound: string | null;
  cas_number: string | null;
  purity_pct: number | null;
  method: string;
  matrix: string | null;
  receiving_date: string | null;
  registration_date: string | null;
  report_date: string | null;
  products: CoveredProduct[];
}

// Parse a plain yyyy-mm-dd (no timezone shift) into a friendly label.
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Blends store several compounds as a "; " separated string. Split into the
// individual compound names so they can be filtered on individually.
function parseCompounds(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
}

function purityTone(pct: number | null): string {
  if (pct == null) return 'text-ink';
  if (pct >= 99) return 'text-emerald-600';
  if (pct >= 97) return 'text-vital-dark';
  return 'text-amber-600';
}

export default function LabResultsPage() {
  const [query, setQuery] = useState('');
  const [selectedCompound, setSelectedCompound] = useState<string | null>(null);

  const { data, loading, slow, error, reload } = useSmartLoad<LabResult[]>(async () => {
    const res = await fetch('/api/lab-results');
    if (!res.ok) throw new Error(`Failed to load lab results (${res.status})`);
    const { labResults } = await res.json();
    return labResults || [];
  }, []);

  const results = useMemo(() => data ?? [], [data]);

  // Unique individual compounds across all reports (blends contribute each of
  // their parts), for the compound filter pills. Sorted with a per-compound
  // report count.
  const compoundOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      for (const c of parseCompounds(r.compound)) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  const filtered = useMemo(() => {
    let list = results;

    if (selectedCompound) {
      list = list.filter((r) => parseCompounds(r.compound).includes(selectedCompound));
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (r) =>
          r.product_name?.toLowerCase().includes(q) ||
          r.compound?.toLowerCase().includes(q) ||
          r.sample_id?.toLowerCase().includes(q) ||
          r.products.some((p) => p.name.toLowerCase().includes(q))
      );
    }

    return list;
  }, [results, query, selectedCompound]);

  // Headline stats across all reports.
  const stats = useMemo(() => {
    const count = results.length;
    const purities = results.map((r) => r.purity_pct).filter((p): p is number => p != null);
    const avg = purities.length
      ? purities.reduce((a, b) => a + b, 0) / purities.length
      : null;
    const productCount = new Set(
      results.flatMap((r) => r.products.map((p) => p.id))
    ).size;
    return { count, avg, productCount };
  }, [results]);

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero */}
      <section className="relative bg-white border-b border-line overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="lab-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="#07203A" />
                <circle cx="0" cy="0" r="1" fill="#07203A" />
                <circle cx="60" cy="60" r="1" fill="#07203A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#lab-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-32 sm:pt-44 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-vital/10 border border-vital/20 rounded-full mb-4">
              <FlaskConical className="w-3.5 h-3.5 text-vital" />
              <span className="text-xs font-medium text-vital">Third-Party Verified</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight text-ink">
              Lab Results
            </h1>
            <p className="text-base sm:text-lg text-ink-muted max-w-xl mx-auto">
              Independent HPLC-UV certificates of analysis for every batch. Full
              reports, nothing hidden.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-10 grid grid-cols-3 gap-3 sm:gap-6 max-w-2xl mx-auto"
          >
            {loading ? (
              <>
                <StatSkeleton label="Reports" />
                <StatSkeleton label="Avg. Purity" />
                <StatSkeleton label="Products Covered" />
              </>
            ) : (
              <>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-ink tabular-nums">
                    <CountUp value={stats.count} />
                  </div>
                  <div className="text-xs sm:text-sm text-ink-muted">Reports</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-vital tabular-nums">
                    {stats.avg != null ? (
                      <CountUp value={stats.avg} decimals={1} suffix="%" />
                    ) : (
                      '—'
                    )}
                  </div>
                  <div className="text-xs sm:text-sm text-ink-muted">Avg. Purity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-bold text-ink tabular-nums">
                    <CountUp value={stats.productCount} />
                  </div>
                  <div className="text-xs sm:text-sm text-ink-muted">Products Covered</div>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </section>

      {/* Content */}
      <section className="py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          {/* Search */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between mb-8">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
              <input
                type="text"
                placeholder="Search by product, compound, or sample ID…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
              />
            </div>
            {!loading && !error && (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="font-semibold text-ink tabular-nums">{filtered.length}</span>
                <span>report{filtered.length === 1 ? '' : 's'}</span>
              </div>
            )}
          </div>

          {/* Compound filter — each blend contributes its individual compounds */}
          {!loading && !error && compoundOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-8">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted mr-1">
                <Beaker className="w-3.5 h-3.5 text-vital" />
                Compound
              </span>
              <button
                onClick={() => setSelectedCompound(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  selectedCompound === null
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-muted border-line hover:text-ink hover:border-ink/20'
                }`}
              >
                All
              </button>
              {compoundOptions.map((c) => {
                const active = selectedCompound === c.name;
                return (
                  <button
                    key={c.name}
                    onClick={() => setSelectedCompound(active ? null : c.name)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      active
                        ? 'bg-ink text-white border-ink'
                        : 'bg-white text-ink-muted border-line hover:text-ink hover:border-ink/20'
                    }`}
                  >
                    {c.name}
                    <span className={`tabular-nums ${active ? 'text-white/70' : 'text-ink-muted'}`}>
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error ? (
            <LoadingError onRetry={reload} />
          ) : loading ? (
            <div>
              {slow && <SlowLoadingNotice onReload={reload} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-line overflow-hidden animate-pulse"
                  >
                    <div className="h-48 bg-surface" />
                    <div className="p-6 space-y-4">
                      <div className="h-5 bg-surface rounded w-2/3" />
                      <div className="grid grid-cols-2 gap-4">
                        {[...Array(4)].map((_, j) => (
                          <div key={j} className="h-9 bg-surface rounded" />
                        ))}
                      </div>
                      <div className="flex justify-between pt-2">
                        <div className="h-4 bg-surface rounded w-1/4" />
                        <div className="h-9 bg-surface rounded w-1/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 sm:py-20">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
                <FlaskConical className="w-8 h-8 text-ink-muted" />
              </div>
              <h3 className="text-lg font-semibold text-ink mb-2">No reports found</h3>
              <p className="text-ink-muted">Try a different search term.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {filtered.map((r, index) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.04 }}
                  className="group flex flex-col bg-white rounded-2xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all"
                >
                  {/* Media band — product image with lab + purity overlays */}
                  {(() => {
                    const primary = r.products[0];
                    const img = primary?.box_image_url ?? primary?.image_url ?? null;
                    const media = (
                      <div className="relative bg-surface h-48 flex items-center justify-center overflow-hidden">
                        {img ? (
                          <FadeInImage
                            src={img}
                            alt={primary?.name ?? r.product_name}
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <Beaker className="w-12 h-12 text-line" />
                        )}
                        {/* Lab badge */}
                        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink bg-white/90 backdrop-blur px-2.5 py-1 rounded-full border border-line shadow-sm">
                          <ShieldCheck className="w-3.5 h-3.5 text-vital" />
                          {r.lab}
                        </div>
                        {/* Purity badge — some COAs (e.g. HCG) are
                            identity-only and report no purity percentage. Say
                            what the certificate IS rather than showing a bare
                            "—", which reads as a broken value. */}
                        {r.purity_pct != null ? (
                          <div className="absolute top-3 right-3 text-right bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-line shadow-sm">
                            <div className={`text-xl font-bold tabular-nums leading-none ${purityTone(r.purity_pct)}`}>
                              {`${r.purity_pct}%`}
                            </div>
                            <div className="text-[9px] uppercase tracking-wider text-ink-muted mt-0.5">
                              UV Purity
                            </div>
                          </div>
                        ) : (
                          <div
                            title="This certificate confirms identity against a reference standard; it does not report a purity percentage."
                            className="absolute top-3 right-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink bg-white/90 backdrop-blur px-2.5 py-1.5 rounded-xl border border-line shadow-sm"
                          >
                            <BadgeCheck className="w-3.5 h-3.5 text-vital" />
                            Identity verified
                          </div>
                        )}
                      </div>
                    );
                    return primary?.slug ? (
                      <Link href={`/products/${primary.slug}`} className="block">
                        {media}
                      </Link>
                    ) : (
                      media
                    );
                  })()}

                  {/* Title */}
                  <div className="p-6 pb-4 border-b border-line">
                    <h3 className="text-lg font-bold text-ink leading-tight truncate">
                      {r.product_name}
                    </h3>
                    {r.compound && (
                      <p className="text-sm text-ink-muted mt-1 truncate" title={r.compound}>
                        {r.compound}
                      </p>
                    )}
                  </div>

                  {/* Meta grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-6">
                    <Meta icon={Beaker} label="Method" value={r.method} />
                    <Meta icon={Hash} label="Sample ID" value={r.sample_id ?? '—'} mono />
                    <Meta
                      icon={Calendar}
                      label="Result Date"
                      value={formatDate(r.report_date)}
                    />
                    <Meta
                      icon={BadgeCheck}
                      label="CAS No."
                      value={r.cas_number ?? '—'}
                      mono
                    />
                  </div>

                  {/* Covered products */}
                  {r.products.length > 0 && (
                    <div className="px-6 pb-5">
                      <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-2">
                        Applies to
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {r.products.map((p) =>
                          p.slug ? (
                            <Link
                              key={p.id}
                              href={`/products/${p.slug}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-ink bg-surface hover:bg-vital-50 hover:text-vital-dark px-2.5 py-1.5 rounded-lg border border-line transition-all"
                            >
                              {p.name}
                              <ChevronRight className="w-3 h-3" />
                            </Link>
                          ) : (
                            <span
                              key={p.id}
                              className="inline-flex items-center text-xs font-medium text-ink-muted bg-surface px-2.5 py-1.5 rounded-lg border border-line"
                            >
                              {p.name}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Footer / CTA */}
                  <div className="mt-auto p-6 pt-4 border-t border-line flex items-center justify-between gap-4">
                    {/* Omitted entirely when the COA states no receiving date —
                        "Received —" reads as a rendering fault. The empty span
                        keeps justify-between pushing the button right. */}
                    {r.receiving_date ? (
                      <span className="text-[11px] text-ink-muted">
                        Received {formatDate(r.receiving_date)}
                      </span>
                    ) : (
                      <span />
                    )}
                    <a
                      href={r.report_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink hover:bg-ink/90 text-white text-xs font-semibold rounded-lg transition-all"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      View full report
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trust strip */}
      <section className="py-12 sm:py-16 bg-surface">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="bg-ink rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <FlaskConical className="w-5 h-5 text-vital" />
              </div>
              <div>
                <p className="text-white font-semibold">Independently tested by accredited labs</p>
                <p className="text-white/60 text-sm">
                  Every certificate links straight to the unedited source report.
                </p>
              </div>
            </div>
            <Link
              href="/products"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-white text-ink text-sm font-semibold rounded-lg hover:bg-white/90 transition-all whitespace-nowrap"
            >
              Browse products
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

// Animated number that counts up from 0 to `value`, decelerating as it lands.
function CountUp({
  value,
  decimals = 0,
  suffix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const animated = useCountUp(value);
  return (
    <>
      {animated.toFixed(decimals)}
      {suffix}
    </>
  );
}

// Placeholder shown while the headline stats are still loading.
function StatSkeleton({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-1 h-8 sm:h-9 w-16 sm:w-20 rounded-lg bg-surface animate-pulse" />
      <div className="text-xs sm:text-sm text-ink-muted">{label}</div>
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-ink-muted mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</p>
        <p className={`text-sm text-ink font-medium truncate ${mono ? 'tabular-nums' : ''}`} title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}
