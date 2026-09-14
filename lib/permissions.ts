/**
 * Permission utilities for role-based access control
 */

export type UserRole = 'customer' | 'affiliate' | 'assistant' | 'admin' | 'warehouse' | 'analytics';

/**
 * Check if user can access the admin dashboard area.
 * Affiliates get a minimized version (see canAccessAdminPage). Analytics accounts
 * get an even more minimal one — only Analytics + Products (see ANALYTICS_PAGES).
 * Warehouse staff have their own area (/warehouse) and are NOT admitted here.
 */
export function canAccessAdmin(role: UserRole): boolean {
  return role === 'admin' || role === 'assistant' || role === 'affiliate' || role === 'analytics';
}

/**
 * Check if user can access the warehouse/fulfillment area (/warehouse).
 * Warehouse staff handle packaging and shipping; admins can see it too.
 */
export function canAccessWarehouse(role: UserRole): boolean {
  return role === 'warehouse' || role === 'admin';
}

export function isWarehouse(role: UserRole): boolean {
  return role === 'warehouse';
}

/**
 * Affiliates operate inside /admin but only over a restricted set of pages.
 * Orders/invoices/customers are scoped to the customers bound to them; the
 * products catalog is global but strictly READ-ONLY for affiliates (no
 * create/edit/delete — enforced by canCreate/canEdit/canDelete + the API).
 *
 * Pricing is intentionally EXCLUDED: affiliates must not see or manage pricing
 * (their own prices are admin-controlled and locked). Dropping /admin/pricing
 * here both hides the "Pricing" sidebar item and bounces any direct navigation
 * to it back to /admin (see canAccessAdminPage + the admin layout guard).
 */
export const AFFILIATE_PAGES = [
  '/admin',
  '/admin/orders',
  '/admin/invoices',
  '/admin/customers',
  '/admin/products',
] as const;

/**
 * Analytics accounts are a read-heavy, view-only role: they operate inside /admin
 * but only over Analytics and the Products catalog. On Products they may edit a
 * product's descriptive content (name, category, description, etc.) but NOT its
 * commerce fields (price/stock/pricing) or visibility, and they cannot create or
 * delete products — see canEditProductDescriptors + PRODUCT_DESCRIPTOR_FIELDS
 * (enforced in the UI and, authoritatively, by the products API).
 *
 * Note: the Dashboard (`/admin`) is intentionally excluded so an analytics user
 * lands on /admin/analytics (the admin layout bounces them off any other page).
 */
export const ANALYTICS_PAGES = [
  '/admin/analytics',
  '/admin/products',
  '/admin/categories',
  '/admin/marketing',
] as const;

/**
 * Check whether a role may access a given admin page (by href).
 * Admin/assistant can access everything; affiliates and analytics accounts only
 * their allowed subset.
 */
export function canAccessAdminPage(role: UserRole, href: string): boolean {
  if (role === 'admin' || role === 'assistant') return true;
  if (role === 'affiliate') {
    // Allow exact matches and sub-routes of an allowed page (e.g. /admin/invoices/123).
    return AFFILIATE_PAGES.some(
      (p) => href === p || (p !== '/admin' && href.startsWith(`${p}/`)),
    );
  }
  if (role === 'analytics') {
    return ANALYTICS_PAGES.some((p) => href === p || href.startsWith(`${p}/`));
  }
  return false;
}

export function isAffiliate(role: UserRole): boolean {
  return role === 'affiliate';
}

export function isAnalytics(role: UserRole): boolean {
  return role === 'analytics';
}

/**
 * The admin page a role should land on. Most roles start on the Dashboard
 * (`/admin`), but analytics accounts can't reach the Dashboard, so they land on
 * Analytics — this also gives the layout a safe redirect target that won't loop
 * (bouncing an inaccessible page to a page the role also can't access).
 */
export function adminLandingPage(role: UserRole): string {
  return role === 'analytics' ? '/admin/analytics' : '/admin';
}

/**
 * Who can view the Analytics dashboard (and pull its report/summary endpoints).
 * Admins and assistants have always had it; the analytics role exists for it.
 */
export function canViewAnalytics(role: UserRole): boolean {
  return role === 'admin' || role === 'assistant' || role === 'analytics';
}

