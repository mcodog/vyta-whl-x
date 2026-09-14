'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Boxes, TrendingUp, DollarSign, ClipboardList, AlertTriangle, Loader2,
  RefreshCw, FileText, Calendar, Users, Briefcase, UserPlus, Package,
  BarChart3, PieChart, Trophy, Search, Receipt, X, ExternalLink, Download,
  SlidersHorizontal, Truck,
} from 'lucide-react';
import { getAnalyticsSummary } from '@/lib/admin/analytics';
import { supabase } from '@/lib/supabase';
import type {
  AnalyticsSummary, PerformanceEntry, ProductPerformanceEntry, RevenueInvoice,
  InvoiceCurrency, ShippingEarnings,
} from '@/lib/supabase';
import { PO_STATUS_META } from '@/lib/admin/po-status';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';

const fmtCurrency = (n: number, currency: 'CAD' | 'USD' = 'CAD') =>
  new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n);

// Compact currency for chart labels ($1.2k).
const fmtCompact = (n: number) =>
  '$' + new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

// 'YYYY-MM' → short month name, for the shipping trend axis.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string): string => MONTH_NAMES[Number(key.split('-')[1]) - 1] ?? key;

// Toggleable sections on the downloadable Analytics Report. Keys mirror the
// `sections` param understood by /api/admin/analytics/report.
type ReportSectionKey = 'overview' | 'revenue' | 'shipping' | 'invoices' | 'operations';
const REPORT_SECTIONS: { key: ReportSectionKey; label: string; desc: string }[] = [
  { key: 'overview', label: 'Overview KPIs', desc: 'Inventory value, incoming POs, revenue paid, outstanding.' },
  { key: 'revenue', label: 'Revenue breakdown', desc: 'Invoiced / paid / outstanding and the CAD vs USD split.' },
  { key: 'shipping', label: 'Shipping earnings', desc: 'Shipping billed and collected, by currency and by month.' },
  { key: 'invoices', label: 'Invoice audit list', desc: 'Every invoice in the range, with per-currency totals.' },
  { key: 'operations', label: 'Inventory & Performance', desc: 'Inventory snapshot, open POs, and the top products / customers / sales people / affiliates.' },
];
const REPORT_CONFIG_KEY = 'aminocan.analyticsReport.config';
const allSectionsSelected = (v: boolean): Record<ReportSectionKey, boolean> =>
  Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, v])) as Record<ReportSectionKey, boolean>;

// Fallback when a summary payload predates the shipping block (see below).
const EMPTY_SHIPPING: ShippingEarnings = {
  charged: 0,
  collected: 0,
  uncollected: 0,
  invoice_count: 0,
  avg_per_invoice: 0,
  share_of_invoiced: 0,
  by_currency: {
    CAD: { charged: 0, collected: 0, uncollected: 0, invoice_count: 0 },
    USD: { charged: 0, collected: 0, uncollected: 0, invoice_count: 0 },
  },
  monthly: [],
};

