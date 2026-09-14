'use client';

import React from 'react';
import { DollarSign, Wallet, UserPlus, Percent, Users, Package, TrendingUp, Truck } from 'lucide-react';
import { authedGet } from '@/lib/admin/authed-fetch';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { LoadingError } from '@/components/LoadingFeedback';

interface Overview {
  stats: {
    paidRevenue: number;
    invoiced: number;
    outstanding: number;
    newCustomersMTD: number;
    totalAffiliates: number;
    pendingCommissions: number;
    /** Shipping already collected (pro-rated by how much of each invoice is paid). */
    shippingCollected: number;
    /** Shipping billed across all revenue invoices. */
    shippingCharged: number;
    /** How many of those invoices carry a shipping charge. */
    shippingInvoiceCount: number;
  };
  revenue: { paid: number; outstanding: number };
  shipping: { charged: number; collected: number; uncollected: number; share_of_invoiced: number };
  monthly: Array<{ month: string; invoiced: number; paid: number }>;
  topAffiliates: Array<{ id: string; name: string; paid: number; pending: number; total: number }>;
  topProducts: Array<{ id: string | null; name: string; units: number }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(key: string): string {
  const [, m] = key.split('-');
  return MONTHS[Number(m) - 1] ?? key;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const moneyShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
};
const firstName = (full: string) => full.trim().split(/\s+/)[0] || full;

/**
 * The dashboard's data core: correctly-wired KPI strip plus the three standing
 * charts (revenue paid vs outstanding, top affiliates by commission, most-
 * ordered products). One fetch to /api/admin/dashboard/overview. Charts are
 * hand-built (no chart lib) and stay on the bronze palette — paid is solid
 * bronze, pending/outstanding is a lighter bronze, identity carried by labels.
 */
export default function DashboardOverview() {
  const ov = useSmartLoad(() => authedGet<Overview>('/api/admin/dashboard/overview'), []);

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        {ov.loading ? (
          [...Array(5)].map((_, i) => <KpiSkeleton key={i} />)
        ) : ov.error ? (
          <div className="col-span-2 lg:col-span-3 xl:col-span-5 rounded-xl border border-line bg-white">
            <LoadingError onRetry={ov.reload} />
          </div>
        ) : (
          <>
            <Kpi icon={DollarSign} label="Paid revenue" value={money(ov.data!.stats.paidRevenue)} sub="Collected on invoices" />
            <Kpi icon={Wallet} label="Outstanding" value={money(ov.data!.stats.outstanding)} sub="Awaiting payment" />
            <Kpi icon={UserPlus} label="New customers" value={String(ov.data!.stats.newCustomersMTD)} sub="Added this month" />
            <Kpi icon={Percent} label="Pending commissions" value={money(ov.data!.stats.pendingCommissions)} sub="Referral + invoice" />
            <Kpi
              icon={Truck}
              label="Shipping earned"
              value={money(ov.data!.stats.shippingCollected)}
              sub={`${money(ov.data!.stats.shippingCharged)} billed · ${ov.data!.stats.shippingInvoiceCount} inv.`}
            />
          </>
        )}
      </div>

      {/* Charts row: revenue · affiliates · products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <ChartCard icon={DollarSign} title="Revenue" hint="Paid vs outstanding">
          {ov.loading ? <ChartSkeleton /> : ov.data && <RevenueSplit paid={ov.data.revenue.paid} outstanding={ov.data.revenue.outstanding} />}
        </ChartCard>

        <ChartCard icon={Users} title="Top affiliates" hint="Commission — incl. pending">
          {ov.loading ? <ChartSkeleton /> : ov.data && <AffiliateBars rows={ov.data.topAffiliates} />}
        </ChartCard>

        <ChartCard icon={Package} title="Most ordered" hint="Top products by units">
          {ov.loading ? <ChartSkeleton /> : ov.data && <ProductBars rows={ov.data.topProducts} />}
        </ChartCard>
      </div>

      {/* Month-by-month revenue report (full width) */}
      <div className="mt-4 rounded-xl border border-line bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bronze/10 text-bronze">
            <TrendingUp className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-ink leading-tight">Revenue by month</h3>
            <p className="text-[11px] text-ink-muted leading-tight">Last 12 months — paid vs outstanding</p>
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            <LegendDot swatch="bg-bronze" label="Paid" />
            <LegendDot swatch="bg-bronze-light" label="Invoiced" />
          </div>
        </div>
        {ov.loading ? <div className="h-40 w-full animate-pulse rounded-lg bg-surface" /> : ov.data && <MonthlyLine rows={ov.data.monthly} />}
      </div>
    </>
  );
}

