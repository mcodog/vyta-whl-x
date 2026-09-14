'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Package, User, MapPin, CreditCard, Tag, Truck, Copy, Check, Save, Mail, FileText, DollarSign, X, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getOrderDetail, updateOrderStatus, updateOrderTracking, recordOrderPayment } from '@/lib/admin/api';
import { sourceLabel, sourceBadgeClasses } from '@/lib/orderSource';
import { paymentMethodLabel, RECORDED_PAYMENT_METHODS, recordedPaymentMethodLabel } from '@/lib/paymentMethod';
import type { RecordedPaymentMethod } from '@/lib/supabase';
import { deriveOrderTotals } from '@/lib/orderTotals';
import ShippingLabelPanel from './_components/ShippingLabelPanel';
import AutoShipmentReport from './_components/AutoShipmentReport';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  received: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  confirmed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  processing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  shipped: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const statusSteps = ['pending', 'received', 'confirmed', 'processing', 'shipped', 'delivered'];

export default function OrderDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const [copied, setCopied] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState('');

  // Record Payment modal state.
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState<RecordedPaymentMethod>('etransfer');
  const [payReceivedAt, setPayReceivedAt] = useState('');
  const [payFull, setPayFull] = useState(true);
  const [payAmount, setPayAmount] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  const reloadOrder = async () => {
    const updated = await getOrderDetail(id as string);
    setData(updated);
    setTrackingInput(updated?.order?.tracking_number || '');
  };

  useEffect(() => {
    if (id) {
      getOrderDetail(id as string).then((result) => {
        setData(result);
        setTrackingInput(result?.order?.tracking_number || '');
        setLoading(false);
      });
    }
  }, [id]);

  const handleStatusChange = async (status: string) => {
    if (!data) return;
    setUpdating(true);
    await updateOrderStatus(data.order.id, status as any);
    const updated = await getOrderDetail(id as string);
    setData(updated);
    setUpdating(false);
  };

  const handleSaveTracking = async () => {
    if (!data) return;
    setSavingTracking(true);
    await updateOrderTracking(data.order.id, trackingInput);
    const updated = await getOrderDetail(id as string);
    setData(updated);
    setSavingTracking(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const sendShippingEmail = async () => {
    if (!data || !order.customer_email) return;
    setEmailSending(true);
    try {
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'shipping_notification',
          to: order.customer_email,
          customerName: order.customer_name || 'Customer',
          orderNumber: order.order_number,
          trackingNumber: trackingInput || order.tracking_number || 'Pending',
        }),
      });
      if (res.ok) {
        setEmailSent('shipping');
        setTimeout(() => setEmailSent(''), 3000);
      }
    } catch (err) {
      console.error('Failed to send email:', err);
    }
    setEmailSending(false);
  };

  const sendOrderConfirmationEmail = async () => {
    if (!data || !order.customer_email) return;
    setEmailSending(true);
    try {
      const totals = deriveOrderTotals(order, items);
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order_confirmation',
          to: order.customer_email,
          customerName: order.customer_name || 'Customer',
          orderNumber: order.order_number,
          items: items.map((item: any) => ({
            name: item.product_name || 'Product',
            quantity: item.quantity,
            price: item.price_at_time,
            strength: item.product_strength,
          })),
          subtotal: totals.discountedSubtotal,
          shipping: totals.shipping,
          total: totals.total,
          currency: order.currency || 'CAD',
        }),
      });
      if (res.ok) {
        setEmailSent('confirmation');
        setTimeout(() => setEmailSent(''), 3000);
      }
    } catch (err) {
      console.error('Failed to send email:', err);
    }
    setEmailSending(false);
  };

  // Seed the modal from any existing recorded payment, defaulting the date to
  // today and the amount to the order total.
  const openPayModal = () => {
    if (!data) return;
    const o = data.order;
    const today = new Date().toISOString().slice(0, 10);
    const orderTotal = deriveOrderTotals(o, data.items).total;
    setPayMethod((o.payment_method as RecordedPaymentMethod) || 'etransfer');
    setPayReceivedAt(o.payment_received_at ? o.payment_received_at.slice(0, 10) : today);
    const isPartial = o.payment_received_status === 'partial';
    setPayFull(!isPartial);
    setPayAmount(
      isPartial && o.payment_received_amount != null
        ? String(o.payment_received_amount)
        : orderTotal.toFixed(2),
    );
    setPayError('');
    setShowPayModal(true);
  };

  const submitPayment = async () => {
    if (!data) return;
    setPayError('');
    const orderTotal = deriveOrderTotals(data.order, data.items).total;
    const amount = payFull ? orderTotal : Number(payAmount);
    if (!payFull && (!Number.isFinite(amount) || amount <= 0)) {
      setPayError('Enter the amount received');
      return;
    }
    if (!payReceivedAt) {
      setPayError('Select the date received');
      return;
    }
    setPaySaving(true);
    const res = await recordOrderPayment(data.order.id, {
      method: payMethod,
      // Interpret the picked calendar day as local midnight.
      receivedAt: new Date(`${payReceivedAt}T00:00:00`).toISOString(),
      status: payFull ? 'full' : 'partial',
      amount,
    });
    setPaySaving(false);
    if (!res.success) {
      setPayError(res.error || 'Could not record payment');
      return;
    }
    setShowPayModal(false);
    await reloadOrder();
  };

  if (loading) {
    return <div className="text-center py-20 text-ink-muted text-sm animate-pulse">Loading order...</div>;
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted mb-4">Order not found</p>
        <Link href="/admin/orders" className="text-vital hover:text-vital/80 text-sm">Back to Orders</Link>
      </div>
    );
  }

  const { order, items, commission, autoShipmentLogs } = data;
  const currentStepIndex = statusSteps.indexOf(order.status);
  // Shipping was charged via Easyship (or free for pickup) and folded into the
  // order total — recover the real figures instead of assuming a flat fee.
  const totals = deriveOrderTotals(order, items);
  const isPickup = order.fulfillment_type === 'pickup' || order.notes === 'PICKUP';

  return (
    <>
      {/* Back + Title */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/orders" className="text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-ink font-mono">{order.order_number}</h1>
            <p className="text-xs text-ink-muted mt-1">
              Created {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.source && (
            <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-medium ${sourceBadgeClasses(order.source)}`}>
              {sourceLabel(order.source)}
            </span>
          )}
          <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-medium border ${statusColors[order.status] || 'bg-gray-500/10 text-ink-muted border-gray-500/20'}`}>
            {order.status}
          </span>
        </div>
      </div>

      {/* Status Progress */}
      {order.status !== 'cancelled' && (
        <div className="bg-white rounded-xl border border-line p-5 mb-6 overflow-x-auto">
          <div className="flex items-center justify-between min-w-[480px]">
            {statusSteps.map((step, i) => (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    i <= currentStepIndex
                      ? 'bg-ink text-white'
                      : 'bg-surface text-ink-muted'
                  }`}>
                    {i <= currentStepIndex ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider ${i <= currentStepIndex ? 'text-vital' : 'text-ink-muted'}`}>
                    {step}
                  </span>
                </div>
                {i < statusSteps.length - 1 && (
                  <div className={`flex-1 h-px mx-2 ${i < currentStepIndex ? 'bg-ink' : 'bg-surface'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="p-5 border-b border-line flex items-center gap-2">
              <Package className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink">Order Items</h2>
            </div>
            <div className="divide-y divide-line/50">
              {items.map((item: any) => (
                <div key={item.id} className="p-5 flex items-center gap-4">
                  <div className="w-12 h-12 bg-surface rounded-lg flex items-center justify-center flex-shrink-0">
                    {item.product_image ? (
                      <img src={item.product_image} alt="" className="w-full h-full object-contain rounded-lg p-1" />
                    ) : (
                      <Package className="w-5 h-5 text-ink-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink text-sm flex items-center gap-2 flex-wrap">
                      {item.product_name || 'Unknown Product'}
                      {(item.price_type === 'vial' || item.price_type === 'box') && (
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                            item.price_type === 'vial'
                              ? 'bg-indigo-500/10 text-indigo-600'
                              : 'bg-vital/10 text-vital'
                          }`}
                          title={item.price_type === 'vial' ? 'Sold at the single-vial price' : 'Sold at the pack-of-10 (box) price'}
                        >
                          {item.price_type === 'vial' ? 'Single vial' : 'Pack of 10'}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-muted">{item.product_strength}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-ink-muted">x{item.quantity}</p>
                    <p className="font-semibold text-ink tabular-nums">${(Number(item.price_at_time) * item.quantity).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-line space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Subtotal</span>
                <span className="text-ink tabular-nums">${totals.rawSubtotal.toFixed(2)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">Discount</span>
                  <span className="text-emerald-600 tabular-nums">-${totals.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Shipping</span>
                {isPickup ? (
                  <span className="text-emerald-600 tabular-nums">Free (Pickup)</span>
                ) : (
                  <span className="text-ink tabular-nums">${totals.shipping.toFixed(2)}</span>
                )}
              </div>
              <div className="flex justify-between text-base font-bold pt-2 border-t border-line">
                <span className="text-ink">Total</span>
                <span className="text-ink tabular-nums">${totals.total.toFixed(2)} CAD</span>
              </div>
            </div>
          </div>

          {/* Payment Details */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-ink-muted" />
                <h2 className="font-semibold text-ink">Payment Details</h2>
              </div>
              <button
                onClick={openPayModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/10 border border-emerald-600/20 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-600/20 transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5" />
                {order.payment_received_at ? 'Edit Payment' : 'Record Payment'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-ink-muted mb-1">Payment Method</p>
                <p className="text-ink">{paymentMethodLabel(order.crypto)}</p>
              </div>
              <div>
                <p className="text-ink-muted mb-1">Status</p>
                <p className="text-ink">{order.status}</p>
              </div>
              {order.payment_received_at && (
                <>
                  <div>
                    <p className="text-ink-muted mb-1">Recorded Method</p>
                    <p className="text-ink">{recordedPaymentMethodLabel(order.payment_method)}</p>
                  </div>
                  <div>
                    <p className="text-ink-muted mb-1">Date Received</p>
                    <p className="text-ink">{new Date(order.payment_received_at).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-ink-muted mb-1">Payment Received</p>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        order.payment_received_status === 'partial'
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-emerald-500/10 text-emerald-600'
                      }`}
                    >
                      {order.payment_received_status === 'partial' ? 'Partial' : 'In full'}
                    </span>
                  </div>
                  {order.payment_received_amount != null && (
                    <div>
                      <p className="text-ink-muted mb-1">Amount Received</p>
                      <p className="text-ink tabular-nums">${Number(order.payment_received_amount).toFixed(2)}</p>
                    </div>
                  )}
                </>
              )}
              {order.payment_amount_expected && (
                <div>
                  <p className="text-ink-muted mb-1">Expected Amount</p>
                  <p className="text-ink tabular-nums">{order.payment_amount_expected} {order.crypto?.toUpperCase()}</p>
                </div>
              )}
              {order.payment_amount_received && (
                <div>
                  <p className="text-ink-muted mb-1">Received Amount</p>
                  <p className="text-ink tabular-nums">{order.payment_amount_received} {order.crypto?.toUpperCase()}</p>
                </div>
              )}
              {order.payment_address && (
                <div className="col-span-2">
                  <p className="text-ink-muted mb-1">Payment Address</p>
                  <div className="flex items-center gap-2">
                    <p className="text-ink font-mono text-xs break-all">{order.payment_address}</p>
                    <button onClick={() => copyToClipboard(order.payment_address, 'addr')} className="text-ink-muted hover:text-ink flex-shrink-0">
                      {copied === 'addr' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}
              {order.payment_tx_hash && (
                <div className="col-span-2">
                  <p className="text-ink-muted mb-1">Transaction Hash</p>
                  <div className="flex items-center gap-2">
                    <p className="text-ink font-mono text-xs break-all">{order.payment_tx_hash}</p>
                    <button onClick={() => copyToClipboard(order.payment_tx_hash, 'txn')} className="text-ink-muted hover:text-ink flex-shrink-0">
                      {copied === 'txn' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Affiliate / Commission */}
          {(commission || order.referral_code) && (
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="flex items-center gap-2 mb-4">
                <Tag className="w-4 h-4 text-vital" />
                <h2 className="font-semibold text-ink">Affiliate Commission</h2>
              </div>
              {order.referral_code && (
                <div className="mb-3">
                  <p className="text-ink-muted text-sm mb-1">Referral Code Used</p>
                  <span className="font-mono text-vital bg-vital/10 px-2 py-0.5 rounded text-sm">{order.referral_code}</span>
                </div>
              )}
              {commission && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-ink-muted mb-1">Affiliate</p>
                    <p className="text-ink break-words">{commission.affiliate_name}</p>
                    <p className="text-ink-muted text-xs break-all">{commission.affiliate_email}</p>
                  </div>
                  <div>
                    <p className="text-ink-muted mb-1">Commission</p>
                    <p className="text-emerald-400 font-semibold tabular-nums">${Number(commission.amount || 0).toFixed(2)}</p>
                    <p className="text-ink-muted text-xs">{(commission.commission_rate * 100).toFixed(0)}% rate</p>
                  </div>
                  <div>
                    <p className="text-ink-muted mb-1">Status</p>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      commission.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {commission.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink">Customer</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-ink font-medium">{order.customer_name || 'Guest Checkout'}</p>
                {order.customer_email && (
                  <p className="text-ink-muted break-all">{order.customer_email}</p>
                )}
                {order.customer_phone && (
                  <p className="text-ink-muted">{order.customer_phone}</p>
                )}
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink">Shipping Address</h2>
            </div>
            <div className="text-sm text-ink space-y-1">
              {order.shipping_address && typeof order.shipping_address === 'object' ? (
                <>
                  {order.shipping_address.firstName && <p>{order.shipping_address.firstName} {order.shipping_address.lastName}</p>}
                  <p>{order.shipping_address.address}</p>
                  <p>{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postalCode}</p>
                  <p>{order.shipping_address.country}</p>
                  {order.shipping_address.phone && <p className="text-ink-muted">{order.shipping_address.phone}</p>}
                </>
              ) : order.shipping_address ? (
                <p className="whitespace-pre-line">{String(order.shipping_address)}</p>
              ) : order.customer_shipping ? (
                <>
                  <p>{order.customer_shipping.address}</p>
                  <p>{order.customer_shipping.city}, {order.customer_shipping.state}</p>
                  <p>{order.customer_shipping.postal_code}</p>
                  <p>{order.customer_shipping.country}</p>
                </>
              ) : (
                <p className="text-ink-muted">No address on file</p>
              )}
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-ink-muted" />
                <h2 className="font-semibold text-ink">Notes</h2>
              </div>
              <p className="text-sm text-ink whitespace-pre-line break-words">{order.notes}</p>
            </div>
          )}

          {/* Tracking */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="flex items-center gap-2 mb-4">
              <Truck className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink">Tracking</h2>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                placeholder="Enter tracking number"
                className="flex-1 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
              />
              <button
                onClick={handleSaveTracking}
                disabled={savingTracking}
                className="px-3 py-2 bg-vital/10 border border-vital/20 text-vital rounded-lg text-sm hover:bg-vital/20 transition-colors disabled:opacity-50"
              >
                {savingTracking ? '...' : <Save className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-ink-muted mt-2">
              Manual tracking number. To buy a carrier label, use Shipping Label below.
            </p>
          </div>

          {/* Automatic shipping report — did auto shipment/label creation run,
              and if it failed, exactly why (server-side; never customer-facing) */}
          <AutoShipmentReport order={order} logs={autoShipmentLogs ?? []} />

          {/* Shipping Label — Easyship, gated by a readiness checklist */}
          <ShippingLabelPanel orderId={order.id} onChanged={reloadOrder} />

          {/* Update Status */}
          <div className="bg-white rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4">Update Status</h2>
            <select
              value={order.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={updating}
              className="w-full px-3 py-2.5 bg-surface border border-line text-ink rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-50"
            >
              <option value="pending">Pending</option>
              <option value="received">Payment Received</option>
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Email Notifications */}
          {order.customer_email && (
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="flex items-center gap-2 mb-4">
                <Mail className="w-4 h-4 text-ink-muted" />
                <h2 className="font-semibold text-ink">Email Customer</h2>
              </div>
              <div className="space-y-2">
                <button
                  onClick={sendOrderConfirmationEmail}
                  disabled={emailSending}
                  className="w-full px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {emailSent === 'confirmation' ? (
                    <><Check className="w-3.5 h-3.5" /> Sent!</>
                  ) : (
                    <><Mail className="w-3.5 h-3.5" /> Send Order Confirmation</>
                  )}
                </button>
                <button
                  onClick={sendShippingEmail}
                  disabled={emailSending || !trackingInput}
                  className="w-full px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {emailSent === 'shipping' ? (
                    <><Check className="w-3.5 h-3.5" /> Sent!</>
                  ) : (
                    <><Truck className="w-3.5 h-3.5" /> Send Shipping Notification</>
                  )}
                </button>
                {!trackingInput && (
                  <p className="text-[10px] text-ink-muted">Add tracking number to enable shipping email</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Record Payment modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-emerald-700">Record Payment</h3>
              <button onClick={() => setShowPayModal(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Payment method — mirrors the shipping courier selection */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as RecordedPaymentMethod)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                >
                  {RECORDED_PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Date received */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Date Received</label>
                <input
                  type="date"
                  value={payReceivedAt}
                  onChange={(e) => setPayReceivedAt(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>

              {/* Partial vs. full toggle */}
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Amount Received</label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-surface border border-line rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPayFull(true)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      payFull ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    In full
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayFull(false)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      !payFull ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    Partially received
                  </button>
                </div>
                {payFull ? (
                  <p className="text-xs text-ink-muted mt-2">Records the full order total of ${totals.total.toFixed(2)} as received.</p>
                ) : (
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder={totals.total.toFixed(2)}
                    className="w-full mt-2 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                )}
                {!payFull && (
                  <p className="text-xs text-ink-muted mt-1">Order total: ${totals.total.toFixed(2)}</p>
                )}
              </div>

              {payError && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {payError}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowPayModal(false)} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
              <button
                onClick={submitPayment}
                disabled={paySaving}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {paySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
