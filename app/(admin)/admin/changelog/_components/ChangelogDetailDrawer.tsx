'use client';

import React, { useEffect } from 'react';
import { X, User, Calendar, Tag as TagIcon, Layers, LinkIcon, Pencil, Trash2 } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/supabase';
import { categoryBadge, categoryLabel, IMPACT_META } from '@/lib/admin/changelog';
import Markdown from './Markdown';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Slide-in drawer showing the full details of a changelog entry without
 * navigating away, keeping the timeline in context behind it.
 */
export default function ChangelogDetailDrawer({
  entry,
  onClose,
  onEdit,
  onDelete,
  canManage,
}: {
  entry: ChangelogEntry;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  canManage: boolean;
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const impact = entry.impact ? IMPACT_META[entry.impact] : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 bg-white border-b border-line px-6 py-4 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${categoryBadge(entry.category)}`}>
              {categoryLabel(entry.category)}
            </span>
            {impact && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${impact.badge}`}>
                {impact.label}
              </span>
            )}
            {entry.version && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface border border-line text-ink-muted">
                v{entry.version}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canManage && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit entry"
                className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {canManage && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete entry"
                className="p-1.5 rounded-md text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <h2 className="text-xl font-bold text-ink">{entry.title}</h2>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <User className="w-4 h-4" />
              {entry.author || 'Unknown'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatDateTime(entry.entry_date)} · {formatTime(entry.entry_date)}
            </span>
          </div>

          {entry.affected_areas.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Affected Areas
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {entry.affected_areas.map((area) => (
                  <span key={area} className="px-2 py-1 rounded-md bg-surface border border-line text-xs text-ink">
                    {area}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-2">
              Description
            </h3>
            {entry.body ? (
              <Markdown text={entry.body} />
            ) : entry.summary ? (
              <p className="text-sm text-ink-muted leading-relaxed">{entry.summary}</p>
            ) : (
              <p className="text-sm text-ink-light italic">No additional details.</p>
            )}
          </div>

          {entry.tags.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-2 flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5" /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span key={tag} className="text-xs text-bronze bg-bronze/10 px-2.5 py-1 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {entry.links.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-2 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" /> Related Links
              </h3>
              <div className="flex flex-col gap-1.5">
                {entry.links.map((link, i) => {
                  const safe = /^(https?:|mailto:|\/)/i.test(link.url) ? link.url : null;
                  return safe ? (
                    <a
                      key={i}
                      href={safe}
                      target={safe.startsWith('http') ? '_blank' : undefined}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-bronze hover:text-bronze-dark underline underline-offset-2 w-fit"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      {link.label}
                    </a>
                  ) : (
                    <span key={i} className="text-sm text-ink-muted">{link.label}</span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
