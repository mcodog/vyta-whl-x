"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useCart } from "@/lib/cart";
import { SUPPORTED_CURRENCIES, SupportedCurrency } from "@/lib/metacortex";
import {
  ArrowLeft,
  Trash2,
  Plus,
  Minus,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  QrCode,
} from "lucide-react";

type CheckoutStep = "cart" | "payment" | "processing" | "complete";

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  payment_address: string;
  payment_url: string;
  status: string;
  expires_at: string;
}

export default function CheckoutPage() {
  const { items, updateQuantity, removeItem, total, clearCart } = useCart();
  const [step, setStep] = useState<CheckoutStep>("cart");
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>("USDT_TRC20");
  const [email, setEmail] = useState("");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCheckout = async () => {
    if (items.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          currency: selectedCurrency,
          email: email || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Checkout failed");
      }

      setInvoice(data.invoice);
      setStep("payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = async () => {
    if (!invoice?.payment_address) return;
    await navigator.clipboard.writeText(invoice.payment_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkPaymentStatus = async () => {
    if (!invoice?.invoice_number) return;

    try {
      const response = await fetch(`/api/invoice/${invoice.invoice_number}`);
      const data = await response.json();

      if (data.invoice?.status === "paid") {
        setStep("complete");
        clearCart();
      } else if (data.invoice?.status === "confirming") {
        setStep("processing");
      }
    } catch {
      // Silent fail - user can retry
    }
  };

  // Poll for payment status when on payment step
  useState(() => {
    if (step === "payment" || step === "processing") {
      const interval = setInterval(checkPaymentStatus, 5000);
      return () => clearInterval(interval);
    }
  });

  const currencyInfo = SUPPORTED_CURRENCIES.find(
    (c) => c.code === selectedCurrency
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Continue Shopping</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 mb-12">
          {["Cart", "Payment", "Complete"].map((label, index) => {
            const stepIndex = ["cart", "payment", "complete"].indexOf(step);
            const isActive = index <= stepIndex;
            const isCurrent = index === stepIndex;

            return (
              <div key={label} className="flex items-center gap-4">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-600 text-white"
                      : "bg-neutral-200 text-neutral-500"
                  } ${isCurrent ? "ring-4 ring-emerald-100" : ""}`}
                >
                  {index + 1}
                </div>
                <span
                  className={`text-sm ${
                    isActive ? "text-neutral-900" : "text-neutral-500"
                  }`}
                >
                  {label}
                </span>
                {index < 2 && (
                  <div
                    className={`w-12 h-0.5 ${
                      index < stepIndex ? "bg-emerald-600" : "bg-neutral-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {/* Cart Step */}
          {step === "cart" && (
            <motion.div
              key="cart"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                <div className="p-6 border-b border-neutral-100">
                  <h1 className="text-2xl font-semibold text-neutral-900">
                    Your Cart
                  </h1>
                </div>

                {items.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-neutral-500 mb-4">Your cart is empty</p>
                    <Link
                      href="/products"
                      className="inline-flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Browse Products
                      <ArrowLeft className="w-4 h-4 rotate-180" />
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="p-6 flex items-center gap-6"
                      >
                        <div className="flex-1">
                          <h3 className="font-medium text-neutral-900">
                            {item.name}
                          </h3>
                          {item.strength && (
                            <p className="text-sm text-neutral-500">
                              {item.strength}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              updateQuantity(item.id, item.quantity - 1)
                            }
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-medium">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() =>
                              updateQuantity(item.id, item.quantity + 1)
                            }
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="w-28 text-right">
                          <p className="font-semibold text-neutral-900">
                            CA${(item.price * item.quantity).toFixed(2)}
                          </p>
                          <p className="text-sm text-neutral-500">
                            CA${item.price.toFixed(2)} ea
                          </p>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-2 text-neutral-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {items.length > 0 && (
                <>
                  {/* Payment Method Selection */}
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6">
                    <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                      Select Payment Method
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {SUPPORTED_CURRENCIES.map((currency) => (
                        <button
                          key={currency.code}
                          onClick={() =>
                            setSelectedCurrency(currency.code as SupportedCurrency)
                          }
                          className={`p-4 rounded-xl border-2 transition-all ${
                            selectedCurrency === currency.code
                              ? "border-emerald-500 bg-emerald-50"
                              : "border-neutral-200 hover:border-neutral-300"
                          }`}
                        >
                          <div className="text-2xl mb-1">{currency.icon}</div>
                          <div className="font-medium text-sm text-neutral-900">
                            {currency.name}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {currency.network}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Email (Optional) */}
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6">
                    <label className="block">
                      <span className="text-sm font-medium text-neutral-700">
                        Email (optional)
                      </span>
                      <span className="text-sm text-neutral-500 ml-2">
                        For order confirmation
                      </span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="mt-2 w-full px-4 py-3 rounded-xl border border-neutral-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                      />
                    </label>
                  </div>

                  {/* Order Summary */}
                  <div className="bg-white rounded-2xl border border-neutral-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-neutral-600">Subtotal</span>
                      <span className="font-medium">CA${total.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-neutral-600">Shipping</span>
                      <span className="text-emerald-600 font-medium">Free</span>
                    </div>
                    <div className="border-t border-neutral-100 pt-4 flex items-center justify-between">
                      <span className="text-lg font-semibold">Total (CAD)</span>
                      <span className="text-2xl font-bold text-neutral-900">
                        CA${total.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleCheckout}
                    disabled={loading || items.length === 0}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-neutral-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-3"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Creating Invoice...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-5 h-5" />
                        Pay with {currencyInfo?.name}
                      </>
                    )}
                  </button>

                  <p className="text-center text-sm text-neutral-500">
                    Secure payment powered by MetaCortex DeFi
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* Payment Step */}
          {(step === "payment" || step === "processing") && invoice && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <QrCode className="w-8 h-8 text-emerald-600" />
                </div>

                <h1 className="text-2xl font-semibold text-neutral-900 mb-2">
                  {step === "processing"
                    ? "Payment Confirming..."
                    : "Complete Your Payment"}
                </h1>
                <p className="text-neutral-500 mb-8">
                  Send exactly{" "}
                  <span className="font-semibold text-neutral-900">
                    CA${invoice.amount.toFixed(2)}
                  </span>{" "}
                  worth of {currencyInfo?.name}
                </p>

                {/* Payment Address */}
                <div className="bg-neutral-50 rounded-xl p-6 mb-6">
                  <p className="text-sm text-neutral-500 mb-2">
                    Send to this address:
                  </p>
                  <div className="flex items-center gap-3 justify-center">
                    <code className="text-sm font-mono text-neutral-900 break-all">
                      {invoice.payment_address}
                    </code>
                    <button
                      onClick={copyAddress}
                      className="p-2 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-100 transition-colors"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4 text-neutral-600" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-center gap-2 mb-6">
                  {step === "processing" ? (
                    <>
                      <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                      <span className="text-emerald-600 font-medium">
                        Payment detected, confirming...
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                      <span className="text-neutral-600">
                        Waiting for payment...
                      </span>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-4 justify-center">
                  <a
                    href={invoice.payment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors"
                  >
                    Open Payment Page
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={checkPaymentStatus}
                    className="px-6 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium rounded-xl transition-colors"
                  >
                    Check Status
                  </button>
                </div>

                {/* Invoice Info */}
                <div className="mt-8 pt-6 border-t border-neutral-100 text-sm text-neutral-500">
                  <p>Invoice: {invoice.invoice_number}</p>
                  <p>
                    Expires:{" "}
                    {new Date(invoice.expires_at).toLocaleString()}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-2xl border border-neutral-200 p-12 text-center"
            >
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-emerald-600" />
              </div>

              <h1 className="text-3xl font-semibold text-neutral-900 mb-2">
                Payment Successful!
              </h1>
              <p className="text-neutral-500 mb-8">
                Thank you for your order. You will receive a confirmation email
                shortly.
              </p>

              {invoice && (
                <p className="text-sm text-neutral-500 mb-8">
                  Order Reference: {invoice.invoice_number}
                </p>
              )}

              <Link
                href="/products"
                className="inline-flex items-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors"
              >
                Continue Shopping
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
