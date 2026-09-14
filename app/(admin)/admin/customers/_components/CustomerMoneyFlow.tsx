'use client';

/**
 * "Where this customer's money goes."
 *
 * One customer's invoiced revenue, split between the sales people who earn a
 * commission on it and the share the business keeps. Two views of exactly the
 * same numbers, because the two questions people ask are different:
 *
 *   • Chart — the shape of the split at a glance: a proportional bar plus a
 *     flow tree from the customer out to each earner and the remainder.
 *   • Breakdown — the audit trail: a per-person table with paid vs pending
 *     commission and the effective rate, in words as well as figures.
 *
 * Amounts are never converted between currencies — a customer with both CAD and
 * USD invoices gets one section per currency, mirroring the A/R card.
 */

import React, { useState } from 'react';
import { BarChart3, TableProperties, TrendingUp, Building2, Briefcase, Info } from 'lucide-react';

export type FlowCurrency = 'CAD' | 'USD';

export interface SalesFlowEarner {
  salesPersonId: string;
  name: string;
  email: string | null;
  invoiceCount: number;
  invoiced: number;
  commission: number;
  commissionPaid: number;
  commissionPending: number;
  /** Commission as a share of what this person invoiced. */
  effectiveRate: number;
}

export interface SalesFlowBucket {
  invoiced: number;
  invoiceCount: number;
  commission: number;
  commissionPaid: number;
  commissionPending: number;
  /** Invoiced minus commission — what the business keeps. */
  net: number;
  earners: SalesFlowEarner[];
}

export interface SalesFlowData {
  byCurrency: Record<FlowCurrency, SalesFlowBucket>;
  currencies: FlowCurrency[];
}

type ViewMode = 'chart' | 'text';

/**
 * Segment colours, in assignment order. Five distinct hues — one per sales
 * person, matching the five-person cap. `bar` fills the proportional bar and
 * the flow-tree avatar; `dot` is the same colour as a small swatch, so the
 * legend, the tree and the breakdown table all read as one series.
 */
