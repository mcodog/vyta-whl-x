import { supabase } from "@/lib/supabase";
import type {
  ChangelogEntry,
  ChangelogCategory,
  ChangelogImpact,
} from "@/lib/supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      }
    : { "Content-Type": "application/json" };
}

/**
 * Presentation metadata for each category. Badge classes follow the admin
 * convention of `bg-<color>/10 text-<color>` used elsewhere in the panel.
 */
export const CATEGORY_META: Record<
  ChangelogCategory,
  { label: string; badge: string; dot: string }
> = {
  admin: { label: "Admin", badge: "bg-blue-500/10 text-blue-500", dot: "bg-blue-500" },
  storefront: { label: "Storefront", badge: "bg-emerald-500/10 text-emerald-500", dot: "bg-emerald-500" },
  feature: { label: "Feature", badge: "bg-purple-500/10 text-purple-500", dot: "bg-purple-500" },
  patch: { label: "Patch", badge: "bg-gray-500/10 text-ink-muted", dot: "bg-gray-400" },
  bugfix: { label: "Bug Fix", badge: "bg-red-500/10 text-red-500", dot: "bg-red-500" },
  performance: { label: "Performance", badge: "bg-cyan-500/10 text-cyan-500", dot: "bg-cyan-500" },
  security: { label: "Security", badge: "bg-orange-500/10 text-orange-500", dot: "bg-orange-500" },
  api: { label: "API", badge: "bg-indigo-500/10 text-indigo-500", dot: "bg-indigo-500" },
  database: { label: "Database", badge: "bg-amber-500/10 text-amber-600", dot: "bg-amber-500" },
  ui: { label: "UI", badge: "bg-pink-500/10 text-pink-500", dot: "bg-pink-500" },
  mobile: { label: "Mobile", badge: "bg-teal-500/10 text-teal-500", dot: "bg-teal-500" },
};

/** Ordered list of categories for filters and the create form. */
export const CATEGORY_ORDER: ChangelogCategory[] = [
  "admin",
  "storefront",
  "feature",
  "patch",
  "bugfix",
  "performance",
  "security",
  "api",
  "database",
  "ui",
  "mobile",
];

export function categoryLabel(category: string): string {
  return CATEGORY_META[category as ChangelogCategory]?.label ?? category;
}

export function categoryBadge(category: string): string {
  return CATEGORY_META[category as ChangelogCategory]?.badge ?? "bg-gray-500/10 text-ink-muted";
}

export function categoryDot(category: string): string {
  return CATEGORY_META[category as ChangelogCategory]?.dot ?? "bg-gray-400";
}

/** Impact levels, most severe first, with badge classes. */
export const IMPACT_META: Record<ChangelogImpact, { label: string; badge: string }> = {
  critical: { label: "Critical", badge: "bg-red-500/10 text-red-500" },
  major: { label: "Major", badge: "bg-amber-500/10 text-amber-600" },
  minor: { label: "Minor", badge: "bg-gray-500/10 text-ink-muted" },
};

export const IMPACT_ORDER: ChangelogImpact[] = ["critical", "major", "minor"];

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  const { data, error } = await supabase
    .from("changelog_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) {
    console.error("getChangelogEntries error:", error);
    return [];
  }
  return (data ?? []) as ChangelogEntry[];
}

export type ChangelogInput = {
  category: string;
  title: string;
  summary: string;
  body: string | null;
  author: string | null;
  version: string | null;
  impact: ChangelogImpact | null;
  tags: string[];
  affected_areas: string[];
  links: { label: string; url: string }[];
  entry_date: string;
};

export async function createChangelogEntry(
  input: Partial<ChangelogInput> & { title: string },
): Promise<ChangelogEntry> {
  const res = await fetch("/api/admin/changelog", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create changelog entry");
  }
  const { entry } = await res.json();
  return entry;
}

export async function updateChangelogEntry(
  id: string,
  patch: Partial<ChangelogInput>,
): Promise<ChangelogEntry> {
  const res = await fetch(`/api/admin/changelog/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update changelog entry");
  }
  const { entry } = await res.json();
  return entry;
}

export async function deleteChangelogEntry(id: string): Promise<void> {
  const res = await fetch(`/api/admin/changelog/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete changelog entry");
  }
}
