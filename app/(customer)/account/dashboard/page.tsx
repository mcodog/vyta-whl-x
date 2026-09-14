'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, XCircle, ChevronRight, ChevronDown, User, MapPin, LogOut, Beaker, LayoutDashboard, KeyRound, FileText, CreditCard, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useCustomer } from '@/contexts/CustomerContext';
import { getCustomerOrders, updateCustomer } from '@/lib/customer/api';
import PeptideLoader from '@/components/PeptideLoader';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import AccountClients from '@/components/AccountClients';
import type { Order } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { getOrderStatusDisplay } from '@/lib/customer/order-status';

/** One row from `GET /api/account/invoices`. */
interface AccountInvoice {
  id: string;
  invoice_number: string;
  status: string;
  issue_date: string | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  currency: 'CAD' | 'USD';
  source: string | null;
  fulfillment_status: string | null;
  created_at: string;
  order_number: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  carrier: string | null;
  /** Present only while the invoice still needs paying. */
  payment_link: string | null;
}

/**
 * How an invoice status reads to the customer. Deliberately plainer than the
 * admin vocabulary: "Sent" and "Overdue" mean nothing to a buyer, so both are
 * shown as awaiting payment, and `pending_payment` — an order handed off to the
 * hosted checkout but not yet paid — is the one that offers a way to finish.
 */
function invoiceStatusDisplay(status: string): {
  label: string;
  color: string;
  Icon: typeof Clock;
} {
  switch (status) {
    case 'paid':
      return {
        label: 'Paid',
        color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        Icon: CheckCircle,
      };
    case 'pending_payment':
      return {
        label: 'Awaiting payment',
        color: 'bg-amber-50 text-amber-700 border-amber-200',
        Icon: Clock,
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        color: 'bg-vital-100 text-ink-muted border-vital-200',
        Icon: XCircle,
      };
    case 'partial':
      return {
        label: 'Partially paid',
        color: 'bg-amber-50 text-amber-700 border-amber-200',
        Icon: Clock,
      };
    default:
      return {
        label: 'Unpaid',
        color: 'bg-blue-50 text-blue-700 border-blue-200',
        Icon: Clock,
      };
  }
}

