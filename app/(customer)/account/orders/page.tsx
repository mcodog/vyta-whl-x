'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/contexts/CustomerContext';
import { getCustomerOrders } from '@/lib/customer/api';
import { getOrderStatusDisplay } from '@/lib/customer/order-status';
import { Package, Clock, ExternalLink, Beaker, Loader2, ArrowLeft } from 'lucide-react';

interface OrderSummary {
  id: string;
  order_number: string;
  status: string;
  total: number;
  crypto: string;
  payment_tx_hash: string | null;
  tracking_number: string | null;
  created_at: string;
}

export default function OrderHistoryPage() {
  const router = useRouter();
  const { customer, isLoading: customerLoading } = useCustomer();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (customerLoading) return;
    if (!customer) {
      router.push('/login?redirect=/account/orders');
      return;
    }

    const fetchOrders = async () => {
      try {
        const data = await getCustomerOrders(customer.id);
        setOrders(data as unknown as OrderSummary[]);
      } catch (err: any) {
        setError('Failed to fetch orders');
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [customer, customerLoading, router]);

  if (customerLoading || (loading && customer)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-6 h-6 text-bronze animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-8 sm:py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/account/dashboard" className="p-2 rounded-lg hover:bg-surface transition-colors">
            <ArrowLeft className="w-5 h-5 text-ink" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Order History</h1>
            <p className="text-sm text-ink-muted">View all your past orders</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {orders.length === 0 && !loading ? (
          <div className="bg-surface rounded-2xl p-10 text-center border border-line">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line">
              <Package className="w-8 h-8 text-ink-muted" />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-2">No orders yet</h2>
            <p className="text-ink-muted text-sm mb-6">Your order history will appear here after your first purchase.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm"
            >
              Browse Products
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Link
                key={order.order_number}
                href={`/account/orders/${order.id}`}
                className="block bg-white rounded-xl border border-line p-4 sm:p-5 hover:shadow-md transition-all group"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line flex-shrink-0">
                      <Package className="w-5 h-5 text-ink-muted" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm break-all">{order.order_number}</p>
                      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span>{new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {(() => {
                      const s = getOrderStatusDisplay(order.status);
                      return (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}>
                          <s.Icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      );
                    })()}
                    <ExternalLink className="w-4 h-4 text-ink-muted group-hover:text-bronze transition-colors" />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-sm">
                  <span className="text-ink-muted break-all">
                    {order.crypto.toUpperCase()}
                    {order.tracking_number && <span className="sm:ml-2">| Tracking: {order.tracking_number}</span>}
                  </span>
                  <span className="font-semibold text-ink tabular-nums flex-shrink-0">${Number(order.total).toFixed(2)} CAD</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
