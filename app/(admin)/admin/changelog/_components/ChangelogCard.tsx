'use client';

import React from 'react';
import { User, Clock, Tag as TagIcon, ArrowRight, Pencil, Trash2, Layers } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/supabase';
import { categoryBadge, categoryLabel, IMPACT_META } from '@/lib/admin/changelog';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ChangelogCard({
  entry,
  onOpen,
  onEdit,
  onDelete,
  canManage,
}: {
  entry: ChangelogEntry;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  canManage: boolean;
}) {
  const impact = entry.impact ? IMPACT_META[entry.impact] : null;

  return (
    <div className="bg-white border border-line rounded-xl p-5 hover:border-ink/20 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2">
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
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted whitespace-nowrap">
            <Clock className="w-3.5 h-3.5" />
            {formatTime(entry.entry_date)}
          </span>
          {canManage && (
            <>
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label="Edit entry"
                  className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label="Delete entry"
                  className="p-1.5 rounded-md text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <button type="button" onClick={onOpen} className="text-left w-full group">
        <h3 className="text-base font-bold text-ink group-hover:text-vital transition-colors">
          {entry.title}
        </h3>
      </button>

      {entry.summary && (
        <p className="text-sm text-ink-muted leading-relaxed mt-1.5 line-clamp-3">{entry.summary}</p>
      )}

      {entry.affected_areas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 text-xs text-ink-muted">
          <Layers className="w-3.5 h-3.5" />
          {entry.affected_areas.map((area) => (
            <span key={area} className="px-1.5 py-0.5 rounded bg-surface border border-line">
              {area}
            </span>
          ))}
        </div>
      )}

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <TagIcon className="w-3.5 h-3.5 text-ink-light" />
          {entry.tags.map((tag) => (
            <span key={tag} className="text-xs text-vital bg-vital/10 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-line/70">
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <User className="w-3.5 h-3.5" />
          {entry.author || 'Unknown'}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink hover:text-vital transition-colors"
        >
          Read More
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
