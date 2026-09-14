import React from "react";
import Link from "next/link";
import { ArrowRight, Activity } from "lucide-react";
import type { AuditCard } from "@/lib/admin/auditLogs";
import { actorName, actorInitials } from "@/lib/admin/auditLogs";
import { describeAction, toneDotClass } from "@/lib/admin/auditActions";
import { timeAgo } from "@/lib/timeAgo";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  assistant: "Assistant",
  affiliate: "Client",
  warehouse: "Warehouse",
};

/**
 * Card-view tile for a single admin: avatar + identity, how many actions they
 * took today, their three most recent actions, and a link to their full,
 * paginated activity page.
 */
export default function AdminAuditCard({ card }: { card: AuditCard }) {
  const name = actorName(card.actor);
  const role = card.actor.role ?? "";

  return (
    <div className="flex flex-col rounded-xl border border-line bg-white shadow-sm overflow-hidden">
      {/* Identity header */}
      <div className="flex items-center gap-3 p-4 border-b border-line/70">
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-vital/15 text-vital-dark font-semibold text-sm shrink-0">
          {actorInitials(card.actor)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate">{name}</p>
          <p className="text-xs text-ink-muted truncate">
            {ROLE_LABEL[role] ?? (role || "—")}
            {card.actor.email ? ` · ${card.actor.email}` : ""}
          </p>
        </div>
      </div>

      {/* Today's activity count */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface/50">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-vital" />
          <span className="text-xs text-ink-muted">Actions today</span>
        </div>
        <span className="text-2xl font-bold text-ink tabular-nums leading-none">
          {card.today_actions}
        </span>
      </div>

      {/* Latest 3 actions */}
      <div className="flex-1 px-4 py-3 space-y-2.5">
        {card.recent.length === 0 ? (
          <p className="text-xs text-ink-light italic py-2">No recorded activity yet.</p>
        ) : (
          card.recent.map((r) => {
            const desc = describeAction(r.action, r.entity_type);
            return (
              <div key={r.id} className="flex items-start gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${toneDotClass(desc.tone)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink truncate">
                    <span className="font-medium">{desc.verbLabel}</span>{" "}
                    <span className="text-ink-muted">{desc.entityLabel.toLowerCase()}</span>
                  </p>
                </div>
                <span className="text-[11px] text-ink-light shrink-0 tabular-nums">
                  {timeAgo(r.created_at)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: totals + link to full history */}
      <Link
        href={`/admin/audit-logs/${card.actor.id}`}
        className="flex items-center justify-between px-4 py-3 border-t border-line/70 text-sm text-ink-muted hover:text-ink hover:bg-surface/60 transition-colors"
      >
        <span className="text-xs">
          <span className="font-semibold text-ink tabular-nums">{card.total_actions}</span> total
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-vital-dark">
          Show more <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>
    </div>
  );
}
