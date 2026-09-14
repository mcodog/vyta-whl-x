'use client';

import React, { useEffect, useState, createContext, useContext } from 'react';
import { LayoutDashboard, Users, DollarSign, UserCircle, ArrowLeft, Mail, Lock, LogIn, AlertCircle, Tag, Tags, Box, Info, Settings, UserCog, ClipboardList, FileText, TrendingUp, Briefcase, Bell, Menu, X, PackageX, PackageCheck, ScanLine, FlaskConical, History, ShieldCheck, Bug, ChevronsLeft, ChevronsRight, LogOut, Network, BookOpen, Archive, Megaphone, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { canAccessAdmin, canAccessAdminPage, adminLandingPage, getRoleName, type UserRole } from '@/lib/permissions';
import { getLowStockProducts } from '@/lib/admin/api';
import PuraLoader from '@/components/PuraLoader';

// Create context for user role
const UserRoleContext = createContext<UserRole>('customer');
export const useUserRole = () => useContext(UserRoleContext);

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Only visible to full admins (e.g. links into the warehouse floor view). */
  adminOnly?: boolean;
  /** Link leaves the /admin section (so it never matches the active-item test). */
  external?: boolean;
  /**
   * Show a "New" badge on this item until the given date (inclusive, local
   * time). Self-expiring — the badge simply stops rendering once the date has
   * passed, so the field can be left in place and cleaned up later.
   */
  newUntil?: string;
};
type NavGroup = { label: string; items: NavItem[] };

// Whether an item's "New" badge is still within its window.
const isNavItemNew = (item: NavItem): boolean => {
  if (!item.newUntil) return false;
  const until = new Date(`${item.newUntil}T23:59:59`);
  return !Number.isNaN(until.getTime()) && Date.now() < until.getTime();
};

