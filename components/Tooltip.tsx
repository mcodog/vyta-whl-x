'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';

type Side = 'top' | 'bottom' | 'left' | 'right';

const POSITION: Record<Side, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * Lightweight hover/focus tooltip. Wrap any element; on hover or keyboard focus
 * it reveals `content`. Purely CSS-driven (group-hover / focus-within) so it
 * works without state.
 */
export default function Tooltip({
  content,
  children,
  side = 'top',
  className = '',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex group/tooltip focus-within:z-50 ${className}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[260px] whitespace-normal rounded-lg bg-ink px-3 py-2 text-left text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${POSITION[side]}`}
      >
        {content}
      </span>
    </span>
  );
}

/** A small "?" hint icon that shows a tooltip on hover/focus. */
export function InfoHint({ content, side = 'top' }: { content: React.ReactNode; side?: Side }) {
  return (
    <Tooltip content={content} side={side}>
      <HelpCircle className="w-3.5 h-3.5 text-ink-muted hover:text-ink cursor-help" />
    </Tooltip>
  );
}
