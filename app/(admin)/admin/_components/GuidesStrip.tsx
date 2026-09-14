'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import { featuredGuides } from '@/lib/admin/guides';

/**
 * A slim, single-row guides strip for the top of the dashboard. Present and
 * discoverable, but deliberately low-focus — a thin bar of links, not a card
 * section. Links into the full wiki at /admin/guides.
 */
export default function GuidesStrip() {
  const guides = featuredGuides(3);
  if (guides.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-white px-4 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
        <BookOpen className="h-3.5 w-3.5 text-bronze" /> Guides
      </span>
      <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
      {guides.map((g) => {
        const Icon = g.icon;
        return (
          <Link
            key={g.slug}
            href={`/admin/guides/${g.slug}`}
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
          >
            <Icon className="h-3.5 w-3.5 text-ink-light" />
            <span className="truncate">{g.title}</span>
          </Link>
        );
      })}
      <Link
        href="/admin/guides"
        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-bronze transition-colors hover:text-bronze-dark"
      >
        All guides <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
