import React, { useState } from "react";
import { ChevronDown, CheckCircle2, RotateCcw, Circle } from "lucide-react";
import type { ErrorEntry } from "@/lib/admin/errorLogs";
import { actorName } from "@/lib/admin/auditLogs";
import { clockTime } from "@/lib/timeAgo";

const METHOD_TONE: Record<string, string> = {
  GET: "text-blue-600",
  POST: "text-emerald-600",
  PATCH: "text-amber-600",
  PUT: "text-amber-600",
  DELETE: "text-red-600",
};

/**
 * One error-log row. Collapsed: status, area, message, route, actor, time.
 * Expanded: full message, stack trace, and a resolve/reopen control.
 */
export default function ErrorRow({
  entry,
  canResolve,
  onToggleResolved,
}: {
  entry: ErrorEntry;
  canResolve: boolean;
  onToggleResolved: (entry: ErrorEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={entry.resolved ? "opacity-70" : ""}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/50 transition-colors"
      >
        {entry.resolved ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <Circle className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" fillOpacity={0.15} />
        )}
        <span className="inline-flex items-center rounded-md bg-surface-2 border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted shrink-0">
          {entry.area}
        </span>
        <span className="min-w-0 flex-1 text-sm text-ink truncate">{entry.message}</span>
        {entry.method && (
          <span className={`hidden sm:inline text-[11px] font-mono font-semibold shrink-0 ${METHOD_TONE[entry.method] ?? "text-ink-muted"}`}>
            {entry.method}
          </span>
        )}
        <span className="hidden md:inline text-xs text-ink-light tabular-nums shrink-0">
          {clockTime(entry.created_at)}
        </span>
        <ChevronDown className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-surface/30 border-t border-line/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Meta label="Route" value={entry.route ?? "—"} mono />
            <Meta label="Status" value={entry.status_code != null ? String(entry.status_code) : "—"} />
            <Meta label="Actor" value={entry.actor ? actorName(entry.actor) : "System"} />
            <Meta label="When" value={new Date(entry.created_at).toLocaleString()} />
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Message</p>
            <p className="text-sm text-ink break-words">{entry.message}</p>
          </div>

          {entry.stack && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Stack trace</p>
              <pre className="text-[11px] leading-relaxed text-ink-muted bg-ink/[0.03] border border-line rounded-lg p-3 overflow-x-auto max-h-64">
                {entry.stack}
              </pre>
            </div>
          )}

          {canResolve && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onToggleResolved(entry)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  entry.resolved
                    ? "border-line bg-white text-ink-muted hover:text-ink"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                {entry.resolved ? (
                  <><RotateCcw className="w-3.5 h-3.5" /> Reopen</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Mark resolved</>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-0.5">{label}</p>
      <p className={`text-ink truncate ${mono ? "font-mono text-[11px]" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}