// Nav is organized into labeled groups so the sidebar scans as ~5 sections
// instead of one flat wall of 19 links. Orders live under Invoices now (each
// invoice is bound 1:1 to an order and carries its shipping/label tooling); the
// /admin/orders route still works by direct link but is hidden from the nav.
const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/admin/analytics', label: 'Analytics', icon: TrendingUp },
    ],
  },
  {
    label: 'Orders & Fulfillment',
    items: [
      { href: '/admin/invoices', label: 'Invoices', icon: FileText },
      { href: '/admin/backorders', label: 'Backorders', icon: PackageX },
      { href: '/admin/stock-requests', label: 'Stock Requests', icon: Bell },
      { href: '/admin/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { href: '/admin/warehouse', label: 'Warehouse', icon: PackageCheck },
      { href: '/admin/puramass-orders', label: 'PuraMass Orders', icon: CreditCard },
      // Jumps straight into the live fulfillment queue (warehouse floor view).
      // Admin-only: assistants/affiliates can't access /warehouse.
      { href: '/warehouse', label: 'Fulfillment Queue', icon: ScanLine, adminOnly: true, external: true },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/admin/products', label: 'Products', icon: Box },
      { href: '/admin/categories', label: 'Categories', icon: Tags, newUntil: '2026-09-30' },
      { href: '/admin/pricing', label: 'Pricing', icon: Tag },
      { href: '/admin/lab-results', label: 'Lab Results', icon: FlaskConical },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/admin/marketing', label: 'Branding & Tracking', icon: Megaphone, newUntil: '2026-09-30' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/customers', label: 'Customers', icon: UserCircle },
      { href: '/admin/genealogy', label: 'Genealogy', icon: Network, newUntil: '2026-07-31' },
      // Affiliates are managed inside Sales People now (as a tier). See ADR 0003.
      { href: '/admin/sales-people', label: 'Sales People', icon: Briefcase },
      { href: '/admin/commissions', label: 'Commissions', icon: DollarSign },
      { href: '/admin/users', label: 'Users', icon: UserCog },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/changelog', label: 'Changelog', icon: History },
      { href: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
      { href: '/admin/deleted-archives', label: 'Deleted Archives', icon: Archive },
      { href: '/admin/error-logs', label: 'Error Logs', icon: Bug },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Help',
    items: [
      { href: '/admin/guides', label: 'Guides', icon: BookOpen, newUntil: '2026-09-30' },
    ],
  },
];

// Flat list kept for the active-item lookup used by the mobile top bar.
const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

const SIDEBAR_COLLAPSED_KEY = 'admin.sidebarCollapsed';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [authState, setAuthState] = useState<'checking' | 'not_logged_in' | 'not_admin' | 'error' | 'admin'>('checking');
  const [userRole, setUserRole] = useState<UserRole>('customer');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [backorderCount, setBackorderCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    checkAdmin();
  }, []);

  // Affiliates and analytics accounts may only reach their allowed pages; bounce
  // them to their role's landing page otherwise (analytics can't reach /admin, so
  // it lands on /admin/analytics — using /admin would loop).
  useEffect(() => {
    if (authState === 'admin' && !canAccessAdminPage(userRole, pathname)) {
      router.replace(adminLandingPage(userRole));
    }
  }, [authState, userRole, pathname, router]);

  // Collapse the mobile nav drawer after navigating to a new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Restore the desktop sidebar collapsed/expanded preference.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch { /* ignore */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const handleSignOut = async () => {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    router.push('/');
  };

  // Open-backorder badge count (admin/assistant only). Refresh on navigation so
  // it updates after fulfilling a backorder or editing an invoice.
  useEffect(() => {
    if (authState !== 'admin' || (userRole !== 'admin' && userRole !== 'assistant')) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/admin/backorders/count', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) return;
        const { count } = await res.json();
        if (!cancelled) setBackorderCount(count ?? 0);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [authState, userRole, pathname]);

  // Low-stock badge count (admin/assistant only). Refresh on navigation so it
  // reflects edits/sales that change stock levels.
  useEffect(() => {
    if (authState !== 'admin' || (userRole !== 'admin' && userRole !== 'assistant')) return;
    let cancelled = false;
    (async () => {
      try {
        const products = await getLowStockProducts();
        if (!cancelled) setLowStockCount(products.length);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [authState, userRole, pathname]);

  const checkAdmin = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setAuthState('not_logged_in');
        setIsChecking(false);
        return;
      }

      const res = await fetch('/api/auth/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });

      if (res.ok) {
        const { customer } = await res.json();
        const role = customer?.role || 'customer';

        console.log('Admin Layout - Customer data:', customer);
        console.log('Admin Layout - Detected role:', role);
        console.log('Admin Layout - Can access admin:', canAccessAdmin(role));

        // Allow both admin and assistant roles
        if (canAccessAdmin(role)) {
          setIsAdmin(true);
          setUserRole(role);
          setAuthState('admin');
          console.log('Admin Layout - User role set to:', role);
        } else {
          setAuthState('not_admin');
        }
      } else {
        setAuthState('error');
        console.error('Admin Layout - Auth check failed with status:', res.status);
      }
    } catch (e) {
      console.error('Admin check failed:', e);
      setAuthState('error');
    }
    setIsChecking(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (!email || !password) {
      setLoginError('Enter your email and password');
      return;
    }

    setLoginLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setLoginError(error.message);
        setLoginLoading(false);
        return;
      }

      // Re-check admin status after login
      setAuthState('checking');
      setIsChecking(true);
      await checkAdmin();
    } catch {
      setLoginError('Something went wrong');
      setLoginLoading(false);
    }
  };

  // Loading state
  if (isChecking) {
    return <PuraLoader label="Admin Panel" message="Verifying access" />;
  }

  // Not logged in - show inline login form
  if (authState === 'not_logged_in') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-xl p-6 sm:p-8 border border-line shadow-sm">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold text-ink">AMINOCAN</h1>
              <p className="text-xs text-bronze font-semibold uppercase tracking-[0.15em] mt-1">Admin Panel</p>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-sm">{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
                    placeholder="admin@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
                    placeholder="Enter your password"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {loginLoading ? 'Signing in...' : <><LogIn className="w-4 h-4" /> Sign In</>}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Not admin or error
  if (authState !== 'admin') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-bold text-ink mb-2">Access Denied</h1>
          <p className="text-ink-muted text-sm mb-6">
            {authState === 'not_admin'
              ? 'Your account does not have admin privileges.'
              : 'Something went wrong. Try refreshing.'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-ink text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Admin authenticated - show dashboard
  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  // Badge count for a given nav href (backorders / low-stock). 0 = no badge.
  const badgeFor = (href: string) =>
    href === '/admin/backorders' && backorderCount > 0
      ? backorderCount
      : href === '/admin/products' && lowStockCount > 0
        ? lowStockCount
        : 0;

  const roleLabel = userRole === 'admin' ? 'Admin' : userRole === 'affiliate' ? 'Client' : getRoleName(userRole);

  // Groups filtered to the pages this role may see; empty groups are dropped.
  const itemVisible = (item: NavItem) =>
    canAccessAdminPage(userRole, item.href) && (!item.adminOnly || userRole === 'admin');

  const accessibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(itemVisible),
    }))
    .filter((group) => group.items.length > 0);

  const accessibleItems = navItems.filter(itemVisible);
  const activeItem = accessibleItems.find((item) => isActive(item.href)) ?? accessibleItems[0];
  const ActiveIcon = activeItem?.icon ?? LayoutDashboard;

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand + collapse toggle */}
      <div className={`flex items-center gap-2 border-b border-line px-4 h-16 shrink-0 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
        <Link href="/" className={`text-base font-bold text-ink shrink-0 ${collapsed ? 'lg:hidden' : ''}`}>
          PURAMASS
        </Link>
        <span className={`text-[10px] font-semibold text-bronze uppercase tracking-[0.15em] ${collapsed ? 'lg:hidden' : ''}`}>
          {roleLabel}
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:inline-flex ml-auto items-center justify-center w-7 h-7 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
        {/* Mobile close */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden ml-auto inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Grouped nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {accessibleGroups.map((group) => (
          <div key={group.label}>
            <p className={`px-2 mb-1.5 text-[10px] font-semibold text-ink-light uppercase tracking-[0.12em] ${collapsed ? 'lg:hidden' : ''}`}>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const badge = badgeFor(item.href);
                const badgeColor = item.href === '/admin/products' ? 'bg-amber-500' : 'bg-red-500';
                // Analytics accounts don't get "New" badges in the sidebar.
                const showNew = badge === 0 && isNavItemNew(item) && userRole !== 'analytics';
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${
                      active
                        ? 'bg-ink text-white font-medium'
                        : 'text-ink-muted hover:text-ink hover:bg-surface'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon className="w-[18px] h-[18px]" />
                      {/* Collapsed rail: badge shrinks to a dot on the icon */}
                      {badge > 0 && (
                        <span className={`hidden ${collapsed ? 'lg:block' : ''} absolute -top-1 -right-1 w-2 h-2 rounded-full ${badgeColor} ring-2 ring-white`} />
                      )}
                      {/* Collapsed rail: "New" shrinks to a bronze dot */}
                      {showNew && (
                        <span className={`hidden ${collapsed ? 'lg:block' : ''} absolute -top-1 -right-1 w-2 h-2 rounded-full bg-bronze ring-2 ring-white`} />
                      )}
                    </span>
                    <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                    {badge > 0 && (
                      <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full ${badgeColor} text-white text-[11px] font-bold leading-none ${collapsed ? 'lg:hidden' : ''}`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                    {showNew && (
                      <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-bronze text-white text-[10px] font-bold uppercase tracking-wide leading-none ${collapsed ? 'lg:hidden' : ''}`}>
                        New
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: back to store + sign out */}
      <div className="border-t border-line p-3 shrink-0 space-y-0.5">
        <Link
          href="/"
          title={collapsed ? 'Back to Store' : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-surface transition-colors ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
        >
          <ArrowLeft className="w-[18px] h-[18px] shrink-0" />
          <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>Back to Store</span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? 'Sign Out' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-surface transition-colors ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-line">
        <div className="flex items-center justify-between gap-3 px-4 h-14">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="inline-flex items-center gap-2 text-ink"
          >
            <Menu className="w-5 h-5 shrink-0" />
            <span className="flex items-center gap-2 text-sm font-medium min-w-0">
              <ActiveIcon className="w-4 h-4 shrink-0" />
              <span className="truncate">{activeItem?.label ?? 'Menu'}</span>
            </span>
          </button>
          <span className="text-sm font-bold text-ink shrink-0">PURAMASS</span>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-ink/40"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (fixed drawer on mobile, static rail on desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-line transform transition-all duration-200 ease-in-out lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-16' : 'lg:w-64'}`}
      >
        {sidebar}
      </aside>

      {/* Main content, offset by the desktop sidebar width */}
      <div className={`transition-all duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        <main className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8">
          {userRole === 'assistant' && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                You have read-only access. Contact an administrator to make changes.
              </p>
            </div>
          )}

          <UserRoleContext.Provider value={userRole}>
            {children}
          </UserRoleContext.Provider>
        </main>
      </div>
    </div>
  );
}
