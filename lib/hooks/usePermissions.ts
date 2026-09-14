/**
 * Centralized permission hook for admin pages
 * Provides consistent role-based access control across all admin components
 */

import { useUserRole } from "@/app/(admin)/admin/layout";
import {
  canEdit as canEditFn,
  canCreate as canCreateFn,
  canDelete as canDeleteFn,
  canEditProductDescriptors as canEditProductDescriptorsFn,
  canManageCategories as canManageCategoriesFn,
  canManageMarketing as canManageMarketingFn,
} from "@/lib/permissions";

export function usePermissions() {
  const userRole = useUserRole();
  return {
    userRole,
    canEdit: canEditFn(userRole),
    canCreate: canCreateFn(userRole),
    canDelete: canDeleteFn(userRole),
    // True for admins (who can edit everything) and analytics accounts (who can
    // edit a product's descriptor/content fields only). Lets the products page
    // open the edit modal for analytics while keeping commerce fields locked.
    canEditProductDescriptors: canEditProductDescriptorsFn(userRole),
    // True for admins and analytics/marketing accounts — full management of the
    // storefront category taxonomy (create/rename/reorder/show-hide/delete).
    canManageCategories: canManageCategoriesFn(userRole),
    // True for admins and analytics/marketing accounts — storefront branding and
    // web tracking (GA4 / Meta Pixel + consent) on the /admin/marketing page.
    canManageMarketing: canManageMarketingFn(userRole),
  };
}
