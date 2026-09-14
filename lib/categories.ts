/**
 * Storefront category taxonomy (the `store_categories` table).
 *
 * Categories are edited in the admin backend (/admin/categories) and drive both
 * the /products filter bar and the homepage "Browse by Application" grid. Icons
 * are stored as Lucide icon-name strings and mapped to components here so the DB
 * stays free of React.
 */
import {
  Beaker, TestTube, Heart, Sparkles, Dna, Brain, Zap, Pill, Scale,
  FlaskConical, Microscope, Dumbbell, Activity, Shield, Leaf, Droplet,
  Moon, Sun, Flame, Bone, Atom, HeartPulse,
  type LucideIcon,
} from 'lucide-react';

export interface StoreCategory {
  id: string;
  slug: string;
  name: string;
  home_label: string | null;
  description: string | null;
  icon: string;
  sort_order: number;
  active: boolean;
  featured: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * The Lucide icons an admin can assign to a category. Keys are stored verbatim in
 * `store_categories.icon`. Extend this map to offer more icons in the picker.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Beaker, TestTube, Heart, HeartPulse, Sparkles, Dna, Brain, Zap, Pill, Scale,
  FlaskConical, Microscope, Dumbbell, Activity, Shield, Leaf, Droplet,
  Moon, Sun, Flame, Bone, Atom,
};

export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS);

export const DEFAULT_CATEGORY_ICON = 'Beaker';

/** Resolve a stored icon key to a Lucide component, falling back to Beaker. */
export function getCategoryIcon(key: string | null | undefined): LucideIcon {
  return (key && CATEGORY_ICONS[key]) || Beaker;
}

/**
 * Fetch active storefront categories (public). Used by the /products filter bar.
 * Ordered by sort_order. Never throws — returns [] on any failure so the
 * storefront degrades gracefully to "no category filter" rather than breaking.
 */
export async function getStoreCategories(
  opts: { featuredOnly?: boolean } = {},
): Promise<StoreCategory[]> {
  try {
    const params = new URLSearchParams();
    if (opts.featuredOnly) params.set('featured', '1');
    const qs = params.toString();
    const res = await fetch(`/api/categories${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const { categories } = await res.json();
    return Array.isArray(categories) ? categories : [];
  } catch {
    return [];
  }
}
