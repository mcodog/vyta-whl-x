'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Clock, ArrowRight, BookOpen } from 'lucide-react';
import { getGuide, guides } from '@/lib/admin/guides';

/**
 * Guide reader — renders a single how-to. Content is static (no fetch), so this
 * is instant. Unknown slugs get a friendly not-found rather than an error.
 */
export default function GuideReaderPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const guide = slug ? getGuide(slug) : undefined;

  if (!guide) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-ink-muted">
          <BookOpen className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-ink">Guide not found</h1>
        <p className="mt-1 text-sm text-ink-muted">
          That guide doesn&rsquo;t exist or has been moved.
        </p>
        <Link
          href="/admin/guides"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ink/90"
        >
          <ArrowLeft className="h-4 w-4" /> All guides
        </Link>
      </div>
    );
  }

  const Icon = guide.icon;
  const others = guides.filter((g) => g.slug !== guide.slug);

  return (
    <article className="mx-auto max-w-2xl">
      {/* Back */}
      <Link
        href="/admin/guides"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All guides
      </Link>

      {/* Header */}
      <header className="mb-8 border-b border-line pb-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-vital/10 text-vital">
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-vital">
            {guide.category}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-ink sm:text-[28px]">{guide.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-light">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {guide.readingTime} read
          </span>
          <span>Updated {new Date(`${guide.updated}T00:00:00`).toLocaleDateString()}</span>
        </div>
      </header>

      {/* Body */}
      <div className="rounded-xl border border-line bg-white p-6 md:p-8">
        <guide.Body />
      </div>

      {/* Other guides */}
      {others.length > 0 && (
        <footer className="mt-10">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light">
            Keep reading
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {others.map((g) => {
              const OIcon = g.icon;
              return (
                <Link
                  key={g.slug}
                  href={`/admin/guides/${g.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-white p-4 transition-all hover:border-vital/40 hover:shadow-sm"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vital/10 text-vital">
                    <OIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{g.title}</span>
                    <span className="block truncate text-xs text-ink-muted">{g.summary}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-light transition-colors group-hover:text-vital" />
                </Link>
              );
            })}
          </div>
        </footer>
      )}
    </article>
  );
}
