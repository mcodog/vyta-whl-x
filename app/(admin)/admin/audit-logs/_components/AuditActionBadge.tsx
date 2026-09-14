import React from "react";
import { describeAction, toneBadgeClass } from "@/lib/admin/auditActions";

/**
 * A colored pill describing an audit action (e.g. "Created" / "Deleted"),
 * tinted by the action's tone. The entity is rendered separately by callers.
 */
export default function AuditActionBadge({
  action,
  entityType,
}: {
  action: string;
  entityType?: string;
}) {
  const desc = describeAction(action, entityType);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneBadgeClass(desc.tone)}`}
    >
      {desc.verbLabel}
    </span>
  );
}
