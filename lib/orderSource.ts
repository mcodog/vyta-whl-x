/**
 * Maps an order's raw `source` value (how the order was created) to a
 * human-friendly tag label shown in the admin. Orders created by the WhatsApp
 * bot are surfaced as "Claude Agent".
 */
const SOURCE_LABELS: Record<string, string> = {
  whatsapp_bot: "Claude Agent",
  stealth_health: "Stealth Health",
};

export function sourceLabel(source?: string | null): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Tailwind classes for the source tag badge. WhatsApp/Claude Agent orders get
 * a distinct emerald tag; everything else falls back to a neutral style.
 */
export function sourceBadgeClasses(source?: string | null): string {
  if (source === "whatsapp_bot") {
    return "bg-emerald-500/10 text-emerald-500";
  }
  if (source === "stealth_health") {
    return "bg-violet-500/10 text-violet-600";
  }
  return "bg-surface text-ink-muted";
}

/**
 * Why a Stealth Health order is missing invoice fields a normal order would
 * have (customer name/phone, shipping address, pricing details): Stealth Health
 * runs the hosted checkout and collects/owns those. Used as a tooltip in the
 * warehouse queue.
 */
export const STEALTH_HEALTH_MISSING_INFO_TOOLTIP =
  "This order was placed through Stealth Health (hosted checkout). Customer details, shipping address, and pricing are collected and managed by Stealth Health, so they aren't shown here.";