export default function AccountDashboard() {
  const router = useRouter();
  const { customer, logout, isLoading, refreshCustomer } = useCustomer();
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<AccountInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    shipping_address: '',
    shipping_city: '',
    shipping_state: '',
    shipping_postal_code: '',
    shipping_country: '',
  });
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (!customer) {
      router.push('/login?redirect=/account/dashboard');
      return;
    }

    async function loadOrders() {
      const orderData = await getCustomerOrders(customer.id);
      setOrders(orderData);
      setLoading(false);
    }

    // Invoices are admin/service-role only in the database, so they come from an
    // authenticated API route rather than a direct query.
    async function loadInvoices() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/account/invoices', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          // An unpaid invoice's pay link must never come from cache.
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      } catch {
        /* best-effort — the card simply shows nothing */
      } finally {
        setInvoicesLoading(false);
      }
    }

    loadOrders();
    loadInvoices();

    setProfileData({
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      phone: customer.phone || '',
      shipping_address: customer.shipping_address || '',
      shipping_city: customer.shipping_city || '',
      shipping_state: customer.shipping_state || '',
      shipping_postal_code: customer.shipping_postal_code || '',
      shipping_country: customer.shipping_country || 'CA',
    });
  }, [customer, router, isLoading]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    router.push('/');
  };

  const handleSaveProfile = async () => {
    if (!customer) return;
    setSaving(true);

    const result = await updateCustomer(customer.id, profileData);

    if (result.success) {
      await refreshCustomer();
      setEditingProfile(false);
    }

    setSaving(false);
  };

  if (isLoading || !customer) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-pulse text-ink-muted text-sm">Loading...</div>
      </main>
    );
  }

  return (
    <>
      <AnimatePresence>
        {loggingOut && <PeptideLoader message="Signing you out..." type="logout" />}
      </AnimatePresence>

      <main className="min-h-screen bg-white">
        <Navigation showTicker={false} />

        <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28">
          <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 sm:mb-8 md:mb-10"
            >
              <span className="text-[10px] sm:text-xs font-semibold text-vital-600 uppercase tracking-[0.2em] mb-2 sm:mb-3 block">
                My Account
              </span>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink mb-1 sm:mb-2">
                Welcome back, {customer.first_name}!
              </h1>
              <p className="text-ink-muted text-xs sm:text-sm md:text-base">Manage your orders and account settings</p>
              {(customer.role === 'admin' || customer.role === 'assistant') && (
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-2 mt-3 sm:mt-4 px-4 py-2.5 bg-ink hover:bg-vital-800 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Go to Admin Dashboard
                </Link>
              )}
            </motion.div>

            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
              {/* Orders + invoices */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="lg:col-span-2 space-y-4 sm:space-y-6"
              >
                {/* Invoices. Rendered above orders because an unpaid one is the
                    thing the customer most needs to act on. Hidden entirely
                    when they have none, so nothing changes for customers who
                    have only ever ordered the in-house way. */}
                {(invoicesLoading || invoices.length > 0) && (
                  <div className="bg-white rounded-xl border border-vital-200 overflow-hidden">
                    <div className="p-4 sm:p-5 md:p-6 border-b border-vital-100">
                      <h2 className="text-base sm:text-lg font-bold text-ink flex items-center gap-2">
                        <FileText className="w-4 sm:w-5 h-4 sm:h-5 text-vital-600" />
                        Your Invoices
                      </h2>
                    </div>

                    {invoicesLoading ? (
                      <div className="p-6 sm:p-8 text-center">
                        <div className="animate-pulse text-ink-muted text-xs sm:text-sm">
                          Loading invoices...
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-vital-100">
                        {invoices.map((invoice, index) => {
                          const s = invoiceStatusDisplay(invoice.status);
                          const payable = Boolean(invoice.payment_link);
                          return (
                            <motion.div
                              key={invoice.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className="p-3 sm:p-4 md:p-5 hover:bg-vital-50/50 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3 sm:gap-4">
                                <div className="min-w-0">
                                  <p className="font-semibold text-ink text-xs sm:text-sm break-all">
                                    {invoice.invoice_number}
                                  </p>
                                  <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5">
                                    {new Date(invoice.created_at).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                    })}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                                  <span
                                    className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium border ${s.color}`}
                                  >
                                    <s.Icon className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                                    <span>{s.label}</span>
                                  </span>
                                  <span className="font-bold text-ink text-xs sm:text-sm tabular-nums whitespace-nowrap">
                                    ${invoice.total.toFixed(2)} {invoice.currency}
                                  </span>
                                </div>
                              </div>

                              {/* Mobile status badge */}
                              <div className="sm:hidden mt-2">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium border ${s.color}`}
                                >
                                  <s.Icon className="w-3 h-3" />
                                  <span>{s.label}</span>
                                </span>
                              </div>

                              {/* Resume payment. Only ever rendered when the
                                  server returned a link, which it does only for
                                  an invoice that still needs paying. */}
                              {payable && (
                                <a
                                  href={invoice.payment_link!}
                                  className="mt-3 inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-gradient-to-r from-vital-500 to-blue-500 hover:from-vital-600 hover:to-blue-600 text-white px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all shadow-lg shadow-vital-500/25"
                                >
                                  <CreditCard className="w-4 h-4" />
                                  Complete payment
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}

                              {/* Tracking, once the parcel is on its way. */}
                              {invoice.tracking_number && (
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] sm:text-xs text-ink-muted">
                                  <Truck className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span className="truncate">
                                    {invoice.carrier ? `${invoice.carrier} · ` : ''}
                                    {invoice.tracking_url ? (
                                      <a
                                        href={invoice.tracking_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-vital-600 hover:text-vital-700 font-medium"
                                      >
                                        {invoice.tracking_number}
                                      </a>
                                    ) : (
                                      invoice.tracking_number
                                    )}
                                  </span>
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl border border-vital-200 overflow-hidden">
                  <div className="p-4 sm:p-5 md:p-6 border-b border-vital-100">
                    <h2 className="text-base sm:text-lg font-bold text-ink flex items-center gap-2">
                      <Package className="w-4 sm:w-5 h-4 sm:h-5 text-vital-600" />
                      Your Orders
                    </h2>
                  </div>

                  {loading ? (
                    <div className="p-6 sm:p-8 text-center">
                      <div className="animate-pulse text-ink-muted text-xs sm:text-sm">Loading orders...</div>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="p-6 sm:p-8 md:p-12 text-center">
                      <div className="w-12 sm:w-14 h-12 sm:h-14 bg-vital-100 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                        <Beaker className="w-6 sm:w-7 h-6 sm:h-7 text-ink-light" />
                      </div>
                      <p className="text-ink-muted mb-3 sm:mb-4 text-xs sm:text-sm">You haven&apos;t placed any orders yet</p>
                      <Link
                        href="/products"
                        className="inline-flex items-center gap-1 text-vital-600 hover:text-vital-700 font-semibold text-xs sm:text-sm"
                      >
                        Browse Products
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  ) : (
                    <div className="divide-y divide-vital-100">
                      {orders.map((order, index) => (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="p-3 sm:p-4 md:p-5 hover:bg-vital-50/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3 sm:gap-4">
                            <div className="min-w-0">
                              <p className="font-semibold text-ink text-xs sm:text-sm break-all">
                                Order #{order.order_number}
                              </p>
                              <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5">
                                {new Date(order.created_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 md:gap-4 flex-shrink-0">
                              {(() => {
                                const s = getOrderStatusDisplay(order.status);
                                return (
                                  <span
                                    className={`hidden sm:inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-medium border ${s.color}`}
                                  >
                                    <s.Icon className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                                    <span>{s.label}</span>
                                  </span>
                                );
                              })()}
                              <span className="font-bold text-ink text-xs sm:text-sm tabular-nums">
                                ${Number(order.total).toFixed(2)}
                              </span>
                              <Link
                                href={`/account/orders/${order.id}`}
                                className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center rounded-lg hover:bg-vital-100 text-ink-light hover:text-ink-muted transition-colors"
                              >
                                <ChevronRight className="w-4 sm:w-5 h-4 sm:h-5" />
                              </Link>
                            </div>
                          </div>
                          {/* Mobile status badge */}
                          <div className="sm:hidden mt-2">
                            {(() => {
                              const s = getOrderStatusDisplay(order.status);
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium border ${s.color}`}
                                >
                                  <s.Icon className="w-3 h-3" />
                                  <span>{s.label}</span>
                                </span>
                              );
                            })()}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Ship-to clients (reseller customers only; renders nothing otherwise) */}
                <AccountClients />
              </motion.div>

              {/* Profile Section */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-4 sm:space-y-5"
              >
                {/* Account Info */}
                <div className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2 mb-3 sm:mb-4">
                    <User className="w-4 h-4 text-vital-600" />
                    Account Info
                  </h3>

                  {editingProfile ? (
                    <div className="space-y-2 sm:space-y-3">
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.first_name}
                          onChange={(e) =>
                            setProfileData({ ...profileData, first_name: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="First Name"
                        />
                        <input
                          type="text"
                          value={profileData.last_name}
                          onChange={(e) =>
                            setProfileData({ ...profileData, last_name: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="Last Name"
                        />
                      </div>
                      <input
                        type="tel"
                        value={profileData.phone}
                        onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                        className="w-full px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                        placeholder="Phone Number"
                      />
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleSaveProfile}
                          disabled={saving}
                          className="flex-1 bg-gradient-to-r from-vital-500 to-blue-500 text-white py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:from-vital-600 hover:to-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-vital-500/25"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingProfile(false)}
                          className="flex-1 bg-vital-100 text-vital-800 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:bg-vital-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1 sm:space-y-2">
                      <p className="text-ink font-medium text-xs sm:text-sm">
                        {customer.first_name} {customer.last_name}
                      </p>
                      <p className="text-ink-muted text-xs sm:text-sm">{customer.email}</p>
                      {customer.phone && (
                        <p className="text-ink-muted text-xs sm:text-sm">{customer.phone}</p>
                      )}
                      <button
                        onClick={() => setEditingProfile(true)}
                        className="text-vital-600 hover:text-vital-700 text-xs sm:text-sm font-medium pt-1"
                      >
                        Edit Profile
                      </button>
                    </div>
                  )}
                </div>

                {/* Shipping Address */}
                <div className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2 mb-3 sm:mb-4">
                    <MapPin className="w-4 h-4 text-vital-600" />
                    Shipping Address
                  </h3>

                  {editingProfile ? (
                    <div className="space-y-2 sm:space-y-3">
                      <input
                        type="text"
                        value={profileData.shipping_address}
                        onChange={(e) =>
                          setProfileData({ ...profileData, shipping_address: e.target.value })
                        }
                        className="w-full px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                        placeholder="Street Address"
                      />
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.shipping_city}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_city: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="City"
                        />
                        <input
                          type="text"
                          value={profileData.shipping_state}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_state: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="Province"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.shipping_postal_code}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_postal_code: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="Postal Code"
                        />
                        <input
                          type="text"
                          value={profileData.shipping_country}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_country: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-vital-50 border border-vital-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-vital-500 focus:border-transparent"
                          placeholder="Country"
                        />
                      </div>
                    </div>
                  ) : customer.shipping_address ? (
                    <div className="text-ink-muted text-xs sm:text-sm space-y-0.5">
                      <p>{customer.shipping_address}</p>
                      <p>
                        {customer.shipping_city}, {customer.shipping_state}{' '}
                        {customer.shipping_postal_code}
                      </p>
                      <p>{customer.shipping_country}</p>
                    </div>
                  ) : (
                    <p className="text-ink-light text-xs sm:text-sm">No address saved</p>
                  )}
                </div>

                {/* Password & Security */}
                <div className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6">
                  <button
                    onClick={() => setShowPasswordForm((v) => !v)}
                    className="w-full flex items-center justify-between gap-2"
                    aria-expanded={showPasswordForm}
                  >
                    <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-vital-600" />
                      Password &amp; Security
                    </h3>
                    <ChevronDown
                      className={`w-4 h-4 text-ink-light transition-transform ${showPasswordForm ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {showPasswordForm ? (
                    <div className="mt-4">
                      <ChangePasswordForm email={customer.email} variant="customer" />
                    </div>
                  ) : (
                    <p className="text-ink-muted text-xs sm:text-sm mt-2">
                      Update the password you use to sign in.
                    </p>
                  )}
                </div>

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 bg-white rounded-xl border border-vital-200 py-2.5 sm:py-3 text-ink-muted hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors text-xs sm:text-sm font-semibold"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </motion.div>
            </div>
          </div>
        </div>

        <Footer />
      </main>
    </>
  );
}
