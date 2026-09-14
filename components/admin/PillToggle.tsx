import React from "react";

export interface PillOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * A segmented "pill" toggle with the label text inside each segment and a
 * sliding active pill behind the selected option. Generic over the option
 * value type so it can drive view switches, filters, etc.
 */
export default function PillToggle<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 border border-line"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-all ${pad} ${
              active
                ? "bg-white text-ink shadow-sm border border-line"
                : "text-ink-muted hover:text-ink border border-transparent"
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
