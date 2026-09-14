import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Table pagination footer. `page` is 0-indexed. Renders nothing when there's a
 * single page. When `total`/`pageSize` are supplied it also shows the
 * "1–20 of N" range.
 */
export default function Pagination({
  page,
  pageCount,
  onPageChange,
  total,
  pageSize,
}: {
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
  total?: number;
  pageSize?: number;
}) {
  if (pageCount <= 1) return null;
  const hasRange = total != null && pageSize != null;
  const from = hasRange ? page * (pageSize as number) + 1 : null;
  const to = hasRange ? Math.min((page + 1) * (pageSize as number), total as number) : null;

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-line">
      <span className="text-xs text-ink-muted">
        {hasRange ? `${from}–${to} of ${total}` : `Page ${page + 1} of ${pageCount}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line bg-white text-sm text-ink hover:border-ink/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>
        <span className="text-xs text-ink-muted tabular-nums">
          {page + 1} / {pageCount}
        </span>
        <button
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line bg-white text-sm text-ink hover:border-ink/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
