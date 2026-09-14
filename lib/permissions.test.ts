import { describe, it, expect } from 'vitest';
import {
  canAccessAdminPage,
  canAccessAdmin,
  canAccessWarehouse,
  canEdit,
  canCreate,
  canDelete,
  canEditProductDescriptors,
  canManageCategories,
  canManageMarketing,
  canViewAnalytics,
  adminLandingPage,
  isAffiliate,
  isAnalytics,
  isWarehouse,
  AFFILIATE_PAGES,
  ANALYTICS_PAGES,
  type UserRole,
} from './permissions';

/**
 * canAccessAdminPage is the security boundary for the "minimized /admin" that
 * affiliates get. These tests pin down exactly which pages each role may reach.
 */
describe('canAccessAdminPage', () => {
  const PAGES_AFFILIATES_MAY_NOT_SEE = [
    '/admin/analytics',
    '/admin/purchase-orders',
    '/admin/stock-requests',
    '/admin/affiliates',
    '/admin/sales-people',
    '/admin/commissions',
    '/admin/users',
    '/admin/settings',
  ];

  it('lets admins and assistants reach every admin page', () => {
    const everyPage = [...AFFILIATE_PAGES, ...PAGES_AFFILIATES_MAY_NOT_SEE];
    for (const role of ['admin', 'assistant'] as UserRole[]) {
      for (const page of everyPage) {
        expect(canAccessAdminPage(role, page)).toBe(true);
      }
    }
  });

  it('lets affiliates reach exactly their allowed pages', () => {
    for (const page of AFFILIATE_PAGES) {
      expect(canAccessAdminPage('affiliate', page)).toBe(true);
    }
  });

  it('blocks affiliates from every restricted page', () => {
    for (const page of PAGES_AFFILIATES_MAY_NOT_SEE) {
      expect(canAccessAdminPage('affiliate', page)).toBe(false);
    }
  });

  it('lets affiliates reach sub-routes of an allowed page', () => {
    expect(canAccessAdminPage('affiliate', '/admin/invoices/abc-123')).toBe(true);
    expect(canAccessAdminPage('affiliate', '/admin/orders/42')).toBe(true);
  });

  it('does not treat /admin as a prefix that unlocks sibling pages', () => {
    // '/admin' must match exactly — it should NOT grant '/admin/analytics'.
    expect(canAccessAdminPage('affiliate', '/admin/analytics')).toBe(false);
  });

  it('is not fooled by a similar path prefix', () => {
    // '/admin/orders-export' should not be treated as a sub-route of '/admin/orders'.
    expect(canAccessAdminPage('affiliate', '/admin/orders-export')).toBe(false);
  });

  it('denies plain customers everything', () => {
    for (const page of [...AFFILIATE_PAGES, ...PAGES_AFFILIATES_MAY_NOT_SEE]) {
      expect(canAccessAdminPage('customer', page)).toBe(false);
    }
  });
});

describe('canAccessAdmin / isAffiliate', () => {
  it('admits admin, assistant and affiliate to the admin area', () => {
    expect(canAccessAdmin('admin')).toBe(true);
    expect(canAccessAdmin('assistant')).toBe(true);
    expect(canAccessAdmin('affiliate')).toBe(true);
    expect(canAccessAdmin('customer')).toBe(false);
  });

  it('identifies the affiliate role', () => {
    expect(isAffiliate('affiliate')).toBe(true);
    expect(isAffiliate('admin')).toBe(false);
  });

  it('keeps warehouse staff out of the admin area', () => {
    expect(canAccessAdmin('warehouse')).toBe(false);
    for (const page of AFFILIATE_PAGES) {
      expect(canAccessAdminPage('warehouse', page)).toBe(false);
    }
  });
});