/**
 * The product fields an analytics account is allowed to edit — a product's
 * descriptive content only. Everything NOT in this list (price, price_usd,
 * vial_price, stock_quantity, vials_per_box, low_stock_threshold, featured,
 * active, is_checkout_addon) is commerce/visibility and stays admin-only.
 *
 * This is the single source of truth shared by the products page UI and the
 * products API (`PUT /api/admin/products/[id]`), so the two never drift.
 */
export const PRODUCT_DESCRIPTOR_FIELDS = [
  'name',
  'slug',
  'category',
  'description',
  'description_short',
  'benefits',
  'mechanism',
  'strength',
  'purity',
  'form',
  'image_url',
  'box_image_url',
  'box_image_first',
  'coa_url',
] as const;

export type ProductDescriptorField = (typeof PRODUCT_DESCRIPTOR_FIELDS)[number];

/**
 * Check if a role may edit a product's descriptor (content) fields. Admins can
 * edit everything; analytics accounts can edit descriptors only. The distinction
 * from canEdit is what makes the analytics role "content-only" on Products.
 */
export function canEditProductDescriptors(role: UserRole): boolean {
  return role === 'admin' || role === 'analytics';
}

/**
 * Check if a role may manage the storefront category taxonomy (create, rename,
 * reorder, re-icon, show/hide, delete categories in /admin/categories). Admins
 * and analytics/marketing accounts — the roles responsible for storefront
 * merchandising — can; everyone else (assistants included) is read-only.
 */
export function canManageCategories(role: UserRole): boolean {
  return role === 'admin' || role === 'analytics';
}

/**
 * Check if a role may manage Marketing settings — storefront branding (store
 * name, logo, favicon, tagline) and web tracking (GA4 / Meta Pixel IDs + the
 * consent banner toggle) on the /admin/marketing page. Admins and analytics/
 * marketing accounts can; everyone else (assistants included) is read-only.
 *
 * Note this is deliberately separate from the main Settings page (admin-only),
 * which also holds sensitive operational config (API keys, emails). Marketing
 * accounts get branding + tracking without that broader access.
 */
export function canManageMarketing(role: UserRole): boolean {
  return role === 'admin' || role === 'analytics';
}

/**
 * Check if user can edit/update/delete records.
 * Only admins can perform general mutations.
 */
export function canEdit(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Check if user can create new records.
 * Only admins can create (affiliate-specific create flows are authorized
 * explicitly in their own endpoints/pages).
 */
export function canCreate(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Check if user can delete records.
 * Only admins can delete.
 */
export function canDelete(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Who can view the invoicing area (list, detail, and PDFs).
 * Admins and assistants see everything; affiliates see invoices scoped to
 * their own customers (enforced server-side).
 */
export function canViewInvoices(role: UserRole): boolean {
  return role === 'admin' || role === 'assistant' || role === 'affiliate';
}

/**
 * Who can edit invoices (and download/print their PDF).
 * Admins, plus affiliates over their own customers' invoices.
 * Sending emails, recording payments and deleting stay admin-only (canEdit /
 * canDelete).
 */
export function canEditInvoice(role: UserRole): boolean {
  return role === 'admin' || role === 'affiliate';
}

/**
 * Get user-friendly role display name
 */
export function getRoleName(role: UserRole): string {
  const roleNames: Record<UserRole, string> = {
    customer: 'Customer',
    affiliate: 'Affiliate',
    assistant: 'Assistant',
    admin: 'Administrator',
    warehouse: 'Warehouse',
    analytics: 'Analytics',
  };
  return roleNames[role];
}

/**
 * Get role badge color classes
 */
export function getRoleBadgeClasses(role: UserRole): string {
  const classes: Record<UserRole, string> = {
    customer: 'bg-gray-500/10 text-ink-muted',
    affiliate: 'bg-emerald-500/10 text-emerald-500',
    assistant: 'bg-blue-500/10 text-blue-400',
    admin: 'bg-bronze/10 text-bronze',
    warehouse: 'bg-indigo-500/10 text-indigo-500',
    analytics: 'bg-violet-500/10 text-violet-500',
  };
  return classes[role];
}
