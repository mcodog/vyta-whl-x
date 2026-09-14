'use client';

/**
 * The customer's sales team — who is assigned to them and what each earns.
 *
 * Up to five sales people, each with the commission percentage they take on
 * THIS customer's invoices. The first is the primary: it is what
 * `customers.default_sales_person_id` points at, and what the invoice form
 * pre-fills first. Saving replaces the whole roster in one PUT, so a half-saved
 * team can't exist.
 *
 * Read-only for anyone who can't edit customers; the API enforces the same rule.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase, Plus, Trash2, Search, Loader2, Check, X, Pencil, AlertCircle, ChevronUp, ChevronDown,
} from 'lucide-react';
import type { SalesPerson } from '@/lib/supabase';
import { searchSalesPersons } from '@/lib/admin/sales-persons';
import { updateCustomer } from '@/lib/admin/api';
import { MAX_SALES_PEOPLE } from '@/lib/admin/sales-attribution';

/** One roster row as it arrives from the customers API. */
export interface SalesTeamMember {
  sales_person_id: string;
  commission_rate: number;
  position: number;
  sales_person?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    active?: boolean | null;
  } | null;
}

interface Seat {
  key: string;
  id: string | null;
  name: string;
  email: string | null;
  rate: number | null;
  inactive: boolean;
}

let seatSeq = 0;
const newSeat = (over: Partial<Seat> = {}): Seat => ({
  key: `team-seat-${++seatSeq}`,
  id: null,
  name: '',
  email: null,
  rate: null,
  inactive: false,
  ...over,
});

function displayName(sp: SalesTeamMember['sales_person'] | SalesPerson | null): string {
  if (!sp) return 'Unknown';
  const name = [sp.first_name, sp.last_name].filter(Boolean).join(' ').trim();
  return name || sp.email || 'Unknown';
}

function seatsFrom(team: SalesTeamMember[]): Seat[] {
  return [...team]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((m) =>
      newSeat({
        id: m.sales_person_id,
        name: displayName(m.sales_person ?? null),
        email: m.sales_person?.email ?? null,
        rate: Number(m.commission_rate) || 0,
        inactive: m.sales_person?.active === false,
      }),
    );
}

