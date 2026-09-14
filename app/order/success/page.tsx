'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Package, Truck, Copy, Check, ExternalLink, Mail, Beaker } from 'lucide-react';

interface OrderData {
  order_number: string;
  status: string;
  items: { name: string; quantity: number; price: number; strength?: string }[];
  total: number;
  crypto: string;
  payment_tx_hash: string | null;
  tracking_number: string | null;
  created_at: string;
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');

  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderNumber) {
      setError('No order number found');
      setLoading(false);
      return;
    }

    const fetchOrder = async () => {
      try {
        const response = await fetch(`/api/orders?orderNumber=${orderNumber}`);
        if (!response.ok) {
          throw new Error('Order not found');
        }
        const data = await response.json();
        setOrderData(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load order');
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [orderNumber]);

  const copyOrderNumber = async () => {
    if (orderData?.order_number) {
      await navigator.clipboard.writeText(orderData.order_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 sm:h-12 w-10 sm:w-12 border-4 border-bronze border-t-transparent mx-auto mb-4"></div>
          <p className="text-ink-muted text-xs sm:text-sm">Loading order details...</p>
        </div>
      </div>
    );
  }

  if (error || !orderData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="text-center">
          <div className="bg-red-100 rounded-full w-14 sm:w-16 h-14 sm:h-16 flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 sm:w-8 h-7 sm:h-8 text-red-500" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-2">Order Not Found</h1>
          <p className="text-ink-muted mb-6 text-xs sm:text-sm">{error || 'Unable to find this order'}</p>
          <Link
            href="/products"
            className="inline-flex items-center px-5 sm:px-6 py-2.5 sm:py-3 bg-ink text-white rounded-xl font-semibold hover:bg-ink/90 transition-all text-xs sm:text-sm"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-8 sm:py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Success Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="bg-emerald-100 rounded-full w-16 sm:w-20 h-16 sm:h-20 flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <CheckCircle className="w-8 sm:w-10 h-8 sm:h-10 text-emerald-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink mb-2">
            Payment Confirmed!
          </h1>
          <p className="text-ink-muted text-xs sm:text-sm">
            Thank you for your order. We&apos;ve received your payment.
          </p>
        </div>

        {/* Order Card */}
        <div className="bg-white rounded-2xl border border-line shadow-lg overflow-hidden mb-4 sm:mb-6">
          <div className="bg-ink px-4 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center justify-between text-white">
              <div>
                <p className="text-white/60 text-[10px] sm:text-sm">Order Number</p>
                <p className="font-bold text-base sm:text-lg">{orderData.order_number}</p>
              </div>
              <div className="text-right">
                <p className="text-white/60 text-[10px] sm:text-sm">Total</p>
                <p className="font-bold text-lg sm:text-xl tabular-nums">${Number(orderData.total).toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {/* Order Number with copy */}
            <div className="mb-4 sm:mb-6">
              <label className="block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2">Order Number</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-sm font-mono truncate border border-line">
                  {orderData.order_number}
                </code>
                <button
                  onClick={copyOrderNumber}
                  className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                    copied ? 'bg-emerald-100 text-emerald-600' : 'bg-surface hover:bg-line text-ink-muted'
                  }`}
                >
                  {copied ? <Check className="w-4 sm:w-5 h-4 sm:h-5" /> : <Copy className="w-4 sm:w-5 h-4 sm:h-5" />}
                </button>
              </div>
              <p className="text-[10px] sm:text-xs text-ink-muted mt-1">Save this to track your order</p>
            </div>

            {/* Order Status Timeline */}
            <div className="mb-4 sm:mb-6">
              <h3 className="font-semibold text-ink mb-3 sm:mb-4 text-sm sm:text-base">Order Status</h3>
              <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
                <div className="flex items-center flex-shrink-0">
                  <div className="w-6 sm:w-8 h-6 sm:h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-3 sm:w-4 h-3 sm:h-4 text-white" />
                  </div>
                  <span className="ml-1 sm:ml-2 text-[10px] sm:text-sm font-medium text-emerald-700">Confirmed</span>
                </div>
                <div className="flex-1 h-1 bg-surface mx-1 sm:mx-2 min-w-[20px]">
                  <div className={`h-full ${orderData.status === 'processing' || orderData.status === 'shipped' || orderData.status === 'delivered' ? 'bg-emerald-500' : 'bg-surface'} transition-all`} style={{ width: orderData.status === 'confirmed' ? '0%' : orderData.status === 'processing' ? '50%' : '100%' }}></div>
                </div>
                <div className="flex items-center flex-shrink-0">
                  <div className={`w-6 sm:w-8 h-6 sm:h-8 rounded-full flex items-center justify-center ${
                    orderData.status === 'processing' || orderData.status === 'shipped' || orderData.status === 'delivered'
                      ? 'bg-emerald-500' : 'bg-surface border border-line'
                  }`}>
                    <Package className={`w-3 sm:w-4 h-3 sm:h-4 ${
                      orderData.status === 'processing' || orderData.status === 'shipped' || orderData.status === 'delivered'
                        ? 'text-white' : 'text-ink-muted'
                    }`} />
                  </div>
                  <span className={`ml-1 sm:ml-2 text-[10px] sm:text-sm font-medium ${
                    orderData.status === 'processing' || orderData.status === 'shipped' || orderData.status === 'delivered'
                      ? 'text-emerald-700' : 'text-ink-muted'
                  }`}>Processing</span>
                </div>
                <div className="flex-1 h-1 bg-surface mx-1 sm:mx-2 min-w-[20px]">
                  <div className={`h-full ${orderData.status === 'shipped' || orderData.status === 'delivered' ? 'bg-emerald-500' : 'bg-surface'} transition-all`} style={{ width: orderData.status === 'shipped' || orderData.status === 'delivered' ? '100%' : '0%' }}></div>
                </div>
                <div className="flex items-center flex-shrink-0">
                  <div className={`w-6 sm:w-8 h-6 sm:h-8 rounded-full flex items-center justify-center ${
                    orderData.status === 'shipped' || orderData.status === 'delivered'
                      ? 'bg-emerald-500' : 'bg-surface border border-line'
                  }`}>
                    <Truck className={`w-3 sm:w-4 h-3 sm:h-4 ${
                      orderData.status === 'shipped' || orderData.status === 'delivered'
                        ? 'text-white' : 'text-ink-muted'
                    }`} />
                  </div>
                  <span className={`ml-1 sm:ml-2 text-[10px] sm:text-sm font-medium ${
                    orderData.status === 'shipped' || orderData.status === 'delivered'
                      ? 'text-emerald-700' : 'text-ink-muted'
                  }`}>Shipped</span>
                </div>
              </div>
            </div>

            {/* Transaction Hash */}
            {orderData.payment_tx_hash && (
              <div className="mb-4 sm:mb-6">
                <label className="block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2">Transaction Hash</label>
                <div className="bg-surface rounded-lg p-2 sm:p-3 break-all border border-line">
                  <code className="text-[10px] sm:text-xs text-ink">{orderData.payment_tx_hash}</code>
                </div>
              </div>
            )}

            {/* Order Items */}
            <div className="border-t border-line pt-4 sm:pt-6">
              <h3 className="font-semibold text-ink mb-3 sm:mb-4 text-sm sm:text-base">Items Ordered</h3>
              <div className="space-y-2 sm:space-y-3">
                {orderData.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-ink text-xs sm:text-sm">{item.name}</p>
                      <p className="text-[10px] sm:text-sm text-ink-muted">Qty: {item.quantity}</p>
                    </div>
                    <span className="font-semibold text-xs sm:text-sm tabular-nums">${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* What's Next */}
        <div className="bg-white rounded-xl border border-line p-4 sm:p-6 mb-4 sm:mb-6">
          <h3 className="font-semibold text-ink mb-3 sm:mb-4 text-sm sm:text-base">What&apos;s Next?</h3>
          <div className="space-y-2 sm:space-y-3 text-[10px] sm:text-sm text-ink-muted">
            <div className="flex items-start gap-2 sm:gap-3">
              <Mail className="w-4 sm:w-5 h-4 sm:h-5 text-bronze flex-shrink-0 mt-0.5" />
              <p>You&apos;ll receive an email confirmation shortly with your order details.</p>
            </div>
            <div className="flex items-start gap-2 sm:gap-3">
              <Package className="w-4 sm:w-5 h-4 sm:h-5 text-bronze flex-shrink-0 mt-0.5" />
              <p>Our team will process your order within 1-2 business days.</p>
            </div>
            <div className="flex items-start gap-2 sm:gap-3">
              <Truck className="w-4 sm:w-5 h-4 sm:h-5 text-bronze flex-shrink-0 mt-0.5" />
              <p>Once shipped, you&apos;ll receive tracking information via email.</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6 sm:mb-8">
          <Link
            href="/account/dashboard"
            className="flex-1 inline-flex items-center justify-center px-5 sm:px-6 py-2.5 sm:py-3 bg-ink text-white rounded-xl font-semibold hover:bg-ink/90 transition-all text-xs sm:text-sm"
          >
            View My Orders
            <ExternalLink className="w-4 h-4 ml-2" />
          </Link>
          <Link
            href="/products"
            className="flex-1 inline-flex items-center justify-center px-5 sm:px-6 py-2.5 sm:py-3 border border-line text-ink rounded-xl font-semibold hover:bg-surface transition-colors text-xs sm:text-sm"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-ink text-sm sm:text-xl">Loading...</div>
        </div>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
