'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, Clock } from 'lucide-react';
import { guides, type Guide } from '@/lib/admin/guides';

/**
 * Guides index — the internal how-to wiki. Lists every guide as a card,
 * grouped by category. Palette-consistent: white cards on surface, vital as
 * the single accent, no color-filled boxes.
 */
export default function GuidesIndexPage() {
  // Group guides by their category, preserving registry order.
  const groups = guides.reduce<Record<string, Guide[]>>((acc, g) => {
    (acc[g.category] ??= []).push(g);
    return acc;
  }, {});

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-vital/10 text-vital">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Guides &amp; How-tos</h1>
          <p className="text-sm text-ink-muted">
            Short walkthroughs for running the back office. More get added over time.
          </p>
        </div>
      </div>

      {Object.entries(groups).map(([category, items]) => (
        <section key={category} className="mb-9">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light">
            {category}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((g) => (
              <GuideCard key={g.slug} guide={g} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  return (
    <Link
      href={`/admin/guides/${guide.slug}`}
      className="group flex flex-col rounded-xl border border-line bg-white p-5 transition-all hover:border-vital/40 hover:shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-vital/10 text-vital">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-ink-light transition-colors group-hover:text-vital" />
      </div>
      <h3 className="text-base font-bold text-ink">{guide.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-muted">{guide.summary}</p>
      <div className="mt-4 flex items-center gap-1.5 text-xs text-ink-light">
        <Clock className="h-3.5 w-3.5" />
        {guide.readingTime} read
      </div>
    </Link>
  );
}