describe('analytics account', () => {
  const RESTRICTED_FOR_ANALYTICS = [
    '/admin', // Dashboard is intentionally NOT reachable for analytics.
    '/admin/orders',
    '/admin/invoices',
    '/admin/customers',
    '/admin/pricing',
    '/admin/purchase-orders',
    '/admin/users',
    '/admin/settings',
  ];

  it('is admitted to the admin area', () => {
    expect(canAccessAdmin('analytics')).toBe(true);
    expect(isAnalytics('analytics')).toBe(true);
    expect(isAnalytics('admin')).toBe(false);
  });

  it('reaches exactly its allowed pages (Analytics, Products, Categories, Marketing) and sub-routes', () => {
    for (const page of ANALYTICS_PAGES) {
      expect(canAccessAdminPage('analytics', page)).toBe(true);
    }
    expect(canAccessAdminPage('analytics', '/admin/products/abc-123')).toBe(true);
    expect(canAccessAdminPage('analytics', '/admin/analytics/report')).toBe(true);
    expect(canAccessAdminPage('analytics', '/admin/categories')).toBe(true);
    expect(canAccessAdminPage('analytics', '/admin/marketing')).toBe(true);
  });

  it('is blocked from every other admin page, including the Dashboard', () => {
    for (const page of RESTRICTED_FOR_ANALYTICS) {
      expect(canAccessAdminPage('analytics', page)).toBe(false);
    }
  });

  it('is not fooled by a similar path prefix', () => {
    expect(canAccessAdminPage('analytics', '/admin/products-export')).toBe(false);
  });

  it('can edit product descriptors, manage categories and marketing, but not create/edit(commerce)/delete products', () => {
    expect(canEditProductDescriptors('analytics')).toBe(true);
    expect(canManageCategories('analytics')).toBe(true);
    expect(canManageMarketing('analytics')).toBe(true);
    expect(canEdit('analytics')).toBe(false);
    expect(canCreate('analytics')).toBe(false);
    expect(canDelete('analytics')).toBe(false);
    // Admins retain full commerce edit; descriptors are a superset for them.
    expect(canEditProductDescriptors('admin')).toBe(true);
    expect(canManageCategories('admin')).toBe(true);
    expect(canManageMarketing('admin')).toBe(true);
    expect(canEdit('admin')).toBe(true);
  });

  it('may view Analytics, alongside admins and assistants', () => {
    expect(canViewAnalytics('analytics')).toBe(true);
    expect(canViewAnalytics('admin')).toBe(true);
    expect(canViewAnalytics('assistant')).toBe(true);
    expect(canViewAnalytics('customer')).toBe(false);
    expect(canViewAnalytics('affiliate')).toBe(false);
    expect(canViewAnalytics('warehouse')).toBe(false);
  });

  it('lands on Analytics (not the Dashboard it cannot reach)', () => {
    expect(adminLandingPage('analytics')).toBe('/admin/analytics');
    expect(adminLandingPage('admin')).toBe('/admin');
    expect(adminLandingPage('affiliate')).toBe('/admin');
  });

  it('does not let other view-only roles edit product descriptors, categories or marketing', () => {
    for (const role of ['assistant', 'affiliate', 'customer', 'warehouse'] as UserRole[]) {
      expect(canEditProductDescriptors(role)).toBe(false);
      expect(canManageCategories(role)).toBe(false);
      expect(canManageMarketing(role)).toBe(false);
    }
  });
});

describe('canAccessWarehouse / isWarehouse', () => {
  it('admits warehouse staff and admins to the warehouse area', () => {
    expect(canAccessWarehouse('warehouse')).toBe(true);
    expect(canAccessWarehouse('admin')).toBe(true);
  });

  it('keeps everyone else out of the warehouse area', () => {
    expect(canAccessWarehouse('assistant')).toBe(false);
    expect(canAccessWarehouse('affiliate')).toBe(false);
    expect(canAccessWarehouse('customer')).toBe(false);
  });

  it('identifies the warehouse role', () => {
    expect(isWarehouse('warehouse')).toBe(true);
    expect(isWarehouse('admin')).toBe(false);
  });
});
