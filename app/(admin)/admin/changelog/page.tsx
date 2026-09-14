'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Filter, X, CalendarDays, ListFilter, History, FileText } from 'lucide-react';
import type { ChangelogEntry } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import {
  getChangelogEntries,
  deleteChangelogEntry,
  CATEGORY_ORDER,
  CATEGORY_META,
  categoryDot,
  IMPACT_ORDER,
  IMPACT_META,
} from '@/lib/admin/changelog';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canCreate, canEdit, canDelete } from '@/lib/permissions';
import { groupByDay, localDayKey } from '@/lib/dayGroups';
import Pagination from '@/components/admin/Pagination';
import ConfirmDeleteDialog from '@/components/admin/ConfirmDeleteDialog';
import ChangelogCard from './_components/ChangelogCard';
import ChangelogCalendar from './_components/ChangelogCalendar';
import ChangelogDetailDrawer from './_components/ChangelogDetailDrawer';
import ChangelogFormModal from './_components/ChangelogFormModal';
import ChangelogReportModal from './_components/ChangelogReportModal';

/** Validate a `YYYY-MM-DD` day key. */
function isValidDayKey(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

const PAGE_SIZE = 10;

export default function AdminChangelog() {
  const role = useUserRole();
  const canManage = canCreate(role) || canEdit(role) || canDelete(role);

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserName, setCurrentUserName] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [author, setAuthor] = useState('all');
  const [impact, setImpact] = useState('all');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Modals
  const [detailEntry, setDetailEntry] = useState<ChangelogEntry | null>(null);
  const [formEntry, setFormEntry] = useState<ChangelogEntry | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChangelogEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showReport, setShowReport] = useState(false);

  // Set the day filter and mirror it in the URL (?date=YYYY-MM-DD) so the view
  // is shareable/deep-linkable. Passing null clears both.
  const changeSelectedDay = (day: string | null) => {
    setSelectedDay(day);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (day) url.searchParams.set('date', day);
    else url.searchParams.delete('date');
    window.history.replaceState({}, '', url);
  };

  // On mount, honor a ?date=YYYY-MM-DD deep link by pre-applying the day filter.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search).get('date');
    if (isValidDayKey(param)) setSelectedDay(param);
  }, []);

  const load = () => {
    setLoading(true);
    getChangelogEntries()
      .then(setEntries)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Fetch the current user's display name to prefill the author field.
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('customers')
          .select('first_name, last_name')
          .eq('id', user.id)
          .single();
        if (data) {
          setCurrentUserName(`${data.first_name ?? ''} ${data.last_name ?? ''}`.trim());
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const authors = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (e.author?.trim()) set.add(e.author.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const daysWithEntries = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(localDayKey(e.entry_date)));
    return set;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (selectedCategories.size > 0 && !selectedCategories.has(e.category)) return false;
      if (author !== 'all' && (e.author?.trim() || '') !== author) return false;
      if (impact !== 'all' && (e.impact || '') !== impact) return false;
      if (selectedDay && localDayKey(e.entry_date) !== selectedDay) return false;
      if (q) {
        const haystack = [
          e.title,
          e.summary,
          e.body ?? '',
          e.tags.join(' '),
          e.affected_areas.join(' '),
          e.author ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, selectedCategories, author, impact, selectedDay]);

  // Reset to the first page whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [search, selectedCategories, author, impact, selectedDay]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const dayGroups = useMemo(() => groupByDay(paged, (e) => e.entry_date), [paged]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const activeFilterCount =
    selectedCategories.size + (author !== 'all' ? 1 : 0) + (impact !== 'all' ? 1 : 0) + (selectedDay ? 1 : 0);

  const clearFilters = () => {
    setSelectedCategories(new Set());
    setAuthor('all');
    setImpact('all');
    changeSelectedDay(null);
    setSearch('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteChangelogEntry(deleteTarget.id);
      setDeleteTarget(null);
      setDetailEntry(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete entry.');
    } finally {
      setDeleting(false);
    }
  };

  const sidebar = (
    <div className="space-y-6">
      {/* Calendar */}
      <div className="bg-white border border-line rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-3 flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5" /> Calendar
        </h3>
        <ChangelogCalendar
          daysWithEntries={daysWithEntries}
          selectedDay={selectedDay}
          onSelectDay={changeSelectedDay}
        />
      </div>

      {/* Categories */}
      <div className="bg-white border border-line rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-3">Categories</h3>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategories(new Set())}
            className={`flex items-center gap-2 w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
              selectedCategories.size === 0 ? 'bg-surface text-ink font-medium' : 'text-ink-muted hover:bg-surface'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-ink" />
            All Categories
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const checked = selectedCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-2 w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
                  checked ? 'bg-surface text-ink font-medium' : 'text-ink-muted hover:bg-surface'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${categoryDot(cat)}`} />
                {CATEGORY_META[cat].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Author */}
      <div className="bg-white border border-line rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-3">Author</h3>
        <select
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
        >
          <option value="all">Everyone</option>
          {authors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Importance */}
      <div className="bg-white border border-line rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-light mb-3">Importance</h3>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setImpact('all')}
            className={`block w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
              impact === 'all' ? 'bg-surface text-ink font-medium' : 'text-ink-muted hover:bg-surface'
            }`}
          >
            All
          </button>
          {IMPACT_ORDER.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setImpact(i)}
              className={`block w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
                impact === i ? 'bg-surface text-ink font-medium' : 'text-ink-muted hover:bg-surface'
              }`}
            >
              {IMPACT_META[i].label}
            </button>
          ))}
        </div>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={clearFilters}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 transition-colors"
        >
          <X className="w-4 h-4" /> Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <History className="w-5 h-5 text-bronze" />
          <h1 className="text-xl font-bold text-ink">Changelog</h1>
        </div>
        <p className="text-sm text-ink-muted">
          A chronological record of platform updates, fixes and new features.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or content…"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setMobileFiltersOpen((o) => !o)}
          className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line rounded-lg text-sm font-medium text-ink"
        >
          <Filter className="w-4 h-4" /> Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-ink text-white text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowReport(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line rounded-lg text-sm font-medium text-ink hover:border-ink/30 transition-colors"
        >
          <FileText className="w-4 h-4" /> Create Report
        </button>
        {canCreate(role) && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Changelog
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <aside className={`${mobileFiltersOpen ? 'block' : 'hidden'} lg:block w-full lg:w-64 shrink-0`}>
          {sidebar}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-line rounded-xl p-5 animate-pulse">
                  <div className="h-5 w-24 bg-surface rounded-full mb-3" />
                  <div className="h-5 w-2/3 bg-surface rounded mb-2" />
                  <div className="h-4 w-full bg-surface rounded mb-1.5" />
                  <div className="h-4 w-4/5 bg-surface rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-line rounded-xl p-12 text-center">
              <ListFilter className="w-8 h-8 text-ink-light mx-auto mb-3" />
              <p className="text-sm font-medium text-ink mb-1">No changelog entries found</p>
              <p className="text-sm text-ink-muted">
                {entries.length === 0
                  ? 'Create your first changelog entry to get started.'
                  : 'Try adjusting your search or filters.'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm text-bronze hover:text-bronze-dark font-medium"
                >
                  <X className="w-4 h-4" /> Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-8">
                {dayGroups.map((group) => (
                  <div key={group.key}>
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-sm font-bold text-ink whitespace-nowrap">{group.label}</h2>
                      <span className="text-xs text-ink-muted">
                        {group.items.length} {group.items.length === 1 ? 'update' : 'updates'}
                      </span>
                      <div className="flex-1 h-px bg-line" />
                    </div>
                    <div className="space-y-4">
                      {group.items.map((entry) => (
                        <ChangelogCard
                          key={entry.id}
                          entry={entry}
                          canManage={canManage}
                          onOpen={() => setDetailEntry(entry)}
                          onEdit={canEdit(role) ? () => setFormEntry(entry) : undefined}
                          onDelete={canDelete(role) ? () => setDeleteTarget(entry) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 bg-white border border-line rounded-xl">
                <Pagination
                  page={safePage}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                />
              </div>
            </>
          )}
        </main>
      </div>

      {/* Create Report */}
      {showReport && (
        <ChangelogReportModal
          entries={entries}
          daysWithEntries={daysWithEntries}
          initialDay={selectedDay}
          onClose={() => setShowReport(false)}
          onOpenFiltered={(day) => {
            changeSelectedDay(day);
            setShowReport(false);
          }}
        />
      )}

      {/* Detail drawer */}
      {detailEntry && (
        <ChangelogDetailDrawer
          entry={detailEntry}
          canManage={canManage}
          onClose={() => setDetailEntry(null)}
          onEdit={
            canEdit(role)
              ? () => {
                  setFormEntry(detailEntry);
                  setDetailEntry(null);
                }
              : undefined
          }
          onDelete={canDelete(role) ? () => setDeleteTarget(detailEntry) : undefined}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <ChangelogFormModal
          defaultAuthor={currentUserName}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* Edit modal */}
      {formEntry && (
        <ChangelogFormModal
          entry={formEntry}
          defaultAuthor={currentUserName}
          onClose={() => setFormEntry(null)}
          onSaved={() => {
            setFormEntry(null);
            load();
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title="Delete Changelog Entry"
          message={
            <>
              Delete <span className="font-semibold text-ink">{deleteTarget.title}</span>? This cannot be
              undone.
            </>
          }
          loading={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
        />
      )}
    </>
  );
}
