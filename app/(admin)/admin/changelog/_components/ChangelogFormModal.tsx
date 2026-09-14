'use client';

import React, { useState } from 'react';
import { X, AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { ChangelogEntry, ChangelogImpact } from '@/lib/supabase';
import {
  createChangelogEntry,
  updateChangelogEntry,
  CATEGORY_ORDER,
  CATEGORY_META,
  IMPACT_ORDER,
  IMPACT_META,
} from '@/lib/admin/changelog';

interface Props {
  /** When set, the modal edits this entry; otherwise it creates a new one. */
  entry?: ChangelogEntry | null;
  /** Prefilled author (current user's name) for new entries. */
  defaultAuthor?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Convert an ISO timestamp to the value a datetime-local input expects. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ChangelogFormModal({ entry, defaultAuthor, onClose, onSaved }: Props) {
  const editing = !!entry;
  const [category, setCategory] = useState(entry?.category ?? 'feature');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [summary, setSummary] = useState(entry?.summary ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [author, setAuthor] = useState(entry?.author ?? defaultAuthor ?? '');
  const [version, setVersion] = useState(entry?.version ?? '');
  const [impact, setImpact] = useState<ChangelogImpact | ''>(entry?.impact ?? '');
  const [tags, setTags] = useState((entry?.tags ?? []).join(', '));
  const [areas, setAreas] = useState((entry?.affected_areas ?? []).join(', '));
  const [entryDate, setEntryDate] = useState(
    toLocalInput(entry?.entry_date ?? new Date().toISOString()),
  );
  const [links, setLinks] = useState<{ label: string; url: string }[]>(
    entry?.links?.length ? entry.links : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const splitList = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    const payload = {
      category,
      title: title.trim(),
      summary: summary.trim(),
      body: body.trim() || null,
      author: author.trim() || null,
      version: version.trim() || null,
      impact: (impact || null) as ChangelogImpact | null,
      tags: splitList(tags),
      affected_areas: splitList(areas),
      links: links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label || l.url),
      entry_date: entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(),
    };

    setLoading(true);
    try {
      if (editing && entry) {
        await updateChangelogEntry(entry.id, payload);
      } else {
        await createChangelogEntry(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changelog entry.');
      setLoading(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">
            {editing ? 'Edit Changelog Entry' : 'New Changelog Entry'}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              placeholder="Bulk Image Upload Improvements"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Impact</label>
              <select
                value={impact}
                onChange={(e) => setImpact(e.target.value as ChangelogImpact | '')}
                className={inputCls}
              >
                <option value="">None</option>
                {IMPACT_ORDER.map((i) => (
                  <option key={i} value={i}>
                    {IMPACT_META[i].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Version</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className={inputCls}
                placeholder="2.5.1"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Short 2-3 line teaser shown on the card."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Details <span className="text-ink-light font-normal">(markdown)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className={`${inputCls} font-mono text-xs`}
              placeholder={'## Overview\n\nFull details here. Supports **bold**, lists, and [links](https://…).'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className={inputCls}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Tags <span className="text-ink-light font-normal">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={inputCls}
                placeholder="Images, Performance, Admin"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Affected Areas <span className="text-ink-light font-normal">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={areas}
                onChange={(e) => setAreas(e.target.value)}
                className={inputCls}
                placeholder="Products, Checkout"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Related Links</label>
            <div className="space-y-2">
              {links.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={link.label}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))
                    }
                    className={`${inputCls} flex-1`}
                    placeholder="PR #214"
                  />
                  <input
                    type="text"
                    value={link.url}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))
                    }
                    className={`${inputCls} flex-[2]`}
                    placeholder="https://github.com/…"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove link"
                    className="p-2 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { label: '', url: '' }])}
                className="inline-flex items-center gap-1.5 text-sm text-vital hover:text-vital-dark font-medium"
              >
                <Plus className="w-4 h-4" /> Add link
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving…' : editing ? 'Save Changes' : 'Create Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