/* --------------------------------- KPI ---------------------------------- */

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-bronze" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      </div>
      <p className="text-xl md:text-2xl font-bold text-ink tabular-nums leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-ink-muted truncate">{sub}</p>}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-white p-4 animate-pulse">
      <div className="mb-2 h-3 w-20 rounded bg-surface" />
      <div className="h-6 w-24 rounded bg-surface" />
      <div className="mt-2 h-2.5 w-16 rounded bg-surface" />
    </div>
  );
}

/* ------------------------------- Chart shell ---------------------------- */

function ChartCard({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof DollarSign;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bronze/10 text-bronze">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink leading-tight">{title}</h3>
          <p className="text-[11px] text-ink-muted leading-tight">{hint}</p>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-32 w-full animate-pulse rounded-lg bg-surface" />;
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-center text-xs text-ink-muted">
      {label}
    </div>
  );
}

/* ------------------------------ Revenue split --------------------------- */

function RevenueSplit({ paid, outstanding }: { paid: number; outstanding: number }) {
  const total = paid + outstanding;
  if (total <= 0) return <Empty label="No invoiced revenue yet" />;
  const paidPct = (paid / total) * 100;
  const outPct = 100 - paidPct;

  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full bg-bronze" style={{ width: `${paidPct}%` }} title={`Paid ${money(paid)}`} />
        <div className="h-full bg-bronze/25" style={{ width: `${outPct}%` }} title={`Outstanding ${money(outstanding)}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LegendStat swatch="bg-bronze" label="Paid" value={money(paid)} pct={paidPct} />
        <LegendStat swatch="bg-bronze/25" label="Outstanding" value={money(outstanding)} pct={outPct} />
      </div>
    </div>
  );
}

function LegendStat({ swatch, label, value, pct }: { swatch: string; label: string; value: string; pct: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${swatch}`} />
        <span className="text-[11px] text-ink-muted truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-base font-bold text-ink tabular-nums leading-none">{value}</div>
      <div className="text-[11px] text-ink-light tabular-nums">{Math.round(pct)}%</div>
    </div>
  );
}

/* --------------------------- Affiliate stacked bars --------------------- */

