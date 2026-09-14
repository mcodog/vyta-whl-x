"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import {
  Menu,
  X,
  ShoppingCart,
  LogIn,
  User,
  LogOut,
  Package,
  ChevronDown,
  Users,
  Beaker,
  Microscope,
  LayoutDashboard,
  PackageCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import PeptideLoader from "./PeptideLoader";
import SiteBrand from "./SiteBrand";

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { t } = useLanguage();
  const { totalItems, setIsOpen: setCartOpen } = useCart();
  const { customer, isLoading, logout } = useCustomer();
  const pathname = usePathname();

  // Affiliate button: affiliates go to their /admin portal, everyone else to
  // the "become an affiliate" application (which gates login itself).
  const isAffiliate = customer?.role === 'affiliate';
  const affiliateHref = isAffiliate ? '/admin' : '/affiliate/apply';
  const affiliateLabel = isAffiliate ? 'Client Portal' : 'Affiliates';
  // Admin/assistant/analytics get a direct link into the admin dashboard.
  const isStaff =
    customer?.role === 'admin' ||
    customer?.role === 'assistant' ||
    customer?.role === 'analytics';
  // Warehouse staff get a direct link into their fulfillment dashboard.
  const isWarehouse = customer?.role === 'warehouse';
  // Admins can also reach the warehouse dashboard for oversight, so surface a
  // dedicated warehouse link for them (warehouse staff already get theirs above).
  const isAdmin = customer?.role === 'admin';

  // Fix hydration mismatch by only showing cart count after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Solidify the transparent (over-hero) bar after a little scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const dropdownTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (dropdown: string) => {
    if (dropdownTimeout.current) {
      clearTimeout(dropdownTimeout.current);
    }
    setActiveDropdown(dropdown);
  };

  const handleMouseLeave = () => {
    dropdownTimeout.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 150);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setActiveDropdown(null);
    setIsOpen(false);
    await logout();
    setTimeout(() => {
      window.location.href = "/";
    }, 1200);
  };

  if (loggingOut) {
    return <PeptideLoader message="Signing out..." type="logout" />;
  }

  // Transparent, light-on-dark over the homepage hero; solid white once the
  // user scrolls, on every other route, or while the mobile menu is open.
  const overlay = pathname === "/" && !scrolled && !isOpen;

  const linkClass = `px-4 py-2 rounded-lg transition-all text-sm font-medium ${
    overlay
      ? "text-white/80 hover:text-white hover:bg-white/10"
      : "text-ink-muted hover:text-ink hover:bg-surface"
  }`;
  const badgeClass = `absolute -top-0.5 -right-0.5 text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1 ${
    overlay ? "bg-white text-ink" : "bg-ink text-white"
  }`;

  return (
    <nav className="fixed top-0 w-full z-50">
      {/* Main Navigation Bar */}
      <div
        className={`transition-colors duration-300 ${
          overlay
            ? "bg-transparent border-b border-transparent"
            : "bg-white border-b border-line"
        }`}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="flex justify-between items-center h-[72px]">
            {/* Logo — the VYTA lockup, or the editable site branding when the
                store has its own logo/name configured. */}
            <Link href="/" className="flex items-center group" aria-label="VYTA Biosciences home">
              <SiteBrand tone={overlay ? 'light' : 'dark'} size={38} className="transition-opacity duration-300 group-hover:opacity-80" />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              <Link
                href="/"
                className={linkClass}
              >
                Home
              </Link>

              <Link
                href="/products"
                className={linkClass}
              >
                Products
              </Link>

              <Link
                href="/lab-results"
                className={linkClass}
              >
                Lab Results
              </Link>

              {/* Company Dropdown */}
              <div
                className="relative z-[60]"
                onMouseEnter={() => handleMouseEnter("company")}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                    activeDropdown === "company"
                      ? overlay
                        ? "text-white bg-white/10"
                        : "text-ink bg-surface"
                      : overlay
                        ? "text-white/80 hover:text-white hover:bg-white/10"
                        : "text-ink-muted hover:text-ink hover:bg-surface"
                  }`}
                >
                  <span>Company</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === "company" ? "rotate-180" : ""}`}
                  />
                </button>

                <AnimatePresence>
                  {activeDropdown === "company" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute left-0 top-full pt-2 w-64 z-[100]"
                    >
                      <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 overflow-hidden border border-slate-200">
                        <div className="p-2">
                          <div className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-not-allowed opacity-50">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                              <Users className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-400">
                                About Us
                              </p>
                              <p className="text-xs text-slate-400">
                                Coming Soon
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-not-allowed opacity-50">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                              <Microscope className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-400">
                                Certifications
                              </p>
                              <p className="text-xs text-slate-400">
                                Coming Soon
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Link
                href="/contact"
                className={linkClass}
              >
                Contact
              </Link>

              <Link
                href={affiliateHref}
                className={`px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                  overlay
                    ? "text-vital-light hover:bg-white/10"
                    : "text-vital hover:text-vital-dark hover:bg-vital-50"
                }`}
              >
                {affiliateLabel}
              </Link>

              {/* Direct link into the admin backend for staff/analytics. */}
              {isStaff && (
                <Link
                  href="/admin"
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                    overlay
                      ? "text-white hover:bg-white/10"
                      : "text-ink-muted hover:text-ink hover:bg-surface"
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Admin
                </Link>
              )}
            </div>

            {/* Right Side Actions */}
            <div className="hidden lg:flex items-center gap-2">
              {/* Cart — opens the slide-out drawer */}
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                aria-label="Open cart"
                className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
                  overlay
                    ? "text-white/80 hover:text-white hover:bg-white/10"
                    : "text-ink-muted hover:text-ink hover:bg-surface"
                }`}
              >
                <ShoppingCart className="w-5 h-5" />
                {mounted && totalItems > 0 && (
                  <span className={badgeClass}>
                    {totalItems > 99 ? "99+" : totalItems}
                  </span>
                )}
              </button>

              {/* Divider */}
              <div
                className={`w-px h-6 mx-1 transition-colors duration-300 ${
                  overlay ? "bg-white/25" : "bg-line"
                }`}
              />

              {/* Login/Account */}
              {isLoading ? (
                // While customer data loads, show a skeleton placeholder instead
                // of flashing the "Login" button to an already-signed-in user.
                <div
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-surface animate-pulse"
                  aria-hidden="true"
                >
                  <div className="w-4 h-4 rounded-full bg-line" />
                  <div className="h-4 w-20 rounded bg-line" />
                </div>
              ) : customer ? (
                <div
                  className="relative z-[60]"
                  onMouseEnter={() => handleMouseEnter("account")}
                  onMouseLeave={handleMouseLeave}
                >
                  <button
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all text-sm font-medium ${
                      activeDropdown === "account"
                        ? "bg-surface text-ink"
                        : overlay
                          ? "bg-white text-ink hover:bg-white/90"
                          : "bg-ink text-white hover:bg-ink/90"
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span>{customer.first_name}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === "account" ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {activeDropdown === "account" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute right-0 top-full pt-2 w-52 z-[100]"
                      >
                        <div className="bg-white rounded-xl shadow-2xl shadow-black/20 overflow-hidden border border-slate-200">
                          <div className="p-2">
                            {isStaff && (
                              <Link
                                href="/admin"
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                                onClick={() => setActiveDropdown(null)}
                              >
                                <LayoutDashboard className="w-4 h-4 text-vital" />
                                <span className="text-sm font-medium">
                                  Admin Dashboard
                                </span>
                              </Link>
                            )}
                            {isAdmin && (
                              <Link
                                href="/warehouse"
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                                onClick={() => setActiveDropdown(null)}
                              >
                                <PackageCheck className="w-4 h-4 text-indigo-500" />
                                <span className="text-sm font-medium">
                                  Warehouse
                                </span>
                              </Link>
                            )}
                            {isWarehouse && (
                              <Link
                                href="/warehouse"
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                                onClick={() => setActiveDropdown(null)}
                              >
                                <PackageCheck className="w-4 h-4 text-indigo-500" />
                                <span className="text-sm font-medium">
                                  Warehouse Dashboard
                                </span>
                              </Link>
                            )}
                            <Link
                              href="/account/dashboard"
                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                              onClick={() => setActiveDropdown(null)}
                            >
                              <Package className="w-4 h-4 text-slate-500" />
                              <span className="text-sm font-medium">
                                My Orders
                              </span>
                            </Link>
                          </div>
                          <div className="border-t border-slate-100 p-2">
                            <button
                              onClick={handleLogout}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-red-50 transition-colors text-slate-700 hover:text-red-600"
                            >
                              <LogOut className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                Sign Out
                              </span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <Link
                  href="/login"
                  className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                    overlay
                      ? "bg-white hover:bg-white/90 text-ink"
                      : "bg-ink hover:bg-ink/90 text-white"
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>Login</span>
                </Link>
              )}
            </div>

            {/* Mobile: Cart + Menu */}
            <div className="lg:hidden flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                aria-label="Open cart"
                className={`relative flex items-center justify-center w-10 h-10 transition-colors ${
                  overlay
                    ? "text-white/80 hover:text-white"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                <ShoppingCart className="w-5 h-5" />
                {mounted && totalItems > 0 && (
                  <span className={badgeClass}>
                    {totalItems > 99 ? "99+" : totalItems}
                  </span>
                )}
              </button>
              <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-center w-10 h-10 transition-colors ${
                  overlay
                    ? "text-white/80 hover:text-white"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {isOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Research Disclaimer - Now inside the main nav container */}
        <div
          className={`text-center py-2 sm:py-1.5 border-t transition-colors duration-300 ${
            overlay ? "bg-transparent border-white/10" : "bg-surface border-line"
          }`}
        >
          <span
            className={`text-[10px] sm:text-[11px] tracking-wide inline-flex items-center justify-center gap-1.5 sm:gap-2 px-4 ${
              overlay ? "text-white/60" : "text-ink-muted"
            }`}
          >
            <Beaker
              className={`w-3 h-3 flex-shrink-0 ${
                overlay ? "text-vital-light" : "text-vital"
              }`}
            />
            <span>Research Only</span>
            <span
              className={`hidden sm:inline ${overlay ? "text-white/25" : "text-line"}`}
            >
              •
            </span>
            <span className="hidden sm:inline">Shipping to Canada Only</span>
            <span className="sm:hidden">• Canada Only</span>
          </span>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden bg-white border-b border-line overflow-hidden"
          >
            <div className="px-5 py-4 space-y-1">
              <Link
                href="/"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Home
              </Link>
              <Link
                href="/products"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Products
              </Link>
              <Link
                href="/lab-results"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Lab Results
              </Link>

              {/* Company Section */}
              <div className="pt-2 pb-1">
                <p className="px-4 text-[10px] text-ink-muted uppercase tracking-[0.15em] font-medium mb-2">
                  Company
                </p>
                <div className="flex items-center gap-3 px-4 py-3 text-ink-light rounded-xl cursor-not-allowed opacity-50">
                  <Users className="w-4 h-4 text-ink-light" />
                  <span className="text-sm font-medium">About Us</span>
                  <span className="text-[10px] text-ink-muted ml-auto">
                    Coming Soon
                  </span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3 text-ink-light rounded-xl cursor-not-allowed opacity-50">
                  <Microscope className="w-4 h-4 text-ink-light" />
                  <span className="text-sm font-medium">Certifications</span>
                  <span className="text-[10px] text-ink-muted ml-auto">
                    Coming Soon
                  </span>
                </div>
              </div>

              <Link
                href="/contact"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Contact
              </Link>

              <Link
                href={affiliateHref}
                className="block px-4 py-3 text-vital hover:bg-vital-50 rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                {isAffiliate ? 'Client Portal' : 'Affiliate Program'}
              </Link>

              {/* Auth */}
              <div className="pt-4 mt-2 border-t border-line space-y-4">
                <div className="px-4">
                  {isLoading ? (
                    // Skeleton placeholder while customer data loads, so the
                    // mobile menu doesn't flash "Login" to a signed-in user.
                    <div
                      className="w-full h-12 rounded-xl bg-surface animate-pulse"
                      aria-hidden="true"
                    />
                  ) : customer ? (
                    <div className="space-y-2">
                      {isStaff && (
                        <Link
                          href="/admin"
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-vital text-white text-sm font-semibold rounded-xl"
                          onClick={() => setIsOpen(false)}
                        >
                          <LayoutDashboard className="w-4 h-4" />
                          Admin Dashboard
                        </Link>
                      )}
                      {isAdmin && (
                        <Link
                          href="/warehouse"
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-500 text-white text-sm font-semibold rounded-xl"
                          onClick={() => setIsOpen(false)}
                        >
                          <PackageCheck className="w-4 h-4" />
                          Warehouse
                        </Link>
                      )}
                      {isWarehouse && (
                        <Link
                          href="/warehouse"
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-500 text-white text-sm font-semibold rounded-xl"
                          onClick={() => setIsOpen(false)}
                        >
                          <PackageCheck className="w-4 h-4" />
                          Warehouse Dashboard
                        </Link>
                      )}
                      <Link
                        href="/account/dashboard"
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white text-sm font-semibold rounded-xl"
                        onClick={() => setIsOpen(false)}
                      >
                        <User className="w-4 h-4" />
                        My Account
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface text-ink-muted text-sm font-medium rounded-xl hover:bg-surface-2 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  ) : (
                    <Link
                      href="/login"
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white text-sm font-semibold rounded-xl"
                      onClick={() => setIsOpen(false)}
                    >
                      <LogIn className="w-4 h-4" />
                      Login / Sign Up
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