// Section anchors for the mini-navigation.
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'inventory', label: 'Inventory & Supply', icon: Boxes },
  { id: 'performance', label: 'Performance', icon: Trophy },
] as const;

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string>('overview');

  // ---- Downloadable, customizable Analytics Report ----
  const [showReportModal, setShowReportModal] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [reportSections, setReportSections] = useState<Record<ReportSectionKey, boolean>>(allSectionsSelected(true));
  const [reportDrafts, setReportDrafts] = useState(true);
  const reportConfigLoaded = useRef(false);

  // Load saved report customization once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REPORT_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sections) setReportSections((prev) => ({ ...prev, ...parsed.sections }));
        if (typeof parsed?.drafts === 'boolean') setReportDrafts(parsed.drafts);
      }
    } catch { /* ignore malformed config */ }
    reportConfigLoaded.current = true;
  }, []);

  // Persist choices after the initial load.
  useEffect(() => {
    if (!reportConfigLoaded.current) return;
    try {
      localStorage.setItem(REPORT_CONFIG_KEY, JSON.stringify({ sections: reportSections, drafts: reportDrafts }));
    } catch { /* storage full / unavailable */ }
  }, [reportSections, reportDrafts]);

  const selectedSectionCount = REPORT_SECTIONS.filter((s) => reportSections[s.key]).length;

  // Open the printable report in a new tab, scoped to the current date range.
  const downloadReport = useCallback(async () => {
    setDownloadingReport(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('sections', REPORT_SECTIONS.filter((s) => reportSections[s.key]).map((s) => s.key).join(','));
      params.set('drafts', reportDrafts ? '1' : '0');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/analytics/report?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) { alert('Could not generate report'); return; }
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } finally {
      setDownloadingReport(false);
    }
  }, [from, to, reportSections, reportDrafts]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const s = await getAnalyticsSummary({ from: from || null, to: to || null });
    setSummary(s);
    setLoading(false);
    setRefreshing(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const unpaidInvoiceCount = useMemo(() => {
    if (!summary) return 0;
    return summary.revenue.invoice_count - summary.revenue.paid_invoice_count;
  }, [summary]);

  // Scrollspy: highlight the mini-nav entry for the section currently in view.
  useEffect(() => {
    if (loading || !summary) return;
    const els = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-25% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading, summary]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted text-sm">Could not load analytics.</p>
        <button
          onClick={load}
          className="mt-3 inline-flex items-center gap-2 text-bronze hover:text-bronze-dark text-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      </div>
    );
  }

  const { inventory, incoming, revenue, performance } = summary;
  // `shipping` post-dates the first release of this page; a cached/older summary
  // payload can arrive without it, so fall back to an empty block.
  const shipping = summary.shipping ?? EMPTY_SHIPPING;
  const isOutstanding = revenue.outstanding > 0;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-bronze" /> Analytics
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Revenue, inventory, and who&apos;s driving the numbers — at a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <DateField label="From" value={from} onChange={setFrom} />
          <DateField label="To" value={to} onChange={setTo} />
          {(from || to) && (
            <button
              onClick={() => { setFrom(''); setTo(''); }}
              className="text-xs text-ink-muted hover:text-ink px-2 py-1"
            >
              Clear
            </button>
          )}
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {/* Download Report + a customize control that opens the config modal. */}
          <div className="inline-flex rounded-lg border border-line bg-white overflow-hidden">
            <button
              onClick={downloadReport}
              disabled={downloadingReport}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-ink hover:bg-surface transition-all font-medium text-sm disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {downloadingReport ? 'Generating…' : 'Download Report'}
            </button>
            <button
              onClick={() => setShowReportModal(true)}
              title="Customize report — choose sections"
              aria-label="Customize report"
              className="inline-flex items-center justify-center px-3 border-l border-line text-ink-muted hover:bg-surface hover:text-ink transition-all"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Customize Analytics Report modal — pick which sections to include */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 my-8">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-bronze" /> Customize Report
              </h2>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              Tick the sections to include in the downloaded Analytics Report. It
              covers the current date range{(from || to) ? '' : ' (all time)'}.
              Your choices are remembered for next time.
            </p>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">Report sections</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setReportSections(allSectionsSelected(true))}
                      className="text-bronze hover:underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportSections(allSectionsSelected(false))}
                      className="text-ink-muted hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {REPORT_SECTIONS.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={reportSections[s.key]}
                        onChange={(e) =>
                          setReportSections((prev) => ({ ...prev, [s.key]: e.target.checked }))
                        }
                        className="mt-0.5 w-4 h-4 rounded border-line text-bronze focus:ring-bronze/40"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{s.label}</span>
                        <span className="block text-xs text-ink-muted">{s.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {selectedSectionCount === 0 && (
                  <p className="mt-2 text-xs text-red-600">Select at least one section to download.</p>
                )}
              </div>

              {/* Invoice list options */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Invoice list</h3>
                <p className="text-xs text-ink-muted mb-2">
                  Applies when the Invoice audit list is included.
                </p>
                <label
                  className={`flex items-center gap-2 p-2.5 rounded-lg border border-line transition-colors ${
                    reportSections.invoices ? 'hover:bg-surface cursor-pointer' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={reportDrafts}
                    disabled={!reportSections.invoices}
                    onChange={(e) => setReportDrafts(e.target.checked)}
                    className="w-4 h-4 rounded border-line text-bronze focus:ring-bronze/40"
                  />
                  <span className="text-sm text-ink">
                    Include draft invoices
                    <span className="text-ink-muted"> (not counted in revenue totals)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-6 mt-6 border-t border-line">
              <button
                type="button"
                onClick={() => { setReportSections(allSectionsSelected(true)); setReportDrafts(true); }}
                className="text-sm text-ink-muted hover:text-ink transition-colors"
              >
                Reset to defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowReportModal(false); downloadReport(); }}
                  disabled={downloadingReport || selectedSectionCount === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  Download Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky mini-navigation */}
      <div className="sticky top-0 z-10 -mx-4 sm:mx-0 mb-6 bg-surface/80 backdrop-blur-sm">
        <nav className="flex items-center gap-1 overflow-x-auto px-4 sm:px-0 py-2 border-b border-line">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-bronze/10 text-bronze'
                    : 'text-ink-muted hover:text-ink hover:bg-white'
                }`}
              >
                <Icon className="w-4 h-4" /> {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ============================= OVERVIEW ============================= */}
      <Section id="overview" title="Overview" icon={BarChart3}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Inventory On Hand"
            value={fmtCurrency(inventory.value)}
            sub={`${inventory.units.toLocaleString()} units · ${inventory.sku_count} SKUs`}
            icon={Boxes}
            tint="emerald"
          />
          <KpiCard
            label="Incoming (Open POs)"
            value={fmtCurrency(incoming.value)}
            sub={`${incoming.units.toLocaleString()} units · ${incoming.po_count} POs`}
            icon={ClipboardList}
            tint="blue"
          />
          <KpiCard
            label="Revenue Paid"
            value={fmtCurrency(revenue.paid)}
            sub={`${revenue.paid_invoice_count} paid invoice${revenue.paid_invoice_count !== 1 ? 's' : ''}`}
            icon={DollarSign}
            tint="bronze"
          />
          <KpiCard
            label="Outstanding"
            value={fmtCurrency(revenue.outstanding)}
            sub={`${unpaidInvoiceCount} invoice${unpaidInvoiceCount !== 1 ? 's' : ''} unpaid`}
            icon={TrendingUp}
            tint={isOutstanding ? 'amber' : 'neutral'}
          />
        </div>
      </Section>

      {/* ============================= REVENUE ============================= */}
      <Section id="revenue" title="Revenue" icon={DollarSign}>
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Paid vs outstanding donut */}
          <Card title="Collection" icon={PieChart} tint="bronze">
            <div className="flex items-center gap-5">
              <Donut
                segments={[
                  { label: 'Paid', value: revenue.paid, color: '#047857' },
                  { label: 'Outstanding', value: revenue.outstanding, color: '#B45309' },
                ]}
                centerLabel={pctPaid(revenue.paid, revenue.invoiced)}
                centerSub="collected"
              />
              <div className="space-y-2.5 flex-1 min-w-0">
                <LegendRow color="#047857" label="Paid" value={fmtCurrency(revenue.paid)} />
                <LegendRow color="#B45309" label="Outstanding" value={fmtCurrency(revenue.outstanding)} />
                <div className="pt-2 border-t border-line flex items-center justify-between text-sm">
                  <span className="text-ink-muted">Invoiced</span>
                  <span className="font-semibold tabular-nums text-ink">{fmtCurrency(revenue.invoiced)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Revenue detail */}
          <DetailCard
            title="Revenue"
            icon={DollarSign}
            tint="bronze"
            rows={[
              { label: 'Invoiced', value: fmtCurrency(revenue.invoiced) },
              { label: 'Paid', value: fmtCurrency(revenue.paid), accent: 'emerald' },
              {
                label: 'Outstanding',
                value: fmtCurrency(revenue.outstanding),
                accent: isOutstanding ? 'amber' : undefined,
              },
              {
                label: 'Paid / total',
                value: `${revenue.paid_invoice_count} / ${revenue.invoice_count}`,
              },
            ]}
            link={{ href: '/admin/invoices', label: 'View invoices →' }}
          />

          {/* Currency split (CAD/USD tracked separately, never converted) */}
          <Card title="By Currency" icon={DollarSign} tint="bronze">
            <div className="space-y-4">
              {(['CAD', 'USD'] as const).map((cur) => {
                const c = revenue.by_currency[cur];
                const curOutstanding = c.outstanding > 0;
                return (
                  <div key={cur}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-ink uppercase tracking-wider">{cur}</span>
                      <span className="text-xs text-ink-muted tabular-nums">
                        {c.paid_invoice_count}/{c.invoice_count} paid
                      </span>
                    </div>
                    <StackBar
                      paid={c.paid}
                      outstanding={c.outstanding}
                    />
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <span className="text-emerald-700 tabular-nums">{fmtCurrency(c.paid, cur)}</span>
                      <span className={`tabular-nums ${curOutstanding ? 'text-amber-700' : 'text-ink-muted'}`}>
                        {fmtCurrency(c.outstanding, cur)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Audit list — exactly the invoices feeding the figures above. */}
        <RevenueInvoicesTable
          invoices={revenue.invoices}
          hasRange={!!(revenue.range.from || revenue.range.to)}
        />
      </Section>

      {/* ============================= SHIPPING ============================= */}
      <Section id="shipping" title="Shipping" icon={Truck}>
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Collected vs still owed on the shipping line */}
          <Card title="Shipping Collection" icon={PieChart} tint="bronze">
            {shipping.charged > 0 ? (
              <div className="flex items-center gap-5">
                <Donut
                  segments={[
                    { label: 'Collected', value: shipping.collected, color: '#047857' },
                    { label: 'Uncollected', value: shipping.uncollected, color: '#B45309' },
                  ]}
                  centerLabel={pctPaid(shipping.collected, shipping.charged)}
                  centerSub="collected"
                />
                <div className="space-y-2.5 flex-1 min-w-0">
                  <LegendRow color="#047857" label="Collected" value={fmtCurrency(shipping.collected)} />
                  <LegendRow color="#B45309" label="Uncollected" value={fmtCurrency(shipping.uncollected)} />
                  <div className="pt-2 border-t border-line flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Billed</span>
                    <span className="font-semibold tabular-nums text-ink">{fmtCurrency(shipping.charged)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted py-6 text-center">
                No shipping billed in this range.
              </p>
            )}
          </Card>

          {/* Shipping detail */}
          <DetailCard
            title="Shipping Earnings"
            icon={Truck}
            tint="bronze"
            rows={[
              { label: 'Billed', value: fmtCurrency(shipping.charged) },
              { label: 'Collected', value: fmtCurrency(shipping.collected), accent: 'emerald' },
              {
                label: 'Uncollected',
                value: fmtCurrency(shipping.uncollected),
                accent: shipping.uncollected > 0 ? 'amber' : undefined,
              },
              {
                label: 'Invoices with shipping',
                value: `${shipping.invoice_count} / ${revenue.invoice_count}`,
              },
              { label: 'Average per invoice', value: fmtCurrency(shipping.avg_per_invoice) },
              {
                label: 'Share of invoiced revenue',
                value: shipping.share_of_invoiced > 0 ? `${shipping.share_of_invoiced.toFixed(1)}%` : '—',
              },
            ]}
            link={{ href: '/admin/invoices', label: 'View invoices →' }}
          />

          {/* Currency split (CAD/USD tracked separately, never converted) */}
          <Card title="By Currency" icon={DollarSign} tint="bronze">
            <div className="space-y-4">
              {(['CAD', 'USD'] as const).map((cur) => {
                const c = shipping.by_currency[cur];
                return (
                  <div key={cur}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-ink uppercase tracking-wider">{cur}</span>
                      <span className="text-xs text-ink-muted tabular-nums">
                        {c.invoice_count} invoice{c.invoice_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <StackBar paid={c.collected} outstanding={c.uncollected} />
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <span className="text-emerald-700 tabular-nums">{fmtCurrency(c.collected, cur)}</span>
                      <span className={`tabular-nums ${c.uncollected > 0 ? 'text-amber-700' : 'text-ink-muted'}`}>
                        {fmtCurrency(c.uncollected, cur)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Month-by-month shipping billed vs collected */}
        <div className="mt-6">
          <Card title="Shipping by Month" icon={BarChart3} tint="bronze">
            <ShippingMonthlyBars rows={shipping.monthly} />
          </Card>
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          Shipping figures are what we <strong>bill</strong> on invoices — the live carrier rate plus the
          handling fee, which is where the margin sits. What the courier actually charged is not stored
          against the order, so this is gross shipping revenue, not net of carrier cost. Collected is
          pro-rated: a half-paid invoice counts half its shipping.
        </p>
      </Section>

      {/* ======================= INVENTORY & SUPPLY ======================= */}
      <Section id="inventory" title="Inventory & Supply" icon={Boxes}>
        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <DetailCard
            title="Inventory Snapshot"
            icon={Boxes}
            tint="emerald"
            rows={[
              { label: 'Total units', value: inventory.units.toLocaleString() },
              { label: 'Total value', value: fmtCurrency(inventory.value) },
              { label: 'SKUs tracked', value: inventory.sku_count.toString() },
              {
                label: 'Low stock SKUs',
                value: inventory.low_stock_count.toString(),
                icon: inventory.low_stock_count > 0 ? AlertTriangle : undefined,
                accent: inventory.low_stock_count > 0 ? 'amber' : undefined,
              },
            ]}
            link={{ href: '/admin/products', label: 'View inventory →' }}
          />
          <DetailCard
            title="Incoming Stock"
            icon={ClipboardList}
            tint="blue"
            rows={[
              { label: 'Open POs', value: incoming.po_count.toString() },
              { label: 'Incoming units', value: incoming.units.toLocaleString() },
              { label: 'Incoming value', value: fmtCurrency(incoming.value) },
            ]}
            link={{ href: '/admin/purchase-orders', label: 'View POs →' }}
          />
        </div>

        {/* Open Purchase Orders detail */}
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-bronze" />
            <h3 className="text-sm font-semibold text-ink">Open Purchase Orders</h3>
          </div>
          {incoming.pos.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              No open purchase orders. Inventory replenishment is up to date.
            </div>
          ) : (
            <>
            {/* Desktop table (≥lg) / mobile cards below — ADR 0007. */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface">
                  <tr>
                    {['PO #', 'Supplier', 'Status', 'Expected', 'Total'].map((h) => (
                      <th key={h} className={`px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider ${h === 'Total' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {incoming.pos.map((po) => {
                    const meta = PO_STATUS_META[po.status];
                    return (
                      <tr key={po.id} className="hover:bg-surface transition-colors">
                        <td className="px-5 py-3">
                          <Link
                            href={`/admin/purchase-orders/${po.id}`}
                            className="font-mono text-ink hover:text-bronze inline-flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" /> {po.po_number}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-ink">{po.supplier_name ?? '—'}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-ink-muted">{fmtDate(po.expected_date)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums">
                          {fmtCurrency(po.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards (below lg) */}
            <ul className="lg:hidden divide-y divide-line/50">
              {incoming.pos.map((po) => {
                const meta = PO_STATUS_META[po.status];
                return (
                  <li key={po.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/admin/purchase-orders/${po.id}`} className="font-mono text-sm text-ink hover:text-bronze inline-flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" /> {po.po_number}
                      </Link>
                      <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                    </div>
                    <div className="mt-1 text-sm text-ink">{po.supplier_name ?? '—'}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                      <span>Expected <span className="text-ink">{fmtDate(po.expected_date)}</span></span>
                      <span>Total <span className="text-ink font-semibold tabular-nums">{fmtCurrency(po.total)}</span></span>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>
      </Section>

      {/* =========================== PERFORMANCE =========================== */}
      <Section id="performance" title="Performance" icon={Trophy}>
        <p className="text-sm text-ink-muted -mt-2 mb-4">
          Top performers over{' '}
          {revenue.range.from || revenue.range.to
            ? 'the selected range'
            : 'all time'}
          . Revenue combines CAD and USD at nominal value.
        </p>

        {/* Top-selling products bar chart */}
        <Card title="Top-Selling Products" icon={Package} tint="emerald" className="mb-6">
          <ProductBars products={performance.top_products} />
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          <Leaderboard
            title="Top Customers"
            icon={Users}
            tint="bronze"
            entries={performance.top_customers}
            emptyLabel="No customer revenue yet."
            metric={(e) => `${e.invoice_count} inv.`}
            link={{ href: '/admin/customers', label: 'All customers →' }}
          />
          <Leaderboard
            title="Top Sales People"
            icon={Briefcase}
            tint="blue"
            entries={performance.top_sales_persons}
            emptyLabel="No sales attributed yet."
            metric={(e) => e.commission ? `${fmtCurrency(e.commission)} comm.` : `${e.invoice_count} inv.`}
            link={{ href: '/admin/sales-people', label: 'All sales people →' }}
          />
          <Leaderboard
            title="Top Affiliates"
            icon={UserPlus}
            tint="emerald"
            entries={performance.top_affiliates}
            emptyLabel="No affiliate revenue yet."
            metric={(e) => `${e.invoice_count} inv.`}
            link={{ href: '/admin/affiliates', label: 'All affiliates →' }}
          />
        </div>
      </Section>
    </>
  );
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function pctPaid(paid: number, invoiced: number): string {
  if (invoiced <= 0) return '—';
  return `${Math.round((paid / invoiced) * 100)}%`;
}

// -------------------------------------------------------------------------
// Layout sub-components
// -------------------------------------------------------------------------
function Section({
  id, title, icon: Icon, children,
}: {
  id: string; title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 mb-10">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-bronze" />
        <h2 className="text-sm font-bold text-ink uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </section>
  );
}

type Tint = 'emerald' | 'blue' | 'bronze' | 'amber' | 'neutral';

const TINTS: Record<Tint, { fg: string; bg: string }> = {
  emerald: { fg: 'text-emerald-700', bg: 'bg-emerald-100' },
  blue:    { fg: 'text-blue-700',    bg: 'bg-blue-100' },
  bronze:  { fg: 'text-bronze',      bg: 'bg-bronze/10' },
  amber:   { fg: 'text-amber-700',   bg: 'bg-amber-100' },
  neutral: { fg: 'text-ink',         bg: 'bg-surface' },
};

function Card({
  title, icon: Icon, tint, className = '', children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
  className?: string;
  children: React.ReactNode;
}) {
  const { fg, bg } = TINTS[tint];
  return (
    <div className={`bg-white rounded-xl border border-line overflow-hidden flex flex-col ${className}`}>
      <div className="p-5 border-b border-line flex items-center gap-2">
        <div className={`w-7 h-7 rounded-lg ${bg} ${fg} flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="p-5 flex-1">{children}</div>
    </div>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, tint,
}: {
  label: string; value: string; sub: string;
  icon: React.ComponentType<{ className?: string }>; tint: Tint;
}) {
  const { fg, bg } = TINTS[tint];
  return (
    <div className="bg-white rounded-xl border border-line p-5">
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{label}</div>
        <div className={`w-9 h-9 rounded-lg ${bg} ${fg} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`mt-3 text-2xl font-bold tabular-nums ${tint === 'neutral' ? 'text-ink' : fg}`}>
        {value}
      </div>
      <div className="text-xs text-ink-muted mt-1">{sub}</div>
    </div>
  );
}

interface DetailRow {
  label: string;
  value: string;
  accent?: 'emerald' | 'amber';
  icon?: React.ComponentType<{ className?: string }>;
}

function DetailCard({
  title, icon: Icon, tint, rows, link,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
  rows: DetailRow[];
  link: { href: string; label: string };
}) {
  const { fg, bg } = TINTS[tint];
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden flex flex-col">
      <div className="p-5 border-b border-line flex items-center gap-2">
        <div className={`w-7 h-7 rounded-lg ${bg} ${fg} flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="p-5 space-y-2.5 flex-1">
        {rows.map((row) => {
          const RowIcon = row.icon;
          const valueColor =
            row.accent === 'emerald' ? 'text-emerald-700' :
            row.accent === 'amber' ? 'text-amber-700' :
            'text-ink';
          return (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <span className="text-ink-muted flex items-center gap-1.5">
                {RowIcon && <RowIcon className={`w-3.5 h-3.5 ${row.accent === 'amber' ? 'text-amber-600' : 'text-ink-muted'}`} />}
                {row.label}
              </span>
              <span className={`font-semibold tabular-nums ${valueColor}`}>{row.value}</span>
            </div>
          );
        })}
      </div>
      <div className="px-5 pb-4 pt-3 border-t border-line">
        <Link href={link.href} className="text-xs text-bronze hover:text-bronze-dark">
          {link.label}
        </Link>
      </div>
    </div>
  );
}

function DateField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 bg-white border border-line rounded-lg px-3 py-1.5">
      <Calendar className="w-3.5 h-3.5 text-ink-muted" />
      <span className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm text-ink bg-transparent focus:outline-none"
      />
    </label>
  );
}

// -------------------------------------------------------------------------
// Charts (inline SVG — no external chart dependency)
// -------------------------------------------------------------------------
function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-ink-muted flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** SVG donut for two (or more) segments. */
function Donut({
  segments, centerLabel, centerSub,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const size = 104;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEE" strokeWidth={stroke} />
        {total > 0 && segments.map((seg, i) => {
          const frac = Math.max(0, seg.value) / total;
          const dash = frac * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-ink tabular-nums leading-none">{centerLabel}</span>
        {centerSub && <span className="text-[10px] text-ink-muted mt-0.5">{centerSub}</span>}
      </div>
    </div>
  );
}

/** A two-part paid/outstanding stacked progress bar. */
function StackBar({ paid, outstanding }: { paid: number; outstanding: number }) {
  const total = paid + outstanding;
  const paidPct = total > 0 ? (paid / total) * 100 : 0;
  return (
    <div className="h-2.5 w-full rounded-full bg-surface-2 overflow-hidden flex">
      <div className="h-full bg-emerald-600" style={{ width: `${paidPct}%` }} />
      <div className="h-full bg-amber-600" style={{ width: `${100 - paidPct}%` }} />
    </div>
  );
}

/** Month-by-month shipping billed, with the collected portion filled in. */
function ShippingMonthlyBars({ rows }: { rows: ShippingEarnings['monthly'] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted py-6 text-center">No shipping billed in this range yet.</p>;
  }
  // Keep the chart readable on long ranges — show the most recent 12 months.
  const shown = rows.slice(-12);
  const max = Math.max(...shown.map((r) => r.charged), 1);

  return (
    <div>
      <div className="flex items-end gap-2 border-b border-line" style={{ height: 160 }}>
        {shown.map((r) => {
          const chargedPct = (r.charged / max) * 100;
          const collectedPct = r.charged > 0 ? (r.collected / r.charged) * 100 : 0;
          return (
            <div key={r.month} className="flex-1 min-w-0 h-full flex items-end justify-center">
              <div
                className="w-6 sm:w-9 rounded-t bg-amber-600/30 overflow-hidden flex flex-col justify-end"
                style={{ height: `${Math.max(chargedPct, 2)}%` }}
                title={`${monthLabel(r.month)} ${r.month.slice(0, 4)} — billed ${fmtCurrency(r.charged)}, collected ${fmtCurrency(r.collected)}`}
              >
                <div className="w-full bg-emerald-600" style={{ height: `${collectedPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-1.5">
        {shown.map((r) => (
          <div key={r.month} className="flex-1 min-w-0 text-center">
            <div className="text-[10px] text-ink-muted truncate">{monthLabel(r.month)}</div>
            <div className="text-[10px] font-semibold text-ink tabular-nums truncate">{fmtCompact(r.charged)}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" /> Collected
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-600/30" /> Billed
        </span>
      </div>
    </div>
  );
}

/** Horizontal bars for the top products (by revenue). */
function ProductBars({ products }: { products: ProductPerformanceEntry[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-ink-muted py-6 text-center">No products sold in this range yet.</p>;
  }
  const max = Math.max(...products.map((p) => p.revenue), 1);
  return (
    <div className="space-y-3">
      {products.map((p, i) => (
        <div key={p.id ?? `d-${i}`} className="flex items-center gap-3">
          <div className="w-32 sm:w-44 flex-shrink-0 text-sm text-ink truncate" title={p.name}>
            {p.name}
          </div>
          <div className="flex-1 h-6 rounded bg-surface overflow-hidden relative">
            <div
              className="h-full bg-emerald-600/80 rounded"
              style={{ width: `${Math.max(2, (p.revenue / max) * 100)}%` }}
            />
          </div>
          <div className="w-24 flex-shrink-0 text-right">
            <div className="text-sm font-semibold text-ink tabular-nums">{fmtCompact(p.revenue)}</div>
            <div className="text-[10px] text-ink-muted tabular-nums">{p.units.toLocaleString()} units</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ranked leaderboard with an inline proportional bar behind each row. */
function Leaderboard({
  title, icon: Icon, tint, entries, emptyLabel, metric, link,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
  entries: PerformanceEntry[];
  emptyLabel: string;
  metric: (e: PerformanceEntry) => string;
  link: { href: string; label: string };
}) {
  const { fg, bg } = TINTS[tint];
  const max = Math.max(...entries.map((e) => e.revenue), 1);
  const barColor =
    tint === 'emerald' ? 'bg-emerald-500/10' :
    tint === 'blue' ? 'bg-blue-500/10' :
    'bg-bronze/10';
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden flex flex-col">
      <div className="p-5 border-b border-line flex items-center gap-2">
        <div className={`w-7 h-7 rounded-lg ${bg} ${fg} flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="p-2 flex-1">
        {entries.length === 0 ? (
          <p className="text-sm text-ink-muted py-8 text-center">{emptyLabel}</p>
        ) : (
          <ol className="space-y-0.5">
            {entries.map((e, i) => (
              <li key={e.id ?? `n-${i}`} className="relative rounded-lg overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${barColor} rounded-lg`}
                  style={{ width: `${Math.max(4, (e.revenue / max) * 100)}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-2.5 px-3 py-2">
                  <span className="w-5 flex-shrink-0 text-xs font-bold text-ink-muted tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate" title={e.name}>{e.name}</div>
                    <div className="text-[10px] text-ink-muted">{metric(e)}</div>
                  </div>
                  <span className="text-sm font-semibold text-ink tabular-nums flex-shrink-0">
                    {fmtCompact(e.revenue)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="px-5 pb-4 pt-3 border-t border-line">
        <Link href={link.href} className="text-xs text-bronze hover:text-bronze-dark">
          {link.label}
        </Link>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Revenue audit table — which invoices are in the computation?
// -------------------------------------------------------------------------
const INVOICES_PAGE = 20;

/**
 * Lists every invoice feeding the revenue figures, so a chosen date range can
 * be audited. Filterable by text + status, paginated with a "Show more" button.
 */
function RevenueInvoicesTable({
  invoices, hasRange,
}: { invoices: RevenueInvoice[]; hasRange: boolean }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | RevenueInvoice['status']>('all');
  const [visible, setVisible] = useState(INVOICES_PAGE);

  // Status filter chips — only the statuses actually present, in a stable order.
  const statuses = useMemo(() => {
    const present = new Set(invoices.map((i) => i.status));
    return (['sent', 'partial', 'paid', 'overdue', 'draft'] as RevenueInvoice['status'][])
      .filter((s) => present.has(s));
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (status !== 'all' && inv.status !== status) return false;
      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customer_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [invoices, query, status]);

  // Column totals for the filtered set, split by currency (amounts are never
  // converted). Drafts are summed here too when shown; the Draft badge + chip
  // make clear those rows aren't finalised revenue.
  const totals = useMemo(() => {
    const acc: Record<InvoiceCurrency, { count: number; total: number; paid: number }> = {
      CAD: { count: 0, total: 0, paid: 0 },
      USD: { count: 0, total: 0, paid: 0 },
    };
    for (const inv of filtered) {
      const b = acc[inv.currency];
      b.count += 1;
      b.total += inv.total;
      b.paid += inv.paid;
    }
    return (['CAD', 'USD'] as InvoiceCurrency[])
      .filter((c) => acc[c].count > 0)
      .map((c) => ({ currency: c, ...acc[c] }));
  }, [filtered]);

  // Collapse back to the first page whenever the filter set changes.
  useEffect(() => { setVisible(INVOICES_PAGE); }, [query, status]);

  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  // Open/download the invoice PDF (same endpoint the invoices list uses).
  const openPdf = async (id: string, download = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `/api/admin/invoices/${id}/pdf${download ? '?download=1' : ''}`,
      { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} },
    );
    if (!res.ok) { alert('Could not open invoice PDF'); return; }
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };

  return (
    <div className="mt-6 bg-white rounded-xl border border-line overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-bronze" />
          <h3 className="text-sm font-semibold text-ink">Invoices in Computation</h3>
          <span className="text-xs text-ink-muted">
            {hasRange ? 'in the selected range' : 'all time'} · {invoices.length.toLocaleString()}
          </span>
        </div>
        {/* Search */}
        <label className="flex items-center gap-2 bg-surface border border-line rounded-lg px-3 py-1.5 sm:w-64">
          <Search className="w-3.5 h-3.5 text-ink-muted flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Invoice # or customer…"
            className="text-sm text-ink bg-transparent focus:outline-none w-full min-w-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-ink-muted hover:text-ink flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* Status filter chips */}
      {statuses.length > 0 && (
        <div className="px-5 py-3 border-b border-line flex items-center gap-1.5 overflow-x-auto">
          <FilterChip label="All" active={status === 'all'} onClick={() => setStatus('all')} />
          {statuses.map((s) => (
            <FilterChip
              key={s}
              label={INVOICE_STATUS_META[s].label}
              active={status === s}
              onClick={() => setStatus(s)}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-ink-muted">
          {invoices.length === 0
            ? 'No invoices contribute to revenue for this range.'
            : 'No invoices match your filters.'}
        </div>
      ) : (
        <>
          {/* Desktop table (≥lg) / mobile cards below — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface">
                <tr>
                  {['Invoice #', 'Date', 'Customer', 'Status', 'Total', 'Paid'].map((h) => (
                    <th
                      key={h}
                      className={`px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider ${
                        h === 'Total' || h === 'Paid' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {shown.map((inv) => {
                  const meta = INVOICE_STATUS_META[inv.status];
                  return (
                    <tr key={inv.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/invoices/${inv.id}`}
                          className="font-mono text-ink hover:text-bronze inline-flex items-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5" /> {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-muted whitespace-nowrap">{fmtDate(inv.issue_date)}</td>
                      <td className="px-5 py-3 text-ink truncate max-w-[220px]" title={inv.customer_name ?? undefined}>
                        {inv.customer_name ?? 'Guest'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums whitespace-nowrap">
                        {fmtCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                        <span className={inv.paid >= inv.total ? 'text-emerald-700' : 'text-ink-muted'}>
                          {fmtCurrency(inv.paid, inv.currency)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-white"
                            title="View invoice"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => openPdf(inv.id, false)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-white"
                            title="View PDF"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openPdf(inv.id, true)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-white"
                            title="Download / Print"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Column totals for the filtered set, one row per currency. */}
              <tfoot className="border-t-2 border-line bg-surface/60">
                {totals.map((t) => (
                  <tr key={t.currency}>
                    <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                      Total · {t.currency}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-muted tabular-nums whitespace-nowrap">
                      {t.count.toLocaleString()} inv.
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-ink tabular-nums whitespace-nowrap">
                      {fmtCurrency(t.total, t.currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                      {fmtCurrency(t.paid, t.currency)}
                    </td>
                    <td className="px-5 py-3" />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>

          {/* Mobile cards (below lg) + per-currency totals */}
          <div className="lg:hidden">
            <ul className="divide-y divide-line/50">
              {shown.map((inv) => {
                const meta = INVOICE_STATUS_META[inv.status];
                return (
                  <li key={inv.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/admin/invoices/${inv.id}`} className="font-mono text-sm text-ink hover:text-bronze inline-flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" /> {inv.invoice_number}
                      </Link>
                      <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                    </div>
                    <div className="mt-1 text-sm text-ink truncate">{inv.customer_name ?? 'Guest'}</div>
                    <div className="text-xs text-ink-muted">{fmtDate(inv.issue_date)}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                      <span>Total <span className="text-ink font-semibold tabular-nums">{fmtCurrency(inv.total, inv.currency)}</span></span>
                      <span>Paid <span className={`tabular-nums ${inv.paid >= inv.total ? 'text-emerald-700' : 'text-ink'}`}>{fmtCurrency(inv.paid, inv.currency)}</span></span>
                    </div>
                    <div className="mt-2 -ml-2.5 flex items-center gap-0.5">
                      <Link href={`/admin/invoices/${inv.id}`} title="View invoice" aria-label="View invoice" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface">
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                      <button onClick={() => openPdf(inv.id, false)} title="View PDF" aria-label="View PDF" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface">
                        <FileText className="w-4 h-4" />
                      </button>
                      <button onClick={() => openPdf(inv.id, true)} title="Download / Print" aria-label="Download / Print" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t-2 border-line bg-surface/60 divide-y divide-line/50">
              {totals.map((t) => (
                <div key={t.currency} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Total · {t.currency}</span>
                    <span className="text-xs text-ink-muted tabular-nums">{t.count.toLocaleString()} inv.</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-bold text-ink tabular-nums">{fmtCurrency(t.total, t.currency)}</span>
                    <span className="font-bold text-emerald-700 tabular-nums">{fmtCurrency(t.paid, t.currency)} paid</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted tabular-nums">
              Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
            </span>
            {remaining > 0 && (
              <button
                onClick={() => setVisible((v) => v + INVOICES_PAGE)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm"
              >
                Show more
                <span className="text-ink-muted/70 tabular-nums">
                  ({Math.min(INVOICES_PAGE, remaining)} of {remaining.toLocaleString()})
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
        active ? 'bg-bronze/10 text-bronze' : 'text-ink-muted hover:text-ink hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );
}