function AffiliateBars({ rows }: { rows: Overview['topAffiliates'] }) {
  if (rows.length === 0) return <Empty label="No commissions recorded yet" />;
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="flex h-full flex-col justify-end">
      {/* Fixed-height plot so bar percentages resolve against a definite height */}
      <div className="flex items-end gap-2 border-b border-line" style={{ height: 132 }}>
        {rows.map((r) => {
          const totalPct = (r.total / max) * 100;
          const paidPct = r.total > 0 ? (r.paid / r.total) * 100 : 0;
          const pendPct = 100 - paidPct;
          return (
            <div key={r.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className="w-6 overflow-hidden rounded-t sm:w-8"
                style={{ height: `${Math.max(totalPct, 3)}%` }}
                title={`${r.name} — paid ${money(r.paid)}, pending ${money(r.pending)}`}
              >
                <div className="flex h-full w-full flex-col">
                  {pendPct > 0 && <div className="w-full bg-bronze/25" style={{ height: `${pendPct}%` }} />}
                  {paidPct > 0 && <div className="w-full bg-bronze" style={{ height: `${paidPct}%` }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* name + total under each bar */}
      <div className="mt-1.5 flex gap-2">
        {rows.map((r) => (
          <div key={r.id} className="min-w-0 flex-1 text-center">
            <div className="truncate text-[10px] text-ink-muted" title={r.name}>{firstName(r.name)}</div>
            <div className="text-[10px] font-semibold text-ink tabular-nums">{moneyShort(r.total)}</div>
          </div>
        ))}
      </div>
      {/* legend */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <LegendDot swatch="bg-bronze" label="Paid" />
        <LegendDot swatch="bg-bronze/25" label="Pending" />
      </div>
    </div>
  );
}

function LegendDot({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
      <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

/* ---------------------------- Product h-bars ---------------------------- */

function ProductBars({ rows }: { rows: Overview['topProducts'] }) {
  if (rows.length === 0) return <Empty label="No sales recorded yet" />;
  const max = Math.max(...rows.map((r) => r.units), 1);

  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {rows.map((r, i) => (
        <div key={r.id ?? `d${i}`} className="flex items-center gap-2">
          <div className="w-20 shrink-0 truncate text-xs text-ink sm:w-24" title={r.name}>
            {r.name}
          </div>
          <div className="h-4 flex-1 overflow-hidden rounded bg-surface">
            <div className="h-full rounded bg-bronze" style={{ width: `${Math.max((r.units / max) * 100, 4)}%` }} />
          </div>
          <div className="w-9 shrink-0 text-right text-xs font-semibold text-ink tabular-nums">{r.units}</div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------- Monthly revenue line ----------------------- */

const BRONZE = '#9C8B5A';
const BRONZE_LIGHT = '#B8A876';

function MonthlyLine({ rows }: { rows: Overview['monthly'] }) {
  const n = rows.length;
  const max = Math.max(...rows.map((r) => r.invoiced), 1);
  if (n < 2 || !rows.some((r) => r.invoiced > 0)) {
    return <Empty label="Not enough revenue history yet" />;
  }

  // Normalised 0–100 coordinate space; the SVG stretches to fill via
  // preserveAspectRatio="none" and strokes stay crisp with non-scaling-stroke.
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 92 - 4; // 4% headroom top

  const paidPts = rows.map((r, i) => `${x(i)},${y(r.paid)}`).join(' ');
  const invPts = rows.map((r, i) => `${x(i)},${y(r.invoiced)}`).join(' ');
  const areaPts = `0,100 ${paidPts} 100,100`;

  return (
    <div>
      <div className="relative w-full" style={{ height: 150 }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {/* faint area under the paid line */}
          <polygon points={areaPts} fill={BRONZE} opacity={0.07} />
          {/* invoiced ceiling — dashed, lighter */}
          <polyline
            points={invPts}
            fill="none"
            stroke={BRONZE_LIGHT}
            strokeWidth={2}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* paid — solid */}
          <polyline
            points={paidPts}
            fill="none"
            stroke={BRONZE}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* paid markers (kept round by living outside the stretched SVG) */}
        {rows.map((r, i) => (
          <span
            key={r.month}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bronze ring-2 ring-white"
            style={{ left: `${x(i)}%`, top: `${y(r.paid)}%` }}
          />
        ))}

        {/* per-month hover targets with native tooltip */}
        <div className="absolute inset-0 flex">
          {rows.map((r) => (
            <div
              key={r.month}
              className="h-full flex-1"
              title={`${monthLabel(r.month)} ${r.month.slice(0, 4)} — invoiced ${money(r.invoiced)}, paid ${money(r.paid)}`}
            />
          ))}
        </div>
      </div>

      {/* x labels */}
      <div className="mt-1.5 flex gap-1 border-t border-line pt-1.5">
        {rows.map((r) => (
          <div key={r.month} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-muted">
            {monthLabel(r.month)}
          </div>
        ))}
      </div>
    </div>
  );
}
