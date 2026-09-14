'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  AlertTriangle,
  FileText,
  Package,
  Users,
  DollarSign,
  Archive,
  Download,
  PowerOff,
  Trash2,
  Loader2,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  fetchDeletionReview,
  executeDeletion,
  downloadReviewJson,
  defaultPlan,
  type DeletionKind,
  type DeletionReview,
  type DeletionPlan,
} from '@/lib/admin/deletion';

interface EntityLite {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

interface Props {
  kind: DeletionKind;
  entity: EntityLite;
  onClose: () => void;
  onDeleted: () => void;
  /** Optional soft-delete (deactivate) path — shown for customer/user only. */
  onDeactivate?: () => Promise<{ success: boolean; error?: string }>;
}

const KIND_LABEL: Record<DeletionKind, string> = {
  customer: 'Customer',
  sales_person: 'Sales Person',
  user: 'User',
  affiliate: 'Affiliate',
};

function money(cur: 'CAD' | 'USD', amount: number): string {
  return `${cur} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Two/three-way segmented control used by each decision card. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; tone?: 'default' | 'danger' }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const danger = o.tone === 'danger';
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              active
                ? danger
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'bg-white text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-ink-muted mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-lg font-bold tabular-nums ${accent ? 'text-red-600' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

/** One decision card (icon + title + count + copy + control). */
function DecisionCard({
  icon: Icon,
  title,
  count,
  children,
  control,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  children: React.ReactNode;
  control?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted">
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {title}
              {typeof count === 'number' && (
                <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted tabular-nums">
                  {count}
                </span>
              )}
            </p>
            <div className="mt-1 text-xs text-ink-muted">{children}</div>
          </div>
        </div>
        {control && <div className="flex-shrink-0">{control}</div>}
      </div>
    </div>
  );
}

export default function DeletionReviewModal({
  kind,
  entity,
  onClose,
  onDeleted,
  onDeactivate,
}: Props) {
  const toast = useToast();
  const [review, setReview] = useState<DeletionReview | null>(null);
  const [loadingReview, setLoadingReview] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [plan, setPlan] = useState<DeletionPlan>(defaultPlan(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const fallbackName =
    `${entity.first_name ?? ''} ${entity.last_name ?? ''}`.trim() || entity.email || 'this record';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingReview(true);
      const { review: r, error: e } = await fetchDeletionReview(kind, entity.id);
      if (cancelled) return;
      if (e || !r) {
        setLoadError(e || 'Failed to load records');
      } else {
        setReview(r);
        setPlan(defaultPlan(r));
      }
      setLoadingReview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, entity.id]);

  const isCustomerLike = kind === 'customer' || kind === 'user' || kind === 'affiliate';
  const counts = review?.counts;
  const needsGuest =
    isCustomerLike &&
    !!counts &&
    ((plan.invoices === 'reassign' && counts.invoices > 0) ||
      (plan.orders === 'reassign' && counts.orders > 0) ||
      (plan.clients === 'reassign' && counts.clients > 0));

  const outstanding = review?.money.outstanding ?? { CAD: 0, USD: 0 };
  const hasOutstanding = outstanding.CAD > 0.005 || outstanding.USD > 0.005;

  const previewInvoices = useMemo(() => (review?.invoices ?? []).slice(0, 6), [review]);

  const handleDelete = async () => {
    setError('');
    setBusy(true);
    const result = await executeDeletion(kind, entity.id, plan);
    if (!result.success) {
      const msg = result.error || 'Failed to delete';
      setError(msg);
      toast.error(msg);
      setBusy(false);
      return;
    }
    const bits: string[] = [];
    if (result.guestId) bits.push('records kept under a guest');
    if (result.snapshotId) bits.push('snapshot archived');
    toast.success(
      `Deleted ${review?.name || fallbackName}${bits.length ? ` — ${bits.join(', ')}` : ''}`,
    );
    onDeleted();
  };

  const handleDeactivate = async () => {
    if (!onDeactivate) return;
    setError('');
    setBusy(true);
    const result = await onDeactivate();
    if (!result.success) {
      const msg = result.error || 'Failed to deactivate';
      setError(msg);
      toast.error(msg);
      setBusy(false);
      return;
    }
    toast.success(`Deactivated ${review?.name || fallbackName}`);
    onDeleted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-line">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-ink truncate">
                Delete {review?.name || fallbackName}
              </h2>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                {KIND_LABEL[kind]}
              </span>
            </div>
            {(review?.email || entity.email) && (
              <p className="text-xs text-ink-muted truncate">{review?.email || entity.email}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loadingReview ? (
            <div className="flex items-center justify-center gap-2 py-16 text-ink-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Gathering this record&apos;s data…
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{loadError}</span>
            </div>
          ) : review ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                <StatTile icon={FileText} label="Invoices" value={review.counts.invoices} />
                {isCustomerLike && (
                  <StatTile icon={Package} label="Orders" value={review.counts.orders} />
                )}
                {isCustomerLike && (
                  <StatTile icon={Users} label="Ship-to" value={review.counts.clients} />
                )}
                {(kind === 'sales_person' || review.counts.commissions > 0) && (
                  <StatTile
                    icon={DollarSign}
                    label="Commissions"
                    value={review.counts.commissions}
                  />
                )}
                <StatTile
                  icon={AlertTriangle}
                  label="Outstanding"
                  accent={hasOutstanding}
                  value={
                    hasOutstanding ? (
                      <span className="text-sm leading-tight">
                        {outstanding.CAD > 0.005 && <div>{money('CAD', outstanding.CAD)}</div>}
                        {outstanding.USD > 0.005 && <div>{money('USD', outstanding.USD)}</div>}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
              </div>

              {hasOutstanding && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span className="text-amber-700 text-xs">
                    This record has outstanding balances. Invoices are always kept as financial
                    records — choose <strong>Reassign to guest</strong> below to keep them grouped
                    and collectible.
                  </span>
                </div>
              )}

              {/* Decisions */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Decide what happens to each
                </p>

                {isCustomerLike ? (
                  <>
                    {review.counts.invoices > 0 && (
                      <DecisionCard
                        icon={FileText}
                        title="Invoices"
                        count={review.counts.invoices}
                        control={
                          <Segmented
                            value={plan.invoices}
                            onChange={(v) => setPlan((p) => ({ ...p, invoices: v }))}
                            options={[
                              { value: 'reassign', label: 'Reassign to guest' },
                              { value: 'detach', label: 'Keep detached' },
                            ]}
                          />
                        }
                      >
                        Invoices are never deleted.{' '}
                        {plan.invoices === 'reassign'
                          ? 'They move onto a guest record so they stay grouped and openable.'
                          : 'They keep a name snapshot and are flagged “customer deleted”.'}
                      </DecisionCard>
                    )}

                    {review.counts.orders > 0 && (
                      <DecisionCard
                        icon={Package}
                        title="Storefront orders"
                        count={review.counts.orders}
                        control={
                          <Segmented
                            value={plan.orders}
                            onChange={(v) => setPlan((p) => ({ ...p, orders: v }))}
                            options={[
                              { value: 'reassign', label: 'Reassign to guest' },
                              { value: 'detach', label: 'Keep detached' },
                            ]}
                          />
                        }
                      >
                        Order history is kept either way; this only decides whether it stays linked
                        to the guest record.
                      </DecisionCard>
                    )}

                    {review.counts.clients > 0 && (
                      <DecisionCard
                        icon={Users}
                        title="Ship-to clients"
                        count={review.counts.clients}
                        control={
                          <Segmented
                            value={plan.clients}
                            onChange={(v) => setPlan((p) => ({ ...p, clients: v }))}
                            options={[
                              { value: 'reassign', label: 'Move to guest' },
                              { value: 'delete', label: 'Delete', tone: 'danger' },
                            ]}
                          />
                        }
                      >
                        {plan.clients === 'reassign'
                          ? 'The saved end-recipient address book moves to the guest record.'
                          : 'The saved end-recipient address book is permanently removed.'}
                      </DecisionCard>
                    )}

                    {kind === 'affiliate' && review.counts.commissions > 0 && (
                      <DecisionCard
                        icon={DollarSign}
                        title="Commission history"
                        count={review.counts.commissions}
                      >
                        Referral and sales commissions are tied to this affiliate and are removed
                        with them
                        {plan.snapshot ? ' — captured in the snapshot below first.' : '.'}
                      </DecisionCard>
                    )}

                    {kind === 'affiliate' && (review.downline ?? 0) > 0 && (
                      <DecisionCard
                        icon={UserPlus}
                        title="Referred customers"
                        count={review.downline ?? 0}
                      >
                        Customers this affiliate referred are <strong>kept</strong> — they are only
                        unlinked from the affiliate, never removed.
                      </DecisionCard>
                    )}

                    {review.counts.invoices === 0 &&
                      review.counts.orders === 0 &&
                      review.counts.clients === 0 &&
                      review.counts.commissions === 0 &&
                      (review.downline ?? 0) === 0 && (
                        <p className="text-xs text-ink-muted">
                          No linked records — this simply removes the account.
                        </p>
                      )}
                  </>
                ) : (
                  <>
                    <DecisionCard
                      icon={FileText}
                      title="Invoices they closed"
                      count={review.counts.invoices}
                    >
                      Kept in full. Each invoice keeps its totals but loses the sales-person
                      reference.
                    </DecisionCard>
                    <DecisionCard
                      icon={DollarSign}
                      title="Commission history"
                      count={review.counts.commissions}
                    >
                      Commission rows are tied to this person and are removed with them
                      {plan.snapshot ? ' — captured in the snapshot below first.' : '.'}
                    </DecisionCard>
                  </>
                )}
              </div>

              {/* Guest preview */}
              {needsGuest && (
                <div className="rounded-xl border border-bronze/30 bg-bronze/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-bronze/10 text-bronze">
                      <UserPlus className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink">Guest record</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        A login-less placeholder inherits the reassigned records so they stay
                        grouped and openable in the Customers list.
                      </p>
                      <input
                        type="text"
                        value={plan.guestName ?? ''}
                        onChange={(e) => setPlan((p) => ({ ...p, guestName: e.target.value }))}
                        placeholder={review.name || 'Guest name'}
                        className="mt-2.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-light focus:border-bronze focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Snapshot */}
              <div className="rounded-xl border border-line p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={plan.snapshot}
                    onChange={(e) => setPlan((p) => ({ ...p, snapshot: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-line text-bronze focus:ring-bronze"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Archive className="w-4 h-4 text-ink-muted" />
                      <span className="text-sm font-semibold text-ink">
                        Save a snapshot archive
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Stores a full JSON record (profile, invoices, ship-to clients, commissions)
                      you can review later under Deleted Archives.
                    </p>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => downloadReviewJson(review)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-line/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download a copy now
                </button>
              </div>

              {/* Invoice preview */}
              {previewInvoices.length > 0 && (
                <details className="rounded-xl border border-line">
                  <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Preview invoices ({review.counts.invoices})
                  </summary>
                  <div className="overflow-x-auto border-t border-line">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-ink-muted">
                          <th className="px-4 py-2 font-medium">Invoice</th>
                          <th className="px-4 py-2 font-medium">Date</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium text-right">Total</th>
                          <th className="px-4 py-2 font-medium text-right">Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewInvoices.map((inv) => (
                          <tr key={inv.id} className="border-t border-line/60">
                            <td className="px-4 py-2 font-medium text-ink">
                              {inv.invoice_number || inv.id.slice(0, 8)}
                            </td>
                            <td className="px-4 py-2 text-ink-muted">
                              {inv.issue_date ? inv.issue_date.slice(0, 10) : '—'}
                            </td>
                            <td className="px-4 py-2 text-ink-muted capitalize">
                              {inv.status_effective || inv.status}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink">
                              {money(inv.currency as 'CAD' | 'USD', inv.total)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                              {inv.amount_due > 0.005
                                ? money(inv.currency as 'CAD' | 'USD', inv.amount_due)
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {review.counts.invoices > previewInvoices.length && (
                      <p className="px-4 py-2 text-xs text-ink-muted">
                        and {review.counts.invoices - previewInvoices.length} more…
                      </p>
                    )}
                  </div>
                </details>
              )}

              {/* Deactivate (soft) alternative */}
              {onDeactivate && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-start gap-3">
                    <PowerOff className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink">Prefer to keep them?</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Deactivate instead — they can&apos;t log in, but nothing is removed and it
                        can be reversed later.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeactivate}
                      disabled={busy}
                      className="flex-shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        {!loadingReview && !loadError && review && (
          <div className="border-t border-line px-6 py-4 space-y-3">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-red-700 text-sm">{error}</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="h-4 w-4 rounded border-line text-red-500 focus:ring-red-500"
              />
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                I understand the {KIND_LABEL[kind].toLowerCase()} record will be permanently removed.
              </span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy || !acknowledged}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" /> Delete permanently
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
