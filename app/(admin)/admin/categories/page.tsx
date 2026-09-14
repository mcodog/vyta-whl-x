'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tags, Plus, Trash2, ChevronUp, ChevronDown, Save, X, AlertCircle,
  Eye, EyeOff, Star, GripVertical,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  CATEGORY_ICON_KEYS, DEFAULT_CATEGORY_ICON, getCategoryIcon, type StoreCategory,
} from '@/lib/categories';
import TableSkeleton from '@/components/admin/TableSkeleton';

// Small authed-fetch helper for this page's mutations.
async function authed(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

type Draft = Pick<
  StoreCategory,
  'name' | 'home_label' | 'description' | 'icon' | 'active' | 'featured'
>;

const draftOf = (c: StoreCategory): Draft => ({
  name: c.name,
  home_label: c.home_label,
  description: c.description,
  icon: c.icon,
  active: c.active,
  featured: c.featured,
});

const draftsEqual = (a: Draft, b: Draft) =>
  a.name === b.name &&
  (a.home_label || '') === (b.home_label || '') &&
  (a.description || '') === (b.description || '') &&
  a.icon === b.icon &&
  a.active === b.active &&
  a.featured === b.featured;

export default function AdminCategoriesPage() {
  // Category management is granted to admins and analytics/marketing accounts.
  const { canManageCategories } = usePermissions();
  const canCreate = canManageCategories;
  const canEdit = canManageCategories;
  const canDelete = canManageCategories;
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StoreCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authed('/api/admin/categories');
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const { categories: rows } = await res.json();
      const list: StoreCategory[] = Array.isArray(rows) ? rows : [];
      setCategories(list);
      setDrafts(Object.fromEntries(list.map((c) => [c.id, draftOf(c)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirtyIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) {
      const d = drafts[c.id];
      if (d && !draftsEqual(d, draftOf(c))) set.add(c.id);
    }
    return set;
  }, [categories, drafts]);

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveRow = async (c: StoreCategory) => {
    const d = drafts[c.id];
    if (!d) return;
    setSavingId(c.id);
    setError('');
    try {
      const res = await authed(`/api/admin/categories/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify(d),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: '' }));
        throw new Error(msg || `Save failed (${res.status})`);
      }
      const { category } = await res.json();
      setCategories((prev) => prev.map((x) => (x.id === c.id ? category : x)));
      setDrafts((prev) => ({ ...prev, [c.id]: draftOf(category) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  // Move a row up/down and persist the whole new order immediately.
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    try {
      const res = await authed('/api/admin/categories', {
        method: 'PUT',
        body: JSON.stringify({ order: next.map((c) => c.id) }),
      });
      if (!res.ok) throw new Error(`Reorder failed (${res.status})`);
      // Reflect the new sort_order locally without a full reload.
      setCategories(next.map((c, i) => ({ ...c, sort_order: i + 1 })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed');
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      const res = await authed(`/api/admin/categories/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const readOnly = !canEdit;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <Tags className="w-6 h-6 text-vital" /> Categories
          </h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Control the storefront category taxonomy — rename, reorder, re-icon, show/hide,
            and choose which appear on the homepage. Drives the <code className="text-xs">/products</code>{' '}
            filter and the homepage grid.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Add Category
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      {readOnly && !loading && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700">Read-only access — contact an administrator to make changes.</p>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">All Categories</h2>
          <span className="text-sm text-ink-muted">{categories.length} total</span>
        </div>

        {loading ? (
          <div className="p-5">
            <table className="w-full"><tbody><TableSkeleton rows={6} cols={4} /></tbody></table>
          </div>
        ) : categories.length === 0 ? (
          <div className="px-5 py-12 text-center text-ink-muted text-sm">No categories yet.</div>
        ) : (
          <ul className="divide-y divide-line/60">
            {categories.map((c, index) => {
              const d = drafts[c.id] ?? draftOf(c);
              const Icon = getCategoryIcon(d.icon);
              const dirty = dirtyIds.has(c.id);
              return (
                <li key={c.id} className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    {/* Reorder controls */}
                    <div className="flex flex-col items-center pt-1">
                      <button
                        onClick={() => move(index, -1)}
                        disabled={readOnly || index === 0}
                        title="Move up"
                        className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <GripVertical className="w-4 h-4 text-line" />
                      <button
                        onClick={() => move(index, 1)}
                        disabled={readOnly || index === categories.length - 1}
                        title="Move down"
                        className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Icon preview */}
                    <div className="shrink-0 w-11 h-11 rounded-lg bg-ink flex items-center justify-center mt-0.5">
                      <Icon className="w-5 h-5 text-white" />
                    </div>

                    {/* Fields */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-ink-muted mb-1">Name (filter label)</label>
                        <input
                          value={d.name}
                          disabled={readOnly}
                          onChange={(e) => patchDraft(c.id, { name: e.target.value })}
                          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-60"
                        />
                        <p className="text-[11px] text-ink-light mt-1 truncate">
                          slug: <span className="font-mono">{c.slug}</span>
                        </p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-ink-muted mb-1">Icon</label>
                        <select
                          value={CATEGORY_ICON_KEYS.includes(d.icon) ? d.icon : DEFAULT_CATEGORY_ICON}
                          disabled={readOnly}
                          onChange={(e) => patchDraft(c.id, { icon: e.target.value })}
                          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-60"
                        >
                          {CATEGORY_ICON_KEYS.map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-ink-muted mb-1">Homepage label <span className="text-ink-light font-normal">(optional)</span></label>
                        <input
                          value={d.home_label ?? ''}
                          disabled={readOnly}
                          onChange={(e) => patchDraft(c.id, { home_label: e.target.value })}
                          placeholder={d.name}
                          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-ink-muted mb-1">Homepage subtitle <span className="text-ink-light font-normal">(optional)</span></label>
                        <input
                          value={d.description ?? ''}
                          disabled={readOnly}
                          onChange={(e) => patchDraft(c.id, { description: e.target.value })}
                          placeholder="e.g., GLP-1 Agonists"
                          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-60"
                        />
                      </div>
                    </div>

                    {/* Toggles + actions */}
                    <div className="flex flex-col items-end gap-2 pl-1">
                      <button
                        onClick={() => patchDraft(c.id, { active: !d.active })}
                        disabled={readOnly}
                        title={d.active ? 'Visible in products filter' : 'Hidden from products filter'}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-60 ${
                          d.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-ink-light/10 text-ink-muted'
                        }`}
                      >
                        {d.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {d.active ? 'Active' : 'Hidden'}
                      </button>
                      <button
                        onClick={() => patchDraft(c.id, { featured: !d.featured })}
                        disabled={readOnly}
                        title={d.featured ? 'Shown on homepage grid' : 'Not on homepage grid'}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-60 ${
                          d.featured ? 'bg-vital/10 text-vital' : 'bg-ink-light/10 text-ink-muted'
                        }`}
                      >
                        <Star className={`w-3.5 h-3.5 ${d.featured ? 'fill-vital' : ''}`} />
                        {d.featured ? 'Homepage' : 'Off'}
                      </button>
                      <div className="flex items-center gap-1.5 mt-1">
                        {canEdit && (
                          <button
                            onClick={() => saveRow(c)}
                            disabled={!dirty || savingId === c.id}
                            title="Save changes"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ink text-white hover:bg-ink/90 transition-colors disabled:opacity-40"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {savingId === c.id ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(c)}
                            title="Delete category"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateCategoryModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-ink mb-2">Delete category?</h2>
            <p className="text-sm text-ink-muted mb-5">
              Remove <span className="font-semibold text-ink">{deleteTarget.name}</span> from the storefront?
              Products in this category keep their tag but the category stops appearing in the filter and homepage.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CreateCategoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [homeLabel, setHomeLabel] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState(DEFAULT_CATEGORY_ICON);
  const [featured, setFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const Icon = getCategoryIcon(icon);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!slug.trim() || !name.trim()) {
      setError('Slug and name are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await authed('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          home_label: homeLabel.trim() || null,
          description: description.trim() || null,
          icon,
          featured,
          active: true,
        }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: '' }));
        throw new Error(msg || `Create failed (${res.status})`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">Add Category</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Slug * <span className="text-ink-muted font-normal">(must match products&apos; category value)</span></label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g., Weight Loss / Metabolic"
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Name * <span className="text-ink-muted font-normal">(filter label)</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Metabolic"
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Homepage label</label>
              <input
                value={homeLabel}
                onChange={(e) => setHomeLabel(e.target.value)}
                placeholder={name || 'optional'}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Icon</label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 w-9 h-9 rounded-lg bg-ink flex items-center justify-center">
                  <Icon className="w-4 h-4 text-white" />
                </span>
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                >
                  {CATEGORY_ICON_KEYS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Homepage subtitle</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., GLP-1 Agonists"
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="rounded border-line accent-vital" />
            <span className="text-sm text-ink">Show on homepage grid</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
