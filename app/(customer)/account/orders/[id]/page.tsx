'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Package, Clock, CheckCircle, Truck, XCircle, MapPin, Beaker, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useCustomer } from '@/contexts/CustomerContext';
import { getOrderWithItems } from '@/lib/customer/api';
import { getOrderStatusDisplay } from '@/lib/customer/order-status';
import { supabase } from '@/lib/supabase';
import type { Order, OrderItem } from '@/lib/supabase';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { customer, isLoading: customerLoading } = useCustomer();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<(OrderItem & { product_name?: string; product_strength?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const handleViewInvoice = async () => {
    if (!order || invoiceLoading) return;
    setInvoiceLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/orders/${order.id}/invoice`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        alert('Could not load your invoice. Please try again later.');
        return;
      }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      // Trigger a download via an anchor. Downloads aren't suppressed the way
      // window.open is after an await (popup blockers), so this reliably
      // delivers the invoice instead of silently doing nothing.
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${order.order_number}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      alert('Could not load your invoice. Please try again later.');
    } finally {
      setInvoiceLoading(false);
    }
  };

  useEffect(() => {
    // Wait for the customer session to hydrate before deciding to redirect,
    // otherwise a hard refresh / shared link bounces to login before `customer`
    // is populated.
    if (customerLoading) return;
    if (!customer) {
      router.push(`/login?redirect=/account/orders/${params.id as string}`);
      return;
    }

    async function loadOrder() {
      const result = await getOrderWithItems(params.id as string);
      if (result) {
        if (result.order.customer_id !== customer.id) {
          router.push('/account/dashboard');
          return;
        }
        setOrder(result.order);
        setItems(result.items);
      }
      setLoading(false);
    }

    loadOrder();
  }, [params.id, customer, customerLoading, router]);

  if (customerLoading || loading) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation showTicker={false} />
        <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 text-center">
          <div className="animate-pulse text-ink-muted text-xs sm:text-sm">Loading...</div>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation showTicker={false} />
        <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28 px-4 sm:px-8">
          <div className="max-w-md mx-auto text-center">
            <div className="w-12 sm:w-14 h-12 sm:h-14 bg-vital-100 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Beaker className="w-6 sm:w-7 h-6 sm:h-7 text-ink-light" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink mb-2 sm:mb-3">Order Not Found</h1>
            <p className="text-ink-muted text-xs sm:text-sm mb-4 sm:mb-6">This order doesn&apos;t exist or you don&apos;t have access to it.</p>
            <Link
              href="/account/dashboard"
              className="inline-flex items-center gap-2 text-vital-600 hover:text-vital-700 font-semibold text-xs sm:text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  const status = getOrderStatusDisplay(order.status);

  return (
    <main className="min-h-screen bg-white">
      <Navigation showTicker={false} />

      <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 lg:px-12">
          {/* Back Link */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-4 sm:mb-6">
            <Link
              href="/account/dashboard"
              className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors text-xs sm:text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </motion.div>

          {/* Order Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6 mb-4 sm:mb-5 md:mb-6"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
              <div>
                <span className="text-[10px] sm:text-xs font-semibold text-vital-600 uppercase tracking-[0.2em] mb-1 sm:mb-2 block">
                  Order Details
                </span>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink break-all">#{order.order_number}</h1>
                <p className="text-ink-muted text-[10px] sm:text-xs md:text-sm mt-1">
                  Placed on{' '}
                  {new Date(order.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium border ${status.color}`}>
                <status.Icon className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                <span>{status.label}</span>
              </div>
            </div>

            {order.tracking_number && (
              <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-vital-100">
                <p className="text-xs sm:text-sm text-ink-muted break-all">
                  <span className="font-medium text-vital-800">Tracking Number:</span>{' '}
                  <span className="font-mono">{order.tracking_number}</span>
                </p>
              </div>
            )}
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
            {/* Order Items */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="md:col-span-2"
            >
              <div className="bg-white rounded-xl border border-vital-200 overflow-hidden">
                <div className="p-4 sm:p-5 md:p-6 border-b border-vital-100">
                  <h2 className="text-sm sm:text-base font-bold text-ink">Order Items</h2>
                </div>
                <div className="divide-y divide-vital-100">
                  {items.map((item, index) => (
                    <div key={item.id} className="p-3 sm:p-4 md:p-5 flex items-center gap-3 sm:gap-4">
                      <div className="w-12 sm:w-14 h-12 sm:h-14 bg-vital-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Beaker className="w-5 sm:w-6 h-5 sm:h-6 text-vital-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-ink text-xs sm:text-sm flex items-center gap-2 flex-wrap">
                          {item.product_name || `Product ${index + 1}`}
                          {(item.price_type === 'vial' || item.price_type === 'box') && (
                            <span
                              className={`inline-flex px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium uppercase tracking-wide ${
                                item.price_type === 'vial'
                                  ? 'bg-indigo-50 text-indigo-600'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {item.price_type === 'vial' ? 'Single vial' : 'Pack of 10'}
                            </span>
                          )}
                        </h3>
                        {item.product_strength && (
                          <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5">{item.product_strength}</p>
                        )}
                        <p className="text-[10px] sm:text-xs text-ink-light mt-1">Qty: {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-ink text-xs sm:text-sm tabular-nums">
                          ${(item.price_at_time * item.quantity).toFixed(2)}
                        </p>
                        <p className="text-[10px] sm:text-xs text-ink-muted tabular-nums">${item.price_at_time.toFixed(2)} each</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Order Summary */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4 sm:space-y-5"
            >
              {/* Totals */}
              {(() => {
                const itemsSubtotal = items.reduce(
                  (s, i) => s + i.price_at_time * i.quantity,
                  0,
                );
                const discount = Number(order.discount_amount) || 0;
                // Shipping was folded into the order total; recover it.
                const shipping = Math.max(
                  0,
                  Number((order.total - (itemsSubtotal - discount)).toFixed(2)),
                );
                return (
                  <div className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6">
                    <h3 className="text-sm sm:text-base font-bold text-ink mb-3 sm:mb-4">Order Summary</h3>
                    <div className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                      <div className="flex justify-between text-ink-muted">
                        <span>Subtotal</span>
                        <span className="tabular-nums">${itemsSubtotal.toFixed(2)}</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex justify-between text-emerald-600">
                          <span>Affiliate discount</span>
                          <span className="tabular-nums">-${discount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-ink-muted">
                        <span>Shipping</span>
                        <span className="tabular-nums">
                          {shipping > 0 ? `$${shipping.toFixed(2)}` : <span className="text-emerald-600 font-medium">Free</span>}
                        </span>
                      </div>
                      <div className="border-t border-vital-100 pt-2 sm:pt-3">
                        <div className="flex justify-between">
                          <span className="font-bold text-ink">Total</span>
                          <span className="font-bold text-base sm:text-lg text-ink tabular-nums">
                            ${order.total.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleViewInvoice}
                      disabled={invoiceLoading}
                      className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink hover:bg-vital-800 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      <FileText className="w-4 h-4" />
                      {invoiceLoading ? 'Preparing invoice…' : 'Download Invoice'}
                    </button>
                  </div>
                );
              })()}

              {/* Shipping Address */}
              {order.shipping_address && (
                <div className="bg-white rounded-xl border border-vital-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2 mb-3 sm:mb-4">
                    <MapPin className="w-4 h-4 text-vital-600" />
                    Shipping Address
                  </h3>
                  <div className="text-ink-muted text-xs sm:text-sm leading-relaxed">
                    {typeof order.shipping_address === 'string' ? (
                      <p className="whitespace-pre-line">{order.shipping_address}</p>
                    ) : (
                      (() => {
                        const a = order.shipping_address as any;
                        const name = [a.firstName, a.lastName].filter(Boolean).join(' ');
                        const cityLine = [a.city, a.state, a.postalCode].filter(Boolean).join(', ');
                        return (
                          <>
                            {name && <p>{name}</p>}
                            {a.address && <p>{a.address}</p>}
                            {cityLine && <p>{cityLine}</p>}
                            {a.country && <p>{a.country}</p>}
                          </>
                        );
                      })()
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