export default function SalesTeamCard({
  customerId,
  team,
  canEdit,
  onSaved,
}: {
  customerId: string;
  team: SalesTeamMember[];
  canEdit: boolean;
  /** Fired after a successful save so the page can refresh its aggregate. */
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [seats, setSeats] = useState<Seat[]>(() => seatsFrom(team));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The roster reloads with the page; keep the read view in step with it while
  // the editor is closed (an open editor holds unsaved work and must not be
  // clobbered by a background refresh).
  useEffect(() => {
    if (!editing) setSeats(seatsFrom(team));
  }, [team, editing]);

  const saved = useMemo(() => seatsFrom(team), [team]);

  const startEdit = () => {
    setSeats(saved.length > 0 ? saved : [newSeat()]);
    setError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setSeats(saved);
    setError(null);
    setEditing(false);
  };

  const setSeat = (key: string, patch: Partial<Seat>) =>
    setSeats((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const addSeat = () =>
    setSeats((prev) => (prev.length >= MAX_SALES_PEOPLE ? prev : [...prev, newSeat()]));

  const removeSeat = (key: string) =>
    setSeats((prev) => (prev.length <= 1 ? [newSeat()] : prev.filter((s) => s.key !== key)));

  /** Move a seat up or down — position 0 is the primary, so order is meaningful. */
  const moveSeat = (index: number, delta: -1 | 1) => {
    setSeats((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    const filled = seats.filter((s) => s.id);
    // Duplicates would be dropped server-side; say so rather than silently
    // saving fewer people than the admin put in.
    const ids = new Set<string>();
    for (const s of filled) {
      if (ids.has(s.id!)) {
        setError(`${s.name} is listed twice — each sales person can only appear once.`);
        return;
      }
      ids.add(s.id!);
    }

    setSaving(true);
    setError(null);
    const res = await updateCustomer(customerId, {
      sales_people: filled.map((s) => ({
        sales_person_id: s.id!,
        commission_rate: Math.min(100, Math.max(0, Number(s.rate) || 0)),
      })),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Could not save the sales team');
      return;
    }
    setEditing(false);
    onSaved();
  };

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-vital" />
          Sales team
        </h3>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>

      <div className="p-5">
        {error && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-px" />
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {!editing ? (
          saved.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No sales person assigned. New invoices for this customer start with no attribution.
            </p>
          ) : (
            <ul className="space-y-2">
              {saved.map((s, i) => (
                <li
                  key={s.key}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line bg-surface/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink flex items-center gap-2 flex-wrap">
                      <span className="truncate">{s.name}</span>
                      {i === 0 && saved.length > 1 && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-purple-500/10 text-purple-600">
                          PRIMARY
                        </span>
                      )}
                      {s.inactive && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-red-500/10 text-red-500">
                          INACTIVE
                        </span>
                      )}
                    </div>
                    {s.email && <div className="text-xs text-ink-muted truncate">{s.email}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-purple-600 tabular-nums">{s.rate ?? 0}%</div>
                    <div className="text-[11px] text-ink-muted">commission</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-3">
            {seats.map((seat, index) => (
              <div key={seat.key} className="rounded-lg border border-line p-3 bg-surface/30">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {seat.id ? (
                      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink truncate">
                            {seat.name}
                            {index === 0 && seats.length > 1 && (
                              <span className="ml-1.5 text-[10px] font-semibold text-purple-600 uppercase tracking-wide">
                                primary
                              </span>
                            )}
                          </div>
                          {seat.email && <div className="text-xs text-ink-muted truncate">{seat.email}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSeat(seat.key, { id: null, name: '', email: null, rate: null })}
                          className="text-xs text-ink-muted hover:text-ink shrink-0"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <SalesPersonPicker
                        exclude={seats.map((s) => s.id).filter((v): v is string => Boolean(v))}
                        onPick={(sp) =>
                          setSeat(seat.key, {
                            id: sp.id,
                            name: displayName(sp),
                            email: sp.email ?? null,
                            rate: Number(sp.commission_rate) || 0,
                            inactive: sp.active === false,
                          })
                        }
                      />
                    )}
                  </div>

                  {/* Reordering matters: seat 0 is the customer's primary. */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveSeat(index, -1)}
                      disabled={index === 0}
                      title="Move up (the first is the primary)"
                      aria-label="Move up"
                      className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSeat(index, 1)}
                      disabled={index === seats.length - 1}
                      title="Move down"
                      aria-label="Move down"
                      className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSeat(seat.key)}
                      title="Remove"
                      aria-label="Remove this sales person"
                      className="p-1 rounded text-ink-muted hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <label className="mt-2.5 flex items-center gap-2">
                  <span className="text-xs font-medium text-ink-muted whitespace-nowrap">Commission %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={seat.rate ?? ''}
                    onChange={(e) =>
                      setSeat(seat.key, { rate: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    placeholder="0"
                    className="w-28 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                </label>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={addSeat}
                disabled={seats.length >= MAX_SALES_PEOPLE}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-line text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" /> Add sales person
              </button>
              <span className="text-[11px] text-ink-muted">
                {seats.length >= MAX_SALES_PEOPLE
                  ? `Maximum ${MAX_SALES_PEOPLE} sales people.`
                  : `Up to ${MAX_SALES_PEOPLE}. The first is the primary.`}
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save team
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>

            <p className="text-[11px] text-ink-muted leading-relaxed">
              These rates pre-fill new invoices for this customer. Invoices already raised keep the
              commission recorded on them — changing the team here never rewrites history.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Type-ahead over active sales people, minus anyone already on the team. */
function SalesPersonPicker({
  exclude,
  onPick,
}: {
  exclude: string[];
  onPick: (sp: SalesPerson) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SalesPerson[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const found = await searchSalesPersons(query);
      const taken = new Set(exclude);
      setResults(found.filter((s) => !taken.has(s.id)));
      setBusy(false);
    }, 220);
    return () => clearTimeout(t);
    // `exclude` is a fresh array every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, exclude.join(',')]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search salespeople…"
        className="w-full pl-10 pr-4 py-2 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-auto">
          {busy && results.length === 0 ? (
            <div className="px-4 py-2.5 text-sm text-ink-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-2.5 text-sm text-ink-muted">
              No sales people match. Add them under Sales People first.
            </div>
          ) : (
            results.map((sp) => (
              <button
                key={sp.id}
                type="button"
                onClick={() => { onPick(sp); setQuery(''); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 hover:bg-surface text-sm border-b border-line/50 last:border-0"
              >
                <div className="font-medium text-ink">{displayName(sp)}</div>
                <div className="text-xs text-ink-muted">{sp.email ?? '—'} · default {sp.commission_rate}%</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
