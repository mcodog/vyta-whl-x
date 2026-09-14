/**
 * Presentation helpers for audit-log rows.
 *
 * Audit `action` strings follow an `<entity>.<verb>` convention (e.g.
 * "customer.create", "invoice.payment"). Rather than enumerate every possible
 * action, we describe them generically from the verb, with a small table of
 * overrides for verbs whose plain name isn't self-explanatory. This keeps the
 * UI correct as new actions are wired into routes without further edits here.
 */

export type ActionTone = "create" | "update" | "delete" | "neutral" | "warn";

interface VerbMeta {
  label: string;
  tone: ActionTone;
}

// Verb -> human label + tone. Keys are the trailing segment of an action.
const VERB_META: Record<string, VerbMeta> = {
  create: { label: "Created", tone: "create" },
  update: { label: "Updated", tone: "update" },
  delete: { label: "Deleted", tone: "delete" },
  payment: { label: "Recorded payment", tone: "create" },
  undraft: { label: "Finalized", tone: "update" },
  email_sent: { label: "Sent email", tone: "neutral" },
  fulfillment_update: { label: "Updated fulfillment", tone: "update" },
  handling_checklist_update: { label: "Updated checklist", tone: "update" },
  line_fulfill: { label: "Fulfilled line", tone: "update" },
  line_backorder: { label: "Backordered line", tone: "warn" },
  handle: { label: "Marked handled", tone: "update" },
  reopen: { label: "Reopened", tone: "update" },
  receive: { label: "Received stock", tone: "create" },
  send: { label: "Sent", tone: "neutral" },
  create_shipment: { label: "Created shipment", tone: "create" },
  buy_label: { label: "Bought shipping label", tone: "create" },
  address_update: { label: "Updated address", tone: "update" },
  image_add: { label: "Added image", tone: "create" },
  image_remove: { label: "Removed image", tone: "delete" },
  certificate_add: { label: "Added certificate", tone: "create" },
  certificate_remove: { label: "Removed certificate", tone: "delete" },
  packed_photo_add: { label: "Added packing photo", tone: "create" },
  packed_photo_remove: { label: "Removed packing photo", tone: "delete" },
  status_update: { label: "Changed status", tone: "update" },
  import: { label: "Imported", tone: "create" },
  export: { label: "Exported", tone: "neutral" },
  resolve: { label: "Resolved", tone: "update" },
  takeover: { label: "Took over account", tone: "warn" },
  release: { label: "Released account", tone: "update" },
  magic_link: { label: "Sent magic link", tone: "neutral" },
  password_reset: { label: "Sent password reset", tone: "neutral" },
  notify: { label: "Sent notification", tone: "neutral" },
  approve: { label: "Approved", tone: "create" },
  reject: { label: "Rejected", tone: "delete" },
  activate: { label: "Activated", tone: "create" },
  deactivate: { label: "Deactivated", tone: "warn" },
};

// entity_type -> friendly singular label. Falls back to a title-cased version.
const ENTITY_LABELS: Record<string, string> = {
  changelog_entry: "Changelog entry",
  invoice: "Invoice",
  pricelist: "Price list",
  price_override: "Price override",
  customer: "Customer",
  user: "User",
  product: "Product",
  sales_person: "Sales person",
  supplier: "Supplier",
  supplier_price: "Supplier price",
  affiliate: "Affiliate",
  affiliate_request: "Affiliate request",
  lab_result: "Lab result",
  backorder: "Backorder",
  settings: "Settings",
  purchase_order: "Purchase order",
  stock_notification: "Stock notification",
  order: "Order",
  warehouse_queue: "Warehouse job",
  error_log: "Error log",
  shipment_log: "Shipment log",
  stock_report: "Stock report",
};

function titleCase(s: string): string {
  return s
    .replace(/[_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Friendly label for an entity_type. */
export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? titleCase(entityType);
}

/** The verb segment of an action string ("customer.create" -> "create"). */
export function actionVerb(action: string): string {
  const idx = action.lastIndexOf(".");
  return idx >= 0 ? action.slice(idx + 1) : action;
}

export interface ActionDescription {
  /** e.g. "Created" */
  verbLabel: string;
  /** e.g. "Customer" */
  entityLabel: string;
  /** e.g. "Created customer" */
  full: string;
  tone: ActionTone;
}

/**
 * Describe an audit action for display. `entityType` is used for the entity
 * label; when omitted it's derived from the action prefix.
 */
export function describeAction(action: string, entityType?: string): ActionDescription {
  const verb = actionVerb(action);
  const meta = VERB_META[verb] ?? { label: titleCase(verb), tone: "neutral" as ActionTone };
  const prefix = entityType ?? (action.includes(".") ? action.slice(0, action.lastIndexOf(".")) : action);
  const entity = entityLabel(prefix);
  return {
    verbLabel: meta.label,
    entityLabel: entity,
    full: `${meta.label} ${entity.toLowerCase()}`,
    tone: meta.tone,
  };
}

/** Tailwind classes (bg + text) for an action tone badge. */
export function toneBadgeClass(tone: ActionTone): string {
  switch (tone) {
    case "create":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "update":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "delete":
      return "bg-red-50 text-red-700 border-red-200";
    case "warn":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-surface-2 text-ink-muted border-line";
  }
}

/** A short dot color for an action tone (used in compact lists). */
export function toneDotClass(tone: ActionTone): string {
  switch (tone) {
    case "create":
      return "bg-emerald-500";
    case "update":
      return "bg-blue-500";
    case "delete":
      return "bg-red-500";
    case "warn":
      return "bg-amber-500";
    default:
      return "bg-ink-light";
  }
}