const EARNER_COLORS = [
  { bar: 'bg-purple-500', tint: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  { bar: 'bg-vital', tint: 'bg-vital/15 text-vital-dark', dot: 'bg-vital' },
  { bar: 'bg-sky-500', tint: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  { bar: 'bg-emerald-500', tint: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { bar: 'bg-rose-500', tint: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
] as const;

const colorFor = (i: number) => EARNER_COLORS[i % EARNER_COLORS.length];

function money(n: number, cur: FlowCurrency) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

function pctLabel(part: number, whole: number): string {
  const p = pct(part, whole);
  if (p === 0) return '0%';
  return `${p < 0.1 ? '<0.1' : p.toFixed(1)}%`;
}

export default function CustomerMoneyFlow({
  flow,
  customerName,
}: {
  flow: SalesFlowData;
  customerName: string;
}) {
  const [view, setView] = useState<ViewMode>('chart');
  const currencies = flow.currencies.length > 0 ? flow.currencies : (['CAD'] as FlowCurrency[]);
  const hasAnything = currencies.some((c) => flow.byCurrency[c].invoiceCount > 0);

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-vital" />
          Where the money goes
        </h3>
        {/* Two views of the same numbers — a picture, and the receipts. */}
        <div role="group" aria-label="Money flow view" className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
          {([
            { key: 'chart' as const, label: 'Chart', Icon: BarChart3 },
            { key: 'text' as const, label: 'Breakdown', Icon: TableProperties },
          ]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setView(o.key)}
              aria-pressed={view === o.key}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors ${
                view === o.key ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <o.Icon className="w-3.5 h-3.5" />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {!hasAnything ? (
          <p className="text-sm text-ink-muted">
            No invoiced revenue yet, so there is nothing to split.
          </p>
        ) : (
          <div className="space-y-8">
            {currencies.map((cur) => (
              <section key={cur}>
                {currencies.length > 1 && (
                  <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">
                    {cur}
                  </div>
                )}
                {view === 'chart' ? (
                  <FlowChart bucket={flow.byCurrency[cur]} cur={cur} customerName={customerName} />
                ) : (
                  <FlowBreakdown bucket={flow.byCurrency[cur]} cur={cur} customerName={customerName} />
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart view
// ---------------------------------------------------------------------------

function FlowChart({
  bucket,
  cur,
  customerName,
}: {
  bucket: SalesFlowBucket;
  cur: FlowCurrency;
  customerName: string;
}) {
  const { invoiced, commission, net, earners } = bucket;

  if (bucket.invoiceCount === 0) {
    return <p className="text-sm text-ink-muted">No {cur} invoices for this customer.</p>;
  }

  return (
    <div className="space-y-5">
      {/* Proportional split of every invoiced dollar. Commission segments come
          first so they read left-to-right in the same order as the tree below;
          whatever is left over is the business's share. */}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-xs text-ink-muted">
            Every {cur} dollar invoiced to {customerName}
          </span>
          <span className="text-sm font-bold text-ink tabular-nums">{money(invoiced, cur)}</span>
        </div>
        <div className="flex h-7 w-full overflow-hidden rounded-lg border border-line bg-surface">
          {earners.map((e, i) => {
            const share = pct(e.commission, invoiced);
            if (share <= 0) return null;
            return (
              <div
                key={e.salesPersonId}
                className={`${colorFor(i).bar} flex items-center justify-center overflow-hidden`}
                style={{ width: `${share}%` }}
                title={`${e.name} — ${money(e.commission, cur)} (${pctLabel(e.commission, invoiced)})`}
              >
                {share >= 8 && (
                  <span className="text-[10px] font-semibold text-white tabular-nums px-1 truncate">
                    {pctLabel(e.commission, invoiced)}
                  </span>
                )}
              </div>
            );
          })}
          <div
            className="flex-1 flex items-center justify-center bg-ink/80"
            title={`Kept by the business — ${money(net, cur)} (${pctLabel(net, invoiced)})`}
          >
            {pct(net, invoiced) >= 8 && (
              <span className="text-[10px] font-semibold text-white tabular-nums px-1 truncate">
                {pctLabel(net, invoiced)} kept
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {earners.map((e, i) => (
            <span key={e.salesPersonId} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span className={`w-2.5 h-2.5 rounded-sm ${colorFor(i).dot}`} />
              {e.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="w-2.5 h-2.5 rounded-sm bg-ink/80" />
            Business
          </span>
        </div>
      </div>

      {/* The same split as a flow: one source, one branch per destination. The
          rail + elbow are drawn with borders so it stays crisp at any zoom. */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-vital/30 bg-vital/5 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-vital/15 text-vital flex items-center justify-center shrink-0">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-ink-muted">Invoiced · {bucket.invoiceCount} invoice{bucket.invoiceCount === 1 ? '' : 's'}</div>
            <div className="text-sm font-bold text-ink tabular-nums">{money(invoiced, cur)}</div>
          </div>
        </div>

        <div className="ml-3.5 border-l border-line pl-0">
          {earners.map((e, i) => (
            <FlowBranch
              key={e.salesPersonId}
              icon={<Briefcase className="w-3.5 h-3.5" />}
              tone={colorFor(i).tint}
              dot={colorFor(i).dot}
              title={e.name}
              sub={`${e.invoiceCount} invoice${e.invoiceCount === 1 ? '' : 's'} · ${e.effectiveRate.toFixed(2)}% of ${money(e.invoiced, cur)}`}
              amount={money(e.commission, cur)}
              share={pctLabel(e.commission, invoiced)}
              note={
                e.commissionPending > 0
                  ? `${money(e.commissionPending, cur)} still pending`
                  : e.commission > 0
                    ? 'all paid out'
                    : null
              }
            />
          ))}
          <FlowBranch
            icon={<Building2 className="w-3.5 h-3.5" />}
            tone="bg-ink/5 text-ink"
            dot="bg-ink/80"
            title="Kept by the business"
            sub="Invoiced revenue after every commission"
            amount={money(net, cur)}
            share={pctLabel(net, invoiced)}
            note={null}
            last
          />
        </div>
      </div>

      {earners.length === 0 && (
        <p className="inline-flex items-start gap-2 text-xs text-ink-muted">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          No commission has been recorded against this customer&apos;s {cur} invoices, so the
          business keeps all of it.
        </p>
      )}

      {/* Commission rates are per person, not slices of one pot, so together
          they can exceed the invoice. Say so plainly rather than drawing a
          bar that quietly normalises itself. */}
      {net < 0 && (
        <p className="inline-flex items-start gap-2 text-xs text-red-600">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          Commission exceeds what was invoiced by {money(Math.abs(net), cur)} — the rates on these
          invoices add up to more than 100%.
        </p>
      )}
    </div>
  );
}

/** One destination on the flow tree: an elbow off the rail, then the amount. */
function FlowBranch({
  icon,
  tone,
  dot,
  title,
  sub,
  amount,
  share,
  note,
  last = false,
}: {
  icon: React.ReactNode;
  tone: string;
  dot: string;
  title: string;
  sub: string;
  amount: string;
  share: string;
  note: string | null;
  last?: boolean;
}) {
  return (
    <div className="relative flex items-start gap-3 pt-3">
      {/* Elbow: a short horizontal stub off the vertical rail. */}
      <span aria-hidden className="mt-4 h-px w-4 bg-line shrink-0" />
      {/* Mask the rail below the final branch so the line ends with the tree. */}
      {last && <span aria-hidden className="absolute left-0 top-[1.0625rem] bottom-0 -ml-px w-px bg-white" />}
      <div className={`mt-1.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${tone}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-sm ${dot}`} />
            <span className="truncate">{title}</span>
          </div>
          <div className="text-[11px] text-ink-muted">{sub}</div>
          {note && <div className="text-[11px] text-amber-600">{note}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-ink tabular-nums">{amount}</div>
          <div className="text-[11px] text-ink-muted tabular-nums">{share} of invoiced</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown view
// ---------------------------------------------------------------------------

function FlowBreakdown({
  bucket,
  cur,
  customerName,
}: {
  bucket: SalesFlowBucket;
  cur: FlowCurrency;
  customerName: string;
}) {
  const { invoiced, commission, commissionPaid, commissionPending, net, earners, invoiceCount } = bucket;

  if (invoiceCount === 0) {
    return <p className="text-sm text-ink-muted">No {cur} invoices for this customer.</p>;
  }

  return (
    <div className="space-y-4">
      {/* The whole story in a sentence, before any figures have to be read. */}
      <p className="text-sm text-ink leading-relaxed">
        {customerName} has been invoiced{' '}
        <span className="font-semibold tabular-nums">{money(invoiced, cur)}</span> across{' '}
        <span className="font-semibold tabular-nums">{invoiceCount}</span>{' '}
        {cur} invoice{invoiceCount === 1 ? '' : 's'}.{' '}
        {earners.length === 0 ? (
          <>No commission is recorded against them, so the full amount stays with the business.</>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{money(commission, cur)}</span> (
            {pctLabel(commission, invoiced)}) is earned by{' '}
            <span className="font-semibold">{earners.length}</span> sales{' '}
            {earners.length === 1 ? 'person' : 'people'}, leaving{' '}
            <span className="font-semibold tabular-nums">{money(net, cur)}</span> (
            {pctLabel(net, invoiced)}) with the business. Of the commission,{' '}
            <span className="tabular-nums">{money(commissionPaid, cur)}</span> has been paid out and{' '}
            <span className="tabular-nums">{money(commissionPending, cur)}</span> is still pending.
          </>
        )}
      </p>

      {earners.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-ink-muted uppercase tracking-wider border-b border-line">
                <th className="py-2 pl-1 pr-3">Sales person</th>
                <th className="py-2 px-3 text-right">Invoices</th>
                <th className="py-2 px-3 text-right">Invoiced</th>
                <th className="py-2 px-3 text-right">Rate</th>
                <th className="py-2 px-3 text-right">Commission</th>
                <th className="py-2 px-3 text-right">Paid</th>
                <th className="py-2 pl-3 pr-1 text-right">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {earners.map((e, i) => (
                <tr key={e.salesPersonId}>
                  <td className="py-2.5 pl-1 pr-3">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-sm shrink-0 ${colorFor(i).dot}`} />
                      <span className="min-w-0">
                        <span className="block font-medium text-ink truncate">{e.name}</span>
                        {e.email && <span className="block text-[11px] text-ink-muted truncate">{e.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-ink-muted">{e.invoiceCount}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-ink">{money(e.invoiced, cur)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-ink-muted">{e.effectiveRate.toFixed(2)}%</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-ink">{money(e.commission, cur)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600">{money(e.commissionPaid, cur)}</td>
                  <td className="py-2.5 pl-3 pr-1 text-right tabular-nums text-amber-600">{money(e.commissionPending, cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="py-2.5 pl-1 pr-3 font-semibold text-ink">Total commission</td>
                <td className="py-2.5 px-3" />
                <td className="py-2.5 px-3" />
                <td className="py-2.5 px-3 text-right tabular-nums text-ink-muted">
                  {pctLabel(commission, invoiced)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums font-bold text-ink">{money(commission, cur)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600">{money(commissionPaid, cur)}</td>
                <td className="py-2.5 pl-3 pr-1 text-right tabular-nums text-amber-600">{money(commissionPending, cur)}</td>
              </tr>
              <tr>
                <td className="py-2.5 pl-1 pr-3 font-semibold text-ink">Kept by the business</td>
                <td className="py-2.5 px-3" />
                <td className="py-2.5 px-3" />
                <td className="py-2.5 px-3 text-right tabular-nums text-ink-muted">
                  {pctLabel(net, invoiced)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums font-bold text-ink">{money(net, cur)}</td>
                <td className="py-2.5 px-3" />
                <td className="py-2.5 pl-3 pr-1" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {net < 0 && (
        <p className="inline-flex items-start gap-2 text-xs text-red-600">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          Commission exceeds what was invoiced by {money(Math.abs(net), cur)} — the rates recorded on
          these invoices add up to more than 100%.
        </p>
      )}

      <p className="inline-flex items-start gap-2 text-[11px] text-ink-muted">
        <Info className="w-3.5 h-3.5 mt-px shrink-0" />
        Figures come from the commission ledger, so they follow what was actually recorded per
        invoice — not the rates currently assigned. Cancelled invoices and cancelled commissions
        are excluded, and amounts are never converted between currencies.
      </p>
    </div>
  );
}
