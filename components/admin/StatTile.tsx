'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { useCountUpSmooth } from '@/lib/hooks/useCountUpSmooth';

export type StatTint = 'emerald' | 'purple' | 'vital' | 'blue' | 'ink' | 'indigo' | 'amber';

const TINTS: Record<StatTint, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-600',
  purple: 'bg-purple-500/10 text-purple-600',
  vital: 'bg-vital/10 text-vital',
  blue: 'bg-blue-500/10 text-blue-600',
  ink: 'bg-ink/5 text-ink',
  indigo: 'bg-indigo-500/10 text-indigo-600',
  amber: 'bg-amber-500/10 text-amber-600',
};

const fmtInt = (n: number) => Math.round(n || 0).toLocaleString('en-US');

// Animated number that counts up from 0 to `value` on mount, formatting each
// frame (rounding keeps money/ints clean while it ticks).
function CountValue({ value, format }: { value: number; format: (n: number) => string }) {
  const animated = useCountUpSmooth(value);
  return <>{format(animated)}</>;
}

/**
 * A dashboard stat tile that matches the admin design system: an icon chip, an
 * uppercase label, a large tabular value that counts up on load, and a caption.
 * While `loading` it shows a skeleton instead of a bare "0".
 */
export default function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  loading,
  format,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
  tint: StatTint;
  loading?: boolean;
  /** Formatter for the value (defaults to a thousands-separated integer). */
  format?: (n: number) => string;
}) {
  const fmt = format ?? fmtInt;
  return (
    <div className="bg-white rounded-xl p-4 border border-line">
      <div className="flex items-center justify-between mb-2.5">
        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${TINTS[tint]}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{label}</span>
      </div>
      {loading ? (
        <>
          <div className="h-7 w-20 rounded-lg bg-surface animate-pulse" />
          <div className="h-3 w-16 rounded bg-surface animate-pulse mt-2" />
        </>
      ) : (
        <>
          <div className="text-2xl font-bold text-ink tabular-nums leading-none">
            <CountValue value={value} format={fmt} />
          </div>
          {sub && <div className="text-[11px] text-ink-muted mt-1">{sub}</div>}
        </>
      )}
    </div>
  );
}
