import React from "react";

/**
 * A single headline metric tile for the error dashboard. `tone` tints the
 * value + icon so severe metrics (unresolved) read differently from neutral
 * ones (total).
 */
export default function ErrorStatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "danger" | "warn" | "good";
}) {
  const toneClasses = {
    neutral: { icon: "text-ink-muted bg-surface-2", value: "text-ink" },
    danger: { icon: "text-red-600 bg-red-50", value: "text-red-600" },
    warn: { icon: "text-amber-600 bg-amber-50", value: "text-amber-600" },
    good: { icon: "text-emerald-600 bg-emerald-50", value: "text-emerald-600" },
  }[tone];

  return (
    <div className="bg-white rounded-xl border border-line shadow-sm p-4 flex items-center gap-4">
      <div className={`flex items-center justify-center w-11 h-11 rounded-lg shrink-0 ${toneClasses.icon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className={`text-2xl font-bold tabular-nums leading-none ${toneClasses.value}`}>{value}</p>
        <p className="text-xs text-ink-muted mt-1">{label}</p>
        {hint && <p className="text-[11px] text-ink-light mt-0.5 truncate">{hint}</p>}
      </div>
    </div>
  );
}
