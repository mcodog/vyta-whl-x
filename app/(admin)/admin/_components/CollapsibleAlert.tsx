'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

type Tone = 'red' | 'amber' | 'indigo';

// Palette-first: the container is always a plain white card on the neutral
// line color — no full color-fill boxes. Tone survives only as a thin left
// accent rail (an accent, not a background), which the caller reinforces with a
// colored icon. Body dividers stay neutral.
const toneStyles: Record<Tone, { container: string; headerHover: string; border: string }> = {
  red: { container: 'bg-white border-line border-l-2 border-l-red-400', headerHover: 'hover:bg-surface', border: 'border-line' },
  amber: { container: 'bg-white border-line border-l-2 border-l-amber-400', headerHover: 'hover:bg-surface', border: 'border-line' },
  indigo: { container: 'bg-white border-line border-l-2 border-l-bronze', headerHover: 'hover:bg-surface', border: 'border-line' },
};

interface CollapsibleAlertProps {
  tone: Tone;
  /** The colored icon box shown at the far left. */
  icon: React.ReactNode;
  /** Pre-styled heading node (caller owns the color). */
  title: React.ReactNode;
  /** Optional pre-styled sub-heading node. */
  subtitle?: React.ReactNode;
  /** Optional badge/pill rendered next to the title (e.g. a "Live" chip). */
  badge?: React.ReactNode;
  /** Optional right-aligned action (e.g. a "Manage" link). Not part of the toggle. */
  action?: React.ReactNode;
  /**
   * Content for the custom white tooltip shown on hover while collapsed — a
   * quick peek at what's inside without expanding.
   */
  summary?: React.ReactNode;
  /** Collapsed by default. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A dashboard alert banner that starts collapsed and expands on click. While
 * collapsed, hovering the header reveals a custom white info tooltip previewing
 * the hidden contents.
 */
export default function CollapsibleAlert({
  tone,
  icon,
  title,
  subtitle,
  badge,
  action,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleAlertProps) {
  const [open, setOpen] = useState(defaultOpen);
  const s = toneStyles[tone];

  return (
    // No overflow-hidden here: the collapsed hover tooltip is positioned just
    // below the header and must be allowed to escape the container. Rounded
    // corners are applied to the header/body pieces instead.
    <div className={`mb-4 rounded-xl border ${s.container}`}>
      <div className="group relative">
        <div
          className={`flex items-center gap-3 px-5 md:px-6 py-4 transition-colors rounded-t-xl ${
            open ? '' : 'rounded-b-xl'
          } ${s.headerHover}`}
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            {icon}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {title}
                {badge}
              </div>
              {subtitle}
            </div>
          </button>

          {action}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            className="shrink-0 p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/5 transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Custom white hover info — only while collapsed. */}
        {!open && summary && (
          <div className="pointer-events-none absolute left-5 right-5 md:left-6 md:right-6 top-full z-30 -mt-0.5 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
            <div className="rounded-lg border border-line bg-white shadow-xl ring-1 ring-black/5 p-4 text-sm text-ink">
              {summary}
            </div>
          </div>
        )}
      </div>

      {open && <div className={`border-t rounded-b-xl overflow-hidden ${s.border}`}>{children}</div>}
    </div>
  );
}
