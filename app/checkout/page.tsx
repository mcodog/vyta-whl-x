"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { validateReferralCode } from "@/lib/affiliate/api";
import { getStoredReferral } from "@/lib/affiliate/referral";
import { AFFILIATE_DISCOUNT_RATE } from "@/lib/affiliate/commission";
import {
  CHECKOUT_PAYMENT_METHODS,
  DEFAULT_CHECKOUT_PAYMENT_METHOD,
  activeCheckoutPaymentMethods,
  isCheckoutPaymentMethodActive,
  type CheckoutPaymentMethodId,
} from "@/lib/paymentMethod";
import { useCart, cartLineKey } from "@/contexts/CartContext";
import PriceAmount from "@/components/PriceAmount";
import { VytaMark } from "@/components/VytaLogo";
import { useCustomer } from "@/contexts/CustomerContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import AddressAutocomplete, { type ParsedAddress } from "@/components/AddressAutocomplete";
import CheckoutAddons from "@/components/CheckoutAddons";
import AddToCartModal, { type AddToCartProduct } from "@/components/AddToCartModal";
import type { ReferralCode } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import {
  ShoppingCart,
  Tag,
  Check,
  X,
  User,
  MapPin,
  ArrowRight,
  Trash2,
  Lock,
  Loader2,
  AlertCircle,
  Beaker,
  ShieldCheck,
  Sparkles,
  Plus,
  Wallet,
  Copy,
  Clock,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Mail,
  Truck,
  Store,
} from "lucide-react";


type CheckoutStep = "shipping" | "payment";
type CryptoOption = "btc" | "eth" | "sol";

interface ShippingRate {
  courierId: string;
  courier: string;
  cost: number;
  minDays?: number;
  maxDays?: number;
  currency: string;
}

/**
 * Fetch the available shipping rates (cheapest first) for the destination +
 * cart, debounced as the address is typed. `estimated` is true when these are
 * the flat fallback rather than live Easyship rates.
 */
function useShippingRates(params: {
  enabled: boolean;
  postalCode: string;
  city: string;
  state: string;
  country: string;
  items: { quantity: number; price: number }[];
}) {
  const { enabled, postalCode, city, state, country, items } = params;
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [estimated, setEstimated] = useState(true);
  const [loading, setLoading] = useState(false);
  const itemsSig = JSON.stringify(items.map((i) => [i.quantity, i.price]));

  useEffect(() => {
    if (!enabled || postalCode.trim().length < 3 || items.length === 0) {
      setRates([]);
      setEstimated(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/shipping/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: { postalCode, city, state, country },
            items: items.map((it) => ({ quantity: it.quantity, price: it.price })),
          }),
        });
        if (!res.ok) throw new Error("rate fetch failed");
        const data = await res.json();
        if (!cancelled) {
          setRates(Array.isArray(data.rates) ? data.rates : []);
          setEstimated(Boolean(data.estimated));
        }
      } catch {
        if (!cancelled) {
          setRates([]);
          setEstimated(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, postalCode, city, state, country, itemsSig]);

  return { rates, estimated, loading };
}

/**
 * Inline courier selector for the order summary. Renders nothing when there are
 * no selectable live rates.
 */
function CourierOptions({
  rates,
  estimated,
  selectedCourierId,
  onSelect,
}: {
  rates: ShippingRate[];
  estimated: boolean;
  selectedCourierId: string;
  onSelect: (courierId: string) => void;
}) {
  if (rates.length === 0) return null;
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">
        Shipping method
        {estimated && <span className="ml-1 normal-case text-ink-muted/60">(estimated)</span>}
      </span>
      {rates.map((r) => (
        <label
          key={r.courierId}
          className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
            selectedCourierId === r.courierId
              ? "border-vital bg-vital/5"
              : "border-line hover:border-ink-muted/30"
          }`}
        >
          <input
            type="radio"
            name="courier"
            checked={selectedCourierId === r.courierId}
            onChange={() => onSelect(r.courierId)}
            className="accent-vital"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink truncate">{r.courier}</p>
            {r.maxDays ? (
              <p className="text-[11px] text-ink-muted">
                {r.minDays ?? r.maxDays}-{r.maxDays} business days
              </p>
            ) : null}
          </div>
          <span className="text-sm font-semibold text-ink tabular-nums">
            ${r.cost.toFixed(2)}
          </span>
        </label>
      ))}
    </div>
  );
}

interface PaymentInfo {
  orderNumber: string;
  paymentAddress: string;
  paymentAmount: string;
  crypto: CryptoOption;
  expiresAt: string;
  total: number;
}

function CryptoCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, totalPrice, clearCart, removeItem, updateQuantity } =
    useCart();
  const { customer } = useCustomer();
  const { showToast } = useToast();

  const [step, setStep] = useState<CheckoutStep>("shipping");
  const [referralCode, setReferralCode] = useState("");
  const [validatedCode, setValidatedCode] = useState<ReferralCode | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoOption>("btc");
  const [isProcessing, setIsProcessing] = useState(false);

  // Payment state
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<
    "pending" | "received" | "confirmed"
  >("pending");
  const [confirmations, setConfirmations] = useState(0);
  const [copied, setCopied] = useState<"address" | "amount" | null>(null);
  const [timeLeft, setTimeLeft] = useState("");
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const [shippingData, setShippingData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
  });

  const { rates: shippingRates, estimated: shippingEstimated, loading: shippingLoading } =
    useShippingRates({
      enabled: true,
      postalCode: shippingData.postalCode,
      city: shippingData.city,
      state: shippingData.state,
      country: shippingData.country,
      items: items.map((i) => ({ quantity: i.quantity, price: i.price })),
    });
  const [selectedCourierId, setSelectedCourierId] = useState("");
  // Default to the cheapest (first) rate whenever the rate list changes.
  useEffect(() => {
    if (shippingRates.length > 0) {
      setSelectedCourierId((prev) =>
        shippingRates.some((r) => r.courierId === prev) ? prev : shippingRates[0].courierId,
      );
    }
  }, [shippingRates]);
  const selectedRate =
    shippingRates.find((r) => r.courierId === selectedCourierId) || shippingRates[0];
  // Shipping is only known once a live/estimated rate has come back for the
  // entered address; before that we show no figure rather than a flat fallback.
  const shippingKnown = shippingRates.length > 0;
  const shippingCost = selectedRate?.cost ?? 0;

  // Customers bound to an affiliate (or applying a valid referral code) get a
  // discount on the product subtotal. The server is authoritative; this mirrors
  // it so the customer sees the reduced price before paying. A `manual_code_only`
  // affiliate does not auto-apply from the binding — the code must be entered
  // (typed in, or auto-filled from a ?ref= link).
  const bindingAttributes = Boolean(
    customer?.affiliate_id && !customer?.affiliate_manual_code_only,
  );
  const affiliateAttributed = bindingAttributes || Boolean(validatedCode);
  const affiliateDiscount = affiliateAttributed ? totalPrice * AFFILIATE_DISCOUNT_RATE : 0;
  const discountedSubtotal = totalPrice - affiliateDiscount;

  // The pay button stays locked until contact + full shipping address are
  // provided (this is a ship-to-me only flow) and live rates have resolved.
  const contactComplete = Boolean(
    shippingData.firstName && shippingData.lastName && shippingData.email,
  );
  const addressComplete = Boolean(
    shippingData.address && shippingData.city && shippingData.state && shippingData.postalCode,
  );
  const canPay =
    !isProcessing && items.length > 0 && contactComplete && addressComplete && !shippingLoading;

  useEffect(() => {
    if (customer) {
      // Only fill fields the user hasn't already typed, so re-renders of the
      // customer object can't wipe entered values (e.g. phone).
      setShippingData((d) => ({
        firstName: d.firstName || customer.first_name || "",
        lastName: d.lastName || customer.last_name || "",
        email: d.email || customer.email || "",
        phone: d.phone || customer.phone || "",
        address: d.address || customer.shipping_address || "",
        city: d.city || customer.shipping_city || "",
        state: d.state || customer.shipping_state || "",
        postalCode: d.postalCode || customer.shipping_postal_code || "",
        country: d.country || customer.shipping_country || "CA",
      }));
    }
  }, [customer]);

  useEffect(() => {
    // Prefer an explicit ?ref=, otherwise fall back to the stored (first-touch)
    // referral captured when the visitor first arrived.
    const refParam = searchParams.get("ref") || getStoredReferral();
    if (refParam) {
      setReferralCode(refParam.toUpperCase());
      validateCode(refParam);
    }
  }, [searchParams]);

  // Countdown timer
  useEffect(() => {
    if (!paymentInfo?.expiresAt || paymentStatus === "confirmed") return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const expires = new Date(paymentInfo.expiresAt).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft("Expired");
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [paymentInfo?.expiresAt, paymentStatus]);

  // Poll for payment status
  const requiredConfirmations: Record<string, number> = {
    btc: 1,
    eth: 12,
    sol: 1,
  };

  const pollPayment = useCallback(async () => {
    if (!paymentInfo?.orderNumber) return;
    try {
      const res = await fetch(
        `/api/orders/check-payment?orderNumber=${paymentInfo.orderNumber}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.confirmations !== undefined) {
        setConfirmations(data.confirmations);
      }
      if (data.status === "received" && paymentStatus !== "received") {
        setPaymentStatus("received");
      }
      if (data.status === "confirmed") {
        setPaymentStatus("confirmed");
        setConfirmations(
          data.confirmations || requiredConfirmations[paymentInfo.crypto] || 1,
        );
        if (pollRef.current) clearInterval(pollRef.current);
        clearCart();
        setTimeout(() => {
          router.push(`/account/dashboard`);
        }, 5000);
      }
    } catch {}
  }, [
    paymentInfo?.orderNumber,
    paymentInfo?.crypto,
    paymentStatus,
    clearCart,
    router,
  ]);

  useEffect(() => {
    if (
      step === "payment" &&
      paymentInfo &&
      (paymentStatus === "pending" || paymentStatus === "received")
    ) {
      pollRef.current = setInterval(pollPayment, 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [step, paymentInfo, paymentStatus, pollPayment]);

  const validateCode = async (code: string) => {
    if (!code || code.length !== 8) {
      setValidationError("");
      setValidatedCode(null);
      return;
    }

    setIsValidating(true);
    setValidationError("");
    const result = await validateReferralCode(code);
    setIsValidating(false);

    if (result) {
      setValidatedCode(result);
      setValidationError("");
    } else {
      setValidatedCode(null);
      setValidationError("Invalid referral code");
    }
  };

  const handleReferralCodeChange = (value: string) => {
    const upperValue = value.toUpperCase();
    setReferralCode(upperValue);

    if (upperValue.length === 8) {
      validateCode(upperValue);
    } else {
      setValidatedCode(null);
      setValidationError("");
    }
  };

  const handleShippingChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setShippingData({ ...shippingData, [e.target.name]: e.target.value });
  };

  const applyParsedAddress = (addr: ParsedAddress) => {
    setShippingData((d) => ({
      ...d,
      address: addr.line1 || d.address,
      city: addr.city || d.city,
      state: addr.state || d.state,
      postalCode: addr.postalCode || d.postalCode,
      country: addr.country || d.country,
    }));
  };

  const handleProceedToPayment = async () => {
    if (items.length === 0) {
      showToast("Your cart is empty");
      return;
    }

    if (
      !shippingData.firstName ||
      !shippingData.lastName ||
      !shippingData.email
    ) {
      showToast("Please fill in your name and email");
      return;
    }

    if (
      !shippingData.address ||
      !shippingData.city ||
      !shippingData.state ||
      !shippingData.postalCode
    ) {
      showToast("Please fill in your shipping address");
      return;
    }

    // Block payment while live shipping rates are still being calculated so the
    // order total can't be locked in before the final shipping cost is known.
    if (shippingLoading) {
      showToast("Please wait — calculating shipping…");
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            strength: item.strength,
          })),
          shipping: {
            firstName: shippingData.firstName,
            lastName: shippingData.lastName,
            email: shippingData.email,
            phone: shippingData.phone,
            address: shippingData.address,
            city: shippingData.city,
            state: shippingData.state,
            postalCode: shippingData.postalCode,
            country: shippingData.country,
          },
          crypto: selectedCrypto,
          referralCode: validatedCode?.code,
          customerId: customer?.id,
          shippingCourierId: selectedCourierId || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const msg = typeof data?.error === "string" ? data.error : "Checkout failed";
        throw new Error(msg);
      }

      setPaymentInfo({
        orderNumber: data.orderNumber,
        paymentAddress: data.paymentAddress,
        paymentAmount: data.paymentAmount,
        crypto: data.crypto,
        expiresAt: data.expiresAt,
        total: data.total,
      });
      setStep("payment");
    } catch (err: any) {
      console.error("Checkout error:", err);
      const msg = typeof err?.message === "string" && err.message ? err.message : "Failed to process checkout. Please try again.";
      showToast(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async (text: string, type: "address" | "amount") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const cryptoOptions = [
    {
      value: "btc" as CryptoOption,
      label: "Bitcoin",
      sublabel: "BTC",
      icon: "₿",
    },
    {
      value: "eth" as CryptoOption,
      label: "Ethereum",
      sublabel: "ETH",
      icon: "Ξ",
    },
    {
      value: "sol" as CryptoOption,
      label: "Solana",
      sublabel: "SOL",
      icon: "◎",
    },
  ];

  const chainNames: Record<string, string> = {
    btc: "Bitcoin",
    eth: "Ethereum",
    sol: "Solana",
  };
  const explorerUrls: Record<string, string> = {
    btc: "https://mempool.space/tx/",
    eth: "https://etherscan.io/tx/",
    sol: "https://explorer.solana.com/tx/",
  };

  // Require sign-in — pricing and checkout are for signed-in customers only.
  if (!customer) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white rounded-2xl border border-line p-8 text-center">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
            <Lock className="w-8 h-8 text-ink-muted" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">Account Required</h2>
          <p className="text-ink-muted text-sm mb-6">
            Please sign in to view pricing and complete your order.
          </p>
          <Link
            href="/login?redirect=/checkout"
            className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  // Payment step
  if (step === "payment" && paymentInfo) {
    return (
      <div className="min-h-screen bg-white px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-lg mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-3 mb-6">
              <VytaMark size={38} />
              <span className="font-display text-lg font-semibold tracking-[0.28em] text-ink">VYTA</span>
            </Link>
          </div>

          {paymentStatus === "confirmed" ? (
            <div className="bg-white rounded-2xl border border-line p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">
                Payment Confirmed!
              </h2>
              <p className="text-ink-muted text-sm mb-2">
                Your payment has been fully confirmed on the blockchain.
              </p>
              <p className="text-ink-muted text-sm mb-4">
                Your order is now being processed. Redirecting to order
                tracking...
              </p>
              <p className="text-green-600 text-xs font-medium mb-4">
                You can safely close this page.
              </p>
              <Loader2 className="w-5 h-5 text-vital animate-spin mx-auto" />
            </div>
          ) : paymentStatus === "received" ? (
            <div className="bg-white rounded-2xl border border-line overflow-hidden">
              <div className="bg-green-50 px-6 py-4 border-b border-green-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-green-800">
                      Payment Received!
                    </h2>
                    <p className="text-xs text-green-600">
                      You can safely close this page now.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="text-center">
                  <p className="text-sm text-ink-muted mb-4">
                    Your {chainNames[paymentInfo.crypto]} payment has been
                    detected. Once the required confirmations are reached, your
                    order will be processed.
                  </p>
                </div>

                {/* Confirmation progress */}
                <div className="bg-surface rounded-xl p-5 border border-line">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">
                      Confirmations
                    </span>
                    <span className="text-sm font-bold text-ink tabular-nums">
                      {confirmations} /{" "}
                      {requiredConfirmations[paymentInfo.crypto] || 1}
                    </span>
                  </div>
                  <div className="w-full bg-line rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-green-500 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (confirmations / (requiredConfirmations[paymentInfo.crypto] || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-ink-muted mt-3 text-center">
                    {paymentInfo.crypto === "btc"
                      ? "Bitcoin confirmations typically take ~10 minutes each."
                      : paymentInfo.crypto === "eth"
                        ? "Ethereum confirmations take ~12 seconds each."
                        : "Solana confirmations are nearly instant."}
                  </p>
                </div>

                {/* Order info */}
                <div className="bg-surface rounded-xl p-4 border border-line">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-muted">Order</span>
                    <span className="font-bold text-ink font-mono">
                      {paymentInfo.orderNumber}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-ink-muted">Total</span>
                    <span className="font-bold text-ink">
                      ${paymentInfo.total.toFixed(2)} CAD
                    </span>
                  </div>
                </div>

                {/* Polling indicator */}
                <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Monitoring confirmations...</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Do not close warning */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-800 font-medium">
                  Do not close this page until your payment has been detected.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-line overflow-hidden">
                {/* Order info header */}
                <div className="bg-surface px-6 py-4 border-b border-line">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-ink-muted">Order</p>
                      <p className="font-bold text-ink">
                        {paymentInfo.orderNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-ink-muted">Total</p>
                      <p className="font-bold text-ink">
                        ${paymentInfo.total.toFixed(2)} CAD
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-ink mb-1">
                      Send {chainNames[paymentInfo.crypto]}
                    </h2>
                    <p className="text-xs text-ink-muted">
                      Scan the QR code or copy the address below
                    </p>
                  </div>

                  {/* QR Code */}
                  <div className="flex justify-center">
                    <div className="bg-white p-4 rounded-2xl border border-line shadow-sm">
                      <QRCodeSVG
                        value={paymentInfo.paymentAddress}
                        size={200}
                        level="H"
                        includeMargin={true}
                      />
                    </div>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-2">
                      Amount
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface px-4 py-3 rounded-xl text-sm font-mono text-ink border border-line truncate">
                        {paymentInfo.paymentAmount}{" "}
                        {paymentInfo.crypto.toUpperCase()}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(paymentInfo.paymentAmount, "amount")
                        }
                        className={`p-3 rounded-xl transition-colors flex-shrink-0 ${
                          copied === "amount"
                            ? "bg-green-100 text-green-600"
                            : "bg-surface hover:bg-line text-ink-muted border border-line"
                        }`}
                      >
                        {copied === "amount" ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-2">
                      Payment Address
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface px-4 py-3 rounded-xl text-xs font-mono text-ink border border-line break-all">
                        {paymentInfo.paymentAddress}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(paymentInfo.paymentAddress, "address")
                        }
                        className={`p-3 rounded-xl transition-colors flex-shrink-0 ${
                          copied === "address"
                            ? "bg-green-100 text-green-600"
                            : "bg-surface hover:bg-line text-ink-muted border border-line"
                        }`}
                      >
                        {copied === "address" ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="flex items-center justify-center gap-2 bg-surface rounded-xl py-3 border border-line">
                    <Clock className="w-4 h-4 text-ink-muted" />
                    <span className="text-sm text-ink-muted">
                      {timeLeft === "Expired" ? (
                        <span className="text-red-600 font-medium">
                          Payment window expired
                        </span>
                      ) : (
                        <>
                          Expires in{" "}
                          <span className="font-mono font-medium text-ink">
                            {timeLeft}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Polling indicator */}
                  <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Checking for payment every 5 seconds...</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 text-center">
                <Link
                  href="/products"
                  className="text-ink-muted hover:text-vital transition-colors text-sm"
                >
                  &larr; Continue Shopping
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-line">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <VytaMark size={38} />
              <div className="flex flex-col">
                <span className="font-display text-lg font-semibold tracking-[0.28em] text-ink leading-none">
                  VYTA
                </span>
                <span className="text-[10px] text-vital tracking-[0.15em] font-medium uppercase mt-0.5">
                  Secure Checkout
                </span>
              </div>
            </Link>
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface rounded-full border border-line flex-shrink-0">
              <Lock className="w-4 h-4 text-vital" />
              <span className="text-xs sm:text-sm font-medium text-ink-muted">
                SSL Encrypted
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">
          {items.length === 0 ? (
            <div className="bg-surface rounded-2xl p-10 md:p-12 text-center border border-line">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line">
                <ShoppingCart className="w-8 h-8 text-ink-muted" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">
                Your cart is empty
              </h2>
              <p className="text-ink-muted mb-6 text-sm">
                Add some research compounds before checking out
              </p>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm"
              >
                <span>Browse Catalog</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
              {/* Main Checkout Form */}
              <div className="lg:col-span-2 space-y-5">
                {/* Login Prompt - Optional */}
                {!customer && (
                  <div className="bg-surface rounded-2xl p-4 border border-line">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-muted">
                        Already have an account?{" "}
                        <Link
                          href="/login?redirect=/checkout"
                          className="text-vital hover:underline font-medium"
                        >
                          Sign in
                        </Link>{" "}
                        for order tracking
                      </p>
                    </div>
                  </div>
                )}

                {/* Customer Info */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <User className="w-5 h-5 text-ink" />
                    </div>
                    <h2 className="text-base font-semibold text-ink">
                      Contact Information
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        First Name *
                      </label>
                      <input
                        type="text"
                        name="firstName"
                        value={shippingData.firstName}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        name="lastName"
                        value={shippingData.lastName}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="Doe"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={shippingData.email}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="john@example.com"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Phone
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={shippingData.phone}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>
                </div>

                {/* Shipping Address */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <MapPin className="w-5 h-5 text-ink" />
                    </div>
                    <h2 className="text-base font-semibold text-ink">
                      Shipping Address
                    </h2>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Street Address *
                      </label>
                      <AddressAutocomplete
                        value={shippingData.address}
                        onChange={(street) => setShippingData((d) => ({ ...d, address: street }))}
                        onSelect={applyParsedAddress}
                        className="w-full px-4 py-3 pr-10 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="Start typing your address…"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-2">
                          City *
                        </label>
                        <input
                          type="text"
                          name="city"
                          value={shippingData.city}
                          onChange={handleShippingChange}
                          className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                          placeholder="Toronto"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-2">
                          Province *
                        </label>
                        <input
                          type="text"
                          name="state"
                          value={shippingData.state}
                          onChange={handleShippingChange}
                          className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                          placeholder="ON"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-2">
                          Postal Code *
                        </label>
                        <input
                          type="text"
                          name="postalCode"
                          value={shippingData.postalCode}
                          onChange={handleShippingChange}
                          className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                          placeholder="M5V 1A1"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-2">
                          Country
                        </label>
                        <select
                          name="country"
                          value={shippingData.country}
                          onChange={handleShippingChange}
                          className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink"
                        >
                          <option value="CA">Canada</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment Method — Crypto Selector */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <Wallet className="w-5 h-5 text-ink" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-ink">
                        Payment Method
                      </h2>
                      <p className="text-xs text-ink-muted">
                        Select cryptocurrency
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {cryptoOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setSelectedCrypto(option.value)}
                        className={`relative p-3 sm:p-4 rounded-xl border-2 transition-all text-center ${
                          selectedCrypto === option.value
                            ? "border-vital bg-vital/5"
                            : "border-line bg-white hover:border-ink-muted/30"
                        }`}
                      >
                        <div className="text-xl sm:text-2xl mb-1">{option.icon}</div>
                        <div className="text-sm font-semibold text-ink">
                          {option.sublabel}
                        </div>
                        <div className="text-[11px] sm:text-xs text-ink-muted">
                          {option.label}
                        </div>
                        {selectedCrypto === option.value && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-vital rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Referral Code */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <Tag className="w-5 h-5 text-ink" />
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">
                        Referral Code
                      </h2>
                      {validatedCode && (
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => handleReferralCodeChange(e.target.value)}
                      maxLength={8}
                      placeholder="Enter 8-character code (optional)"
                      className={`w-full px-4 py-3 pr-12 border-2 rounded-xl focus:outline-none transition-colors uppercase font-mono text-sm tracking-wider ${
                        validatedCode
                          ? "border-green-500 bg-green-50 text-green-700"
                          : validationError
                            ? "border-red-500 bg-red-50 text-red-700"
                            : "border-line bg-white text-ink focus:border-vital/40"
                      }`}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {isValidating ? (
                        <Loader2 className="w-5 h-5 text-ink-muted animate-spin" />
                      ) : validatedCode ? (
                        <Check className="w-5 h-5 text-green-500" />
                      ) : validationError ? (
                        <X className="w-5 h-5 text-red-500" />
                      ) : null}
                    </div>
                  </div>
                  {validationError && (
                    <p className="mt-2 text-xs text-red-600">
                      {validationError}
                    </p>
                  )}
                  {validatedCode && (
                    <p className="mt-2 text-xs text-green-600">
                      Code applied! Your affiliate will earn commission.
                    </p>
                  )}
                </div>
              </div>

              {/* Order Summary Sidebar */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6 space-y-4">
                  {/* Cart Items Card */}
                  <div className="bg-white rounded-2xl border border-line overflow-hidden">
                    <div className="px-6 py-4 border-b border-line">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-ink">
                          Your Order
                        </h2>
                        <span className="text-xs text-ink-muted">
                          {items.length} {items.length === 1 ? "item" : "items"}
                        </span>
                      </div>
                    </div>

                    <div className="divide-y divide-line">
                      {items.map((item) => {
                        const key = cartLineKey(item.id, item.packSize);
                        const packLabel =
                          item.packSize === 1 ? "Single vial" : `Pack of ${item.packSize}`;
                        const displayImage =
                          item.packSize !== 1 && item.box_image_url
                            ? item.box_image_url
                            : item.image_url;
                        return (
                        <div
                          key={key}
                          className="p-4 hover:bg-surface/50 transition-colors"
                        >
                          <div className="flex gap-3 sm:gap-4">
                            <div className="bg-surface w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center flex-shrink-0 border border-line overflow-hidden">
                              {displayImage ? (
                                <img
                                  src={displayImage}
                                  alt={item.name}
                                  className="w-full h-full object-contain p-1"
                                />
                              ) : (
                                <Beaker className="w-6 h-6 text-ink-muted" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-ink text-sm leading-tight">
                                {item.name}
                              </p>
                              <p className="text-xs text-ink-muted mt-1">
                                {item.strength}
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface border border-line text-[10px] font-medium">
                                  {packLabel}
                                </span>
                              </p>
                              <div className="flex items-center justify-between mt-3">
                                <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-line">
                                  <button
                                    onClick={() =>
                                      updateQuantity(key, item.quantity - item.packSize)
                                    }
                                    className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center"
                                  >
                                    &minus;
                                  </button>
                                  <span className="text-sm text-ink tabular-nums w-8 text-center font-medium">
                                    {item.quantity}
                                  </span>
                                  <button
                                    onClick={() =>
                                      updateQuantity(key, item.quantity + item.packSize)
                                    }
                                    className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center"
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3">
                                  <p className="font-semibold text-ink tabular-nums">
                                    ${(item.price * item.quantity).toFixed(2)}
                                  </p>
                                  <button
                                    onClick={() => removeItem(key)}
                                    className="w-7 h-7 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Upsell: bacteriostatic water & other add-ons */}
                  <CheckoutAddons />

                  {/* Summary & Checkout Card */}
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">Subtotal</span>
                        <span className="font-medium text-ink tabular-nums">
                          ${totalPrice.toFixed(2)}
                        </span>
                      </div>

                      {affiliateDiscount > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-emerald-600">Affiliate discount (10%)</span>
                          <span className="font-medium text-emerald-600 tabular-nums">
                            -${affiliateDiscount.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {shippingLoading ? (
                        <div className="flex justify-between items-center">
                          <span className="text-ink-muted">Shipping</span>
                          <span className="flex items-center gap-1.5 text-ink-muted text-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Calculating
                          </span>
                        </div>
                      ) : shippingRates.length > 0 ? (
                        <CourierOptions
                          rates={shippingRates}
                          estimated={shippingEstimated}
                          selectedCourierId={selectedCourierId}
                          onSelect={setSelectedCourierId}
                        />
                      ) : (
                        <div className="flex justify-between items-center">
                          <span className="text-ink-muted">Shipping</span>
                          <span className="text-ink-muted text-sm">Calculated after address</span>
                        </div>
                      )}
                    </div>

                    <div className="h-px bg-line my-5" />

                    <div className="flex justify-between items-center mb-6">
                      <span className="text-lg font-semibold text-ink">
                        Total
                      </span>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-ink tabular-nums">
                          ${(discountedSubtotal + shippingCost).toFixed(2)}
                        </span>
                        <span className="text-ink-muted text-sm ml-1">{shippingKnown ? "CAD" : "+ shipping"}</span>
                      </div>
                    </div>

                    <button
                      onClick={handleProceedToPayment}
                      disabled={!canPay}
                      className="w-full bg-ink hover:bg-ink/90 text-white py-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : shippingLoading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Calculating shipping…</span>
                        </>
                      ) : !contactComplete || !addressComplete ? (
                        <>
                          <Lock className="w-5 h-5" />
                          <span>Enter shipping details</span>
                        </>
                      ) : (
                        <>
                          <Wallet className="w-5 h-5" />
                          <span>
                            Pay with{" "}
                            {
                              cryptoOptions.find(
                                (o) => o.value === selectedCrypto,
                              )?.sublabel
                            }
                          </span>
                        </>
                      )}
                    </button>

                    {/* Trust badges */}
                    <div className="flex items-center justify-center gap-6 mt-5 pt-5 border-t border-line">
                      <div className="flex items-center gap-2 text-ink-muted">
                        <ShieldCheck className="w-4 h-4 text-vital" />
                        <span className="text-xs">Secure Checkout</span>
                      </div>
                      <div className="flex items-center gap-2 text-ink-muted">
                        <Lock className="w-4 h-4 text-vital" />
                        <span className="text-xs">SSL Encrypted</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Back to Home */}
          <div className="mt-8 text-center">
            <Link
              href="/"
              className="text-ink-muted hover:text-vital transition-colors text-sm"
            >
              &larr; Back to VYTA Biosciences
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailCheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { items, totalPrice, clearCart, removeItem, updateQuantity, pricesReady } = useCart();
  const { customer } = useCustomer();
  const { currency, rate, ready: currencyReady } = useCurrency();
  const { showToast } = useToast();

  const [fulfillmentType, setFulfillmentType] = useState<"shipping" | "pickup">("shipping");
  // How they're paying. The default is the first active method in the registry;
  // the server re-resolves whatever is sent against that same registry, so a
  // method turned off between page load and submit can't be ordered against.
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethodId>(
    DEFAULT_CHECKOUT_PAYMENT_METHOD,
  );
  const [referralCode, setReferralCode] = useState("");
  const [validatedCode, setValidatedCode] = useState<ReferralCode | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A durable confirmation snapshot. Once an order is placed the URL carries
  // `?order=AMC-XXXX`, so a refresh / back-nav rehydrates the confirmation from
  // the server instead of dropping the customer on an empty cart with no record.
  const [confirmation, setConfirmation] = useState<
    { orderNumber: string; email: string; fulfillmentType: "shipping" | "pickup" } | null
  >(null);
  const orderParam = searchParams.get("order");
  const [confirmationLoading, setConfirmationLoading] = useState(!!orderParam);

  const [shippingData, setShippingData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
  });

  // Rehydrate the confirmation screen from `?order=` on refresh / back-nav so
  // the customer never loses their order number, and so a fresh visit to
  // /checkout (no param) shows the normal form rather than a stale confirmation.
  useEffect(() => {
    if (!orderParam) { setConfirmationLoading(false); return; }
    if (confirmation) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orders-email?orderNumber=${encodeURIComponent(orderParam)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.order_number) return;
        setConfirmation({
          orderNumber: data.order_number,
          email: data.email ?? "",
          fulfillmentType: data.fulfillment_type === "pickup" ? "pickup" : "shipping",
        });
      } catch {
        /* leave confirmation null; the empty-cart screen is the fallback */
      } finally {
        if (!cancelled) setConfirmationLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam]);

  const canShip = !customer || customer.allow_shipping !== false;
  const canPickup = !customer || customer.allow_pickup !== false;

  const { rates: shippingRates, estimated: shippingEstimated, loading: shippingLoading } =
    useShippingRates({
      enabled: fulfillmentType === "shipping",
      postalCode: shippingData.postalCode,
      city: shippingData.city,
      state: shippingData.state,
      country: shippingData.country,
      items: items.map((i) => ({ quantity: i.quantity, price: i.price })),
    });
  const [selectedCourierId, setSelectedCourierId] = useState("");
  useEffect(() => {
    if (shippingRates.length > 0) {
      setSelectedCourierId((prev) =>
        shippingRates.some((r) => r.courierId === prev) ? prev : shippingRates[0].courierId,
      );
    }
  }, [shippingRates]);
  const selectedRate =
    shippingRates.find((r) => r.courierId === selectedCourierId) || shippingRates[0];
  // Shipping is only known once it's free (pickup) or a live/estimated rate has
  // come back for the entered address. Before that we show no figure rather than
  // a misleading flat fallback.
  const shippingKnown = fulfillmentType === "pickup" || shippingRates.length > 0;
  const shippingCost =
    fulfillmentType === "pickup" ? 0 : selectedRate?.cost ?? 0;

  // Customers bound to an affiliate (or applying a valid referral code) get a
  // discount on the product subtotal. Mirrors the authoritative server logic. A
  // `manual_code_only` affiliate does not auto-apply from the binding — the code
  // must be entered (typed in, or auto-filled from a ?ref= link).
  const affiliateAttributed = Boolean(
    (customer?.affiliate_id && !customer?.affiliate_manual_code_only) || validatedCode,
  );

  // All amounts shown/charged in the customer's currency. CAD is the base; a
  // USD-tagged customer sees USD (each line honours its add-time priceUsd
  // snapshot, shipping converts at the exchange rate). The server re-derives
  // the authoritative amounts the same way.
  const unitCur = (item: { price: number; priceUsd?: number | null }) =>
    currency === 'USD' ? (item.priceUsd != null ? item.priceUsd : item.price * rate) : item.price;
  const subtotal = currency === 'USD'
    ? items.reduce((s, i) => s + unitCur(i) * i.quantity, 0)
    : totalPrice;
  const affiliateDiscount = affiliateAttributed ? subtotal * AFFILIATE_DISCOUNT_RATE : 0;
  const discountedSubtotal = subtotal - affiliateDiscount;
  const shippingCostCur = currency === 'USD' ? shippingCost * rate : shippingCost;
  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
  // Show a shimmer in place of a price until it is knowable: the currency +
  // rate have to resolve (so a USD-tagged customer never sees a CAD figure
  // flash), and the cart has to have been re-priced against this customer (so
  // the add-to-cart snapshot never stands in for their own price).
  const amountsReady = currencyReady && pricesReady;
  const Amt = ({ value, w = 'w-16' }: { value: number; w?: string }) =>
    amountsReady ? (
      <>{money(value)}</>
    ) : (
      <span className={`inline-block h-4 ${w} bg-surface rounded animate-pulse align-middle`} />
    );

  // Lock submission until the required details are provided. For "ship to me"
  // the full shipping address is required (and live rates must have resolved);
  // pickup only needs contact details.
  const contactComplete = Boolean(
    shippingData.firstName && shippingData.lastName && shippingData.email,
  );
  const addressComplete = Boolean(
    shippingData.address && shippingData.city && shippingData.state && shippingData.postalCode,
  );
  // "Ship to Me" additionally requires a phone number (couriers need it for
  // delivery contact); pickup does not.
  const shippingDetailsComplete = addressComplete && Boolean(shippingData.phone);
  const canSubmit =
    !isProcessing &&
    items.length > 0 &&
    contactComplete &&
    // Never let an order be placed off prices that are still being resolved —
    // the figures on screen would not be the ones the server bills.
    amountsReady &&
    (fulfillmentType === "pickup" || (shippingDetailsComplete && !shippingLoading));

  // Auto-select fulfillment type when only one option is available
  useEffect(() => {
    if (!canShip && canPickup) setFulfillmentType("pickup");
    if (canShip && !canPickup) setFulfillmentType("shipping");
  }, [canShip, canPickup]);

  useEffect(() => {
    if (customer) {
      // Only fill fields the user hasn't already typed, so re-renders of the
      // customer object can't wipe entered values (e.g. phone).
      setShippingData((d) => ({
        firstName: d.firstName || customer.first_name || "",
        lastName: d.lastName || customer.last_name || "",
        email: d.email || customer.email || "",
        phone: d.phone || customer.phone || "",
        address: d.address || customer.shipping_address || "",
        city: d.city || customer.shipping_city || "",
        state: d.state || customer.shipping_state || "",
        postalCode: d.postalCode || customer.shipping_postal_code || "",
        country: d.country || customer.shipping_country || "CA",
      }));
    }
  }, [customer]);

  useEffect(() => {
    const refParam = searchParams.get("ref");
    if (refParam) {
      setReferralCode(refParam.toUpperCase());
      validateEmailCode(refParam);
    }
  }, [searchParams]);

  const validateEmailCode = async (code: string) => {
    if (!code || code.length !== 8) {
      setValidationError("");
      setValidatedCode(null);
      return;
    }
    setIsValidating(true);
    setValidationError("");
    const result = await validateReferralCode(code);
    setIsValidating(false);
    if (result) {
      setValidatedCode(result);
      setValidationError("");
    } else {
      setValidatedCode(null);
      setValidationError("Invalid referral code");
    }
  };

  const handleReferralCodeChange = (value: string) => {
    const upperValue = value.toUpperCase();
    setReferralCode(upperValue);
    if (upperValue.length === 8) {
      validateEmailCode(upperValue);
    } else {
      setValidatedCode(null);
      setValidationError("");
    }
  };

  const handleShippingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
    setShippingData({ ...shippingData, [name]: value });
  };

  // Per-field required/format validation. Returns a map of field → message.
  const validateShipping = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!shippingData.firstName.trim()) errs.firstName = "Enter your first name";
    if (!shippingData.lastName.trim()) errs.lastName = "Enter your last name";
    if (!shippingData.email.trim()) errs.email = "Enter your email";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingData.email.trim()))
      errs.email = "Please enter a valid email address";
    if (fulfillmentType === "shipping") {
      if (!shippingData.phone.trim()) errs.phone = "Enter a phone number for shipping";
      if (!shippingData.address.trim()) errs.address = "Enter your street address";
      if (!shippingData.city.trim()) errs.city = "Enter your city";
      if (!shippingData.state.trim()) errs.state = "Enter your province";
      if (!shippingData.postalCode.trim()) errs.postalCode = "Enter your postal code";
    }
    return errs;
  };

  // Shared input styling that turns red on a field error.
  const inputCls = (name: string) =>
    `w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted ${
      fieldErrors[name] ? "border-red-400" : "border-line"
    }`;
  const fieldError = (name: string) =>
    fieldErrors[name] ? <p className="text-xs text-red-500 mt-1">{fieldErrors[name]}</p> : null;

  const applyParsedAddress = (addr: ParsedAddress) => {
    setShippingData((d) => ({
      ...d,
      address: addr.line1 || d.address,
      city: addr.city || d.city,
      state: addr.state || d.state,
      postalCode: addr.postalCode || d.postalCode,
      country: addr.country || d.country,
    }));
  };

  const handleSubmitOrder = async () => {
    if (items.length === 0) { showToast("Your cart is empty", "error"); return; }
    // Field-level validation: highlight every missing/invalid field at once,
    // then scroll to the first so the customer isn't hunting after a toast.
    const errs = validateShipping();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showToast("Please fix the highlighted fields", "error");
      if (typeof document !== "undefined") {
        requestAnimationFrame(() => {
          const first = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
          first?.scrollIntoView({ behavior: "smooth", block: "center" });
          first?.focus?.();
        });
      }
      return;
    }
    setFieldErrors({});
    // Block submission while live shipping rates are still being calculated so
    // the order can't be placed before the final shipping cost is known.
    if (fulfillmentType === "shipping" && shippingLoading) {
      showToast("Please wait — calculating shipping…"); return;
    }
    setIsProcessing(true);
    try {
      const response = await fetch("/api/orders-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Always send the CAD base `price` (the server computes shipping and
          // Easyship customs values in CAD) plus the per-vial `priceUsd` so a
          // USD order is billed at the right USD amount. `currency` tells the
          // server which to denominate the stored order/invoice in.
          // `packSize` says which catalog price this line is quoted from, so the
          // server can re-derive it (a single vial prices from vial_price, a
          // pack of ten from the case price split ten ways).
          items: items.map((item) => ({ id: item.id, name: item.name, price: item.price, priceUsd: item.priceUsd ?? null, quantity: item.quantity, strength: item.strength, priceType: item.priceType, packSize: item.packSize })),
          shipping: { firstName: shippingData.firstName, lastName: shippingData.lastName, email: shippingData.email, phone: shippingData.phone, address: shippingData.address, city: shippingData.city, state: shippingData.state, postalCode: shippingData.postalCode, country: shippingData.country },
          referralCode: validatedCode?.code,
          customerId: customer?.id,
          currency,
          fulfillmentType,
          paymentMethod,
          shippingCourierId: selectedCourierId || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = typeof data?.error === "string" ? data.error : "Checkout failed";
        throw new Error(msg);
      }
      setConfirmation({
        orderNumber: data.orderNumber,
        email: shippingData.email,
        fulfillmentType,
      });
      // Put the order number in the URL so a refresh keeps the confirmation.
      router.replace(`/checkout?order=${encodeURIComponent(data.orderNumber)}`);
      clearCart();
    } catch (err: any) {
      const msg = typeof err?.message === "string" && err.message ? err.message : "Failed to process checkout. Please try again.";
      showToast(msg, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // Require sign-in — pricing and checkout are for signed-in customers only.
  if (!customer) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white rounded-2xl border border-line p-8 text-center">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
            <Lock className="w-8 h-8 text-ink-muted" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">Account Required</h2>
          <p className="text-ink-muted text-sm mb-6">
            Please sign in to view pricing and complete your order.
          </p>
          <Link
            href="/login?redirect=/checkout"
            className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  // While rehydrating a confirmation from `?order=` (e.g. after a refresh), show
  // a brief loader rather than flashing the empty-cart checkout.
  if (!confirmation && confirmationLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-vital animate-spin" />
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="min-h-screen bg-white px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-3 mb-6">
              <VytaMark size={38} />
              <span className="font-display text-lg font-semibold tracking-[0.28em] text-ink">VYTA</span>
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-line p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Order Submitted!</h2>
            <p className="text-ink-muted text-sm mb-4">Thank you for your order. We&apos;ve sent an invoice to your email.</p>
            <div className="bg-surface rounded-xl p-4 border border-line mb-6">
              <p className="text-xs text-ink-muted mb-2">Order Number</p>
              <p className="font-bold text-ink font-mono text-lg">{confirmation.orderNumber}</p>
              <p className="text-[11px] text-ink-muted mt-2">Save this number — you can return to this page any time to see your order.</p>
            </div>
            <div className="bg-vital-50 border border-vital/20 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                {confirmation.fulfillmentType === "pickup" ? (
                  <Store className="w-5 h-5 text-vital flex-shrink-0 mt-0.5" />
                ) : (
                  <Mail className="w-5 h-5 text-vital flex-shrink-0 mt-0.5" />
                )}
                <div className="text-left">
                  <p className="text-sm font-semibold text-vital mb-1">
                    {confirmation.fulfillmentType === "pickup" ? "Local Pickup" : "Interac e-Transfer"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {confirmation.fulfillmentType === "pickup"
                      ? `We've emailed your order${confirmation.email ? ` to ${confirmation.email}` : ""} and will send your Interac e-Transfer payment instructions shortly. Once payment is received, we'll contact you to arrange pickup.`
                      : `We've emailed your order${confirmation.email ? ` to ${confirmation.email}` : ""} and will send your Interac e-Transfer payment instructions shortly. Your order will be processed once payment is received.`}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Link href="/products" className="block w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm">
                Continue Shopping
              </Link>
              {customer && (
                <Link href="/account/orders" className="block w-full bg-surface hover:bg-line text-ink py-3 rounded-xl font-medium transition-all text-sm border border-line">
                  View My Orders
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-white border-b border-line">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <VytaMark size={38} />
              <div className="flex flex-col">
                <span className="font-display text-lg font-semibold tracking-[0.28em] text-ink leading-none">VYTA</span>
                <span className="text-[10px] text-vital tracking-[0.15em] font-medium uppercase mt-0.5">Secure Checkout</span>
              </div>
            </Link>
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface rounded-full border border-line flex-shrink-0">
              <Lock className="w-4 h-4 text-vital" />
              <span className="text-xs sm:text-sm font-medium text-ink-muted">SSL Encrypted</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">
          {items.length === 0 ? (
            <div className="bg-surface rounded-2xl p-10 md:p-12 text-center border border-line">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line">
                <ShoppingCart className="w-8 h-8 text-ink-muted" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">Your cart is empty</h2>
              <p className="text-ink-muted mb-6 text-sm">Add some research compounds before checking out</p>
              <Link href="/products" className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm">
                <span>Browse Catalog</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
              <div className="lg:col-span-2 space-y-5">
                {!customer && (
                  <div className="bg-surface rounded-2xl p-4 border border-line">
                    <p className="text-xs text-ink-muted">
                      Already have an account?{" "}
                      <Link href="/login?redirect=/checkout" className="text-vital hover:underline font-medium">
                        Sign in
                      </Link>{" "}
                      for order tracking
                    </p>
                  </div>
                )}

                {/* Contact Information */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <User className="w-5 h-5 text-ink" />
                    </div>
                    <h2 className="text-base font-semibold text-ink">Contact Information</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">First Name *</label>
                      <input type="text" name="firstName" value={shippingData.firstName} onChange={handleShippingChange} aria-invalid={!!fieldErrors.firstName} className={inputCls("firstName")} placeholder="John" />
                      {fieldError("firstName")}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">Last Name *</label>
                      <input type="text" name="lastName" value={shippingData.lastName} onChange={handleShippingChange} aria-invalid={!!fieldErrors.lastName} className={inputCls("lastName")} placeholder="Doe" />
                      {fieldError("lastName")}
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">Email *</label>
                      <input type="email" name="email" value={shippingData.email} onChange={handleShippingChange} aria-invalid={!!fieldErrors.email} className={inputCls("email")} placeholder="john@example.com" />
                      {fieldError("email")}
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">Phone {fulfillmentType === "shipping" ? "*" : ""}</label>
                      <input type="tel" name="phone" value={shippingData.phone} onChange={handleShippingChange} aria-invalid={!!fieldErrors.phone} className={inputCls("phone")} placeholder="+1 (555) 123-4567" />
                      {fieldError("phone")}
                    </div>
                  </div>
                </div>

                {/* Shipping Address — shown before fulfillment when shipping */}
                {fulfillmentType === "shipping" && (
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                        <MapPin className="w-5 h-5 text-ink" />
                      </div>
                      <h2 className="text-base font-semibold text-ink">Shipping Address</h2>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-2">Street Address *</label>
                        <AddressAutocomplete
                          value={shippingData.address}
                          onChange={(street) => {
                            if (fieldErrors.address) setFieldErrors((p) => { const n = { ...p }; delete n.address; return n; });
                            setShippingData((d) => ({ ...d, address: street }));
                          }}
                          onSelect={applyParsedAddress}
                          className={`w-full px-4 py-3 pr-10 border rounded-xl focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted ${fieldErrors.address ? "border-red-400" : "border-line"}`}
                          placeholder="Start typing your address…"
                        />
                        {fieldError("address")}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-2">City *</label>
                          <input type="text" name="city" value={shippingData.city} onChange={handleShippingChange} aria-invalid={!!fieldErrors.city} className={inputCls("city")} placeholder="Toronto" />
                          {fieldError("city")}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-2">Province *</label>
                          <input type="text" name="state" value={shippingData.state} onChange={handleShippingChange} aria-invalid={!!fieldErrors.state} className={inputCls("state")} placeholder="ON" />
                          {fieldError("state")}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-2">Postal Code *</label>
                          <input type="text" name="postalCode" value={shippingData.postalCode} onChange={handleShippingChange} aria-invalid={!!fieldErrors.postalCode} className={inputCls("postalCode")} placeholder="M5V 1A1" />
                          {fieldError("postalCode")}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-2">Country</label>
                          {/* We ship within Canada only, so this isn't a choice —
                              show it as a fixed field rather than a one-option menu. */}
                          <div className="w-full px-4 py-3 border border-line rounded-xl text-sm bg-surface text-ink flex items-center justify-between">
                            <span>Canada</span>
                            <span className="text-[11px] text-ink-muted">We ship within Canada only</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fulfillment Toggle */}
                {!canShip && !canPickup ? (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      <p className="text-red-700 text-sm font-medium">No fulfillment options available for your account. Please contact support.</p>
                    </div>
                  </div>
                ) : (canShip && canPickup) ? (
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                        <Truck className="w-5 h-5 text-ink" />
                      </div>
                      <h2 className="text-base font-semibold text-ink">Fulfillment</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button type="button" onClick={() => setFulfillmentType("shipping")} className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${fulfillmentType === "shipping" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/30"}`}>
                        <Truck className="w-5 h-5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-sm">Ship to Me</p>
                          <p className={`text-xs mt-0.5 ${fulfillmentType === "shipping" ? "text-white/70" : "text-ink-muted"}`}>Rates calculated at checkout</p>
                        </div>
                      </button>
                      <button type="button" onClick={() => setFulfillmentType("pickup")} className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${fulfillmentType === "pickup" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/30"}`}>
                        <Store className="w-5 h-5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-sm">Local Pickup</p>
                          <p className={`text-xs mt-0.5 ${fulfillmentType === "pickup" ? "text-white/70" : "text-ink-muted"}`}>Free</p>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                        {canShip ? <Truck className="w-5 h-5 text-ink" /> : <Store className="w-5 h-5 text-ink" />}
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-ink">Fulfillment</h2>
                        <p className="text-xs text-ink-muted">{canShip ? "Shipping — rates calculated at checkout" : "Local Pickup — Free"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pickup Location — shown after fulfillment when pickup.
                    We don't publish a fixed address here: pickup is arranged
                    per-customer, so we point them to their sales person. */}
                {fulfillmentType === "pickup" && (
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                        <Store className="w-5 h-5 text-ink" />
                      </div>
                      <h2 className="text-base font-semibold text-ink">Pickup Location</h2>
                    </div>
                    <div className="bg-surface rounded-xl p-4 border border-line">
                      <div className="flex items-start gap-3">
                        <User className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-ink">
                            Please contact your sales person to arrange your pickup.
                          </p>
                          <p className="text-xs text-ink-muted mt-1">
                            They&apos;ll confirm the pickup location and time once your payment is received.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment Method — every active method in the registry. A
                    single active one is shown selected rather than as a choice
                    of one. */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <Wallet className="w-5 h-5 text-ink" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-ink">Payment Method</h2>
                      <p className="text-xs text-ink-muted">How you'll pay for your order</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {activeCheckoutPaymentMethods().map((m) => {
                      const selected = paymentMethod === m.id;
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                            selected ? "border-vital bg-vital/5" : "border-line hover:border-ink-muted/30"
                          }`}
                        >
                          <input
                            type="radio"
                            name="checkout-payment-method"
                            className="sr-only"
                            checked={selected}
                            onChange={() => setPaymentMethod(m.id)}
                          />
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-line flex-shrink-0">
                            {m.id === "btc" ? (
                              <span className="text-lg font-bold text-vital">&#8383;</span>
                            ) : (
                              <Mail className="w-5 h-5 text-vital" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-ink">{m.label}</p>
                            <p className="text-xs text-ink-muted mt-0.5">{m.description}</p>
                          </div>
                          {selected && (
                            <div className="w-5 h-5 bg-vital rounded-full flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {/* Inactive methods render as disabled "coming soon" tiles —
                      wired from the registry so flipping one to active surfaces
                      it as a selectable option above. */}
                  {CHECKOUT_PAYMENT_METHODS.filter((m) => !m.active).map((m) => (
                    <div
                      key={m.id}
                      aria-disabled="true"
                      className="flex items-center gap-3 p-4 mt-3 rounded-xl border-2 border-line bg-surface/50 opacity-70 cursor-not-allowed"
                    >
                      <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-line flex-shrink-0 text-ink-muted font-bold">
                        {m.id === "btc" ? "₿" : <Wallet className="w-5 h-5 text-ink-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-ink">{m.label}</p>
                        <p className="text-xs text-ink-muted mt-0.5">{m.description}</p>
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted bg-white border border-line rounded-full px-2 py-1 flex-shrink-0">
                        Coming soon
                      </span>
                    </div>
                  ))}
                </div>

                {/* Referral Code */}
                <div className="bg-white rounded-2xl p-6 border border-line">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <Tag className="w-5 h-5 text-ink" />
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">Referral Code</h2>
                      {validatedCode && (
                        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  </div>
                  {customer?.affiliate_manual_code_only && !validatedCode && (
                    <p className="mb-3 text-xs text-ink-muted">
                      Enter your referral code below to apply your discount.
                    </p>
                  )}
                  <div className="relative">
                    <input type="text" value={referralCode} onChange={(e) => handleReferralCodeChange(e.target.value)} maxLength={8} placeholder="Enter 8-character code (optional)" className={`w-full px-4 py-3 pr-12 border-2 rounded-xl focus:outline-none transition-colors uppercase font-mono text-sm tracking-wider ${validatedCode ? "border-green-500 bg-green-50 text-green-700" : validationError ? "border-red-500 bg-red-50 text-red-700" : "border-line bg-white text-ink focus:border-vital/40"}`} />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {isValidating ? <Loader2 className="w-5 h-5 text-ink-muted animate-spin" /> : validatedCode ? <Check className="w-5 h-5 text-green-500" /> : validationError ? <X className="w-5 h-5 text-red-500" /> : null}
                    </div>
                  </div>
                  {validationError && <p className="mt-2 text-xs text-red-600">{validationError}</p>}
                  {validatedCode && <p className="mt-2 text-xs text-green-600">Code applied! Your affiliate will earn 10% commission.</p>}
                </div>
              </div>

              {/* Order Summary Sidebar */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6 space-y-4">
                  <div className="bg-white rounded-2xl border border-line overflow-hidden">
                    <div className="px-6 py-4 border-b border-line">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-ink">Your Order</h2>
                        <span className="text-xs text-ink-muted">{items.length} {items.length === 1 ? "item" : "items"}</span>
                      </div>
                    </div>
                    <div className="divide-y divide-line">
                      {items.map((item) => {
                        const key = cartLineKey(item.id, item.packSize);
                        const packLabel = item.packSize === 1 ? "Single vial" : `Pack of ${item.packSize}`;
                        const displayImage =
                          item.packSize !== 1 && item.box_image_url
                            ? item.box_image_url
                            : item.image_url;
                        return (
                        <div key={key} className="p-4 hover:bg-surface/50 transition-colors">
                          <div className="flex gap-3 sm:gap-4">
                            <div className="bg-surface w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center flex-shrink-0 border border-line overflow-hidden">
                              {displayImage ? (
                                <img
                                  src={displayImage}
                                  alt={item.name}
                                  className="w-full h-full object-contain p-1"
                                />
                              ) : (
                                <Beaker className="w-6 h-6 text-ink-muted" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-ink text-sm leading-tight">{item.name}</p>
                              <p className="text-xs text-ink-muted mt-1">{item.strength}
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface border border-line text-[10px] font-medium">{packLabel}</span>
                              </p>
                              <div className="flex items-center justify-between mt-3">
                                <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-line">
                                  <button onClick={() => updateQuantity(key, item.quantity - item.packSize)} className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center">&minus;</button>
                                  <span className="text-sm text-ink tabular-nums w-8 text-center font-medium">{item.quantity}</span>
                                  <button onClick={() => updateQuantity(key, item.quantity + item.packSize)} className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center">+</button>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3">
                                  <p className="font-semibold text-ink tabular-nums"><Amt value={unitCur(item) * item.quantity} w="w-14" /></p>
                                  <button onClick={() => removeItem(key)} className="w-7 h-7 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Upsell: bacteriostatic water & other add-ons */}
                  <CheckoutAddons />

                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">Subtotal</span>
                        <span className="font-medium text-ink tabular-nums"><Amt value={subtotal} /></span>
                      </div>
                      {affiliateDiscount > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-emerald-600">Affiliate discount (10%)</span>
                          <span className="font-medium text-emerald-600 tabular-nums">-<Amt value={affiliateDiscount} /></span>
                        </div>
                      )}
                      {fulfillmentType === "pickup" ? (
                        <div className="flex justify-between items-center">
                          <span className="text-ink-muted">Pickup</span>
                          <span className="text-green-600 font-medium">Free</span>
                        </div>
                      ) : shippingLoading ? (
                        <div className="flex justify-between items-center">
                          <span className="text-ink-muted">Shipping</span>
                          <span className="flex items-center gap-1.5 text-ink-muted text-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Calculating
                          </span>
                        </div>
                      ) : shippingRates.length > 0 ? (
                        <CourierOptions
                          rates={shippingRates}
                          estimated={shippingEstimated}
                          selectedCourierId={selectedCourierId}
                          onSelect={setSelectedCourierId}
                        />
                      ) : (
                        <div className="flex justify-between items-center">
                          <span className="text-ink-muted">Shipping</span>
                          <span className="text-ink-muted text-sm">Calculated after address</span>
                        </div>
                      )}
                    </div>
                    <div className="h-px bg-line my-5" />
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-lg font-semibold text-ink">Total</span>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-ink tabular-nums"><Amt value={discountedSubtotal + shippingCostCur} w="w-24" /></span>
                        <span className="text-ink-muted text-sm ml-1">{shippingKnown ? currency : "+ shipping"}</span>
                      </div>
                    </div>
                    <button onClick={handleSubmitOrder} disabled={!canSubmit} className="w-full bg-ink hover:bg-ink/90 text-white py-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                      {isProcessing ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /><span>Processing...</span></>
                      ) : fulfillmentType === "shipping" && shippingLoading ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /><span>Calculating shipping…</span></>
                      ) : !contactComplete ? (
                        <><Lock className="w-5 h-5" /><span>Enter your details</span></>
                      ) : fulfillmentType === "shipping" && !shippingDetailsComplete ? (
                        <><Lock className="w-5 h-5" /><span>Enter shipping details</span></>
                      ) : (
                        <><Mail className="w-5 h-5" /><span>Submit Order</span></>
                      )}
                    </button>
                    {fulfillmentType === "shipping" && !shippingDetailsComplete && (
                      <p className="text-xs text-red-600 text-center mt-3">Please fill out the shipping address and phone number to submit your order</p>
                    )}
                    <div className="bg-vital-50 border border-vital/20 rounded-xl p-3 mt-4">
                      <p className="text-xs text-vital-800 text-center">You'll receive your order by email — Interac e-Transfer payment instructions will follow shortly</p>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-5 pt-5 border-t border-line">
                      <div className="flex items-center gap-2 text-ink-muted">
                        <ShieldCheck className="w-4 h-4 text-vital" />
                        <span className="text-xs">Secure Checkout</span>
                      </div>
                      <div className="flex items-center gap-2 text-ink-muted">
                        <Lock className="w-4 h-4 text-vital" />
                        <span className="text-xs">SSL Encrypted</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 text-center">
            <Link href="/" className="text-ink-muted hover:text-vital transition-colors text-sm">
              &larr; Back to VYTA Biosciences
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * PuraMass hosted-checkout screen.
 *
 * When the admin enables PuraMass checkout, the storefront collects the minimum
 * contact details, hands the cart off to `/api/checkout/puramass`, and redirects
 * the customer to the returned PuraMass payment link. PuraMass collects the
 * shipping address and calculates final pricing/shipping/taxes on its own page,
 * so this screen intentionally stays light and shows the cart as indicative.
 */
type AddonItem = AddToCartProduct & {
  puramass_sku: string | null;
  puramass_sku_vial: string | null;
};
// A PuraMass mapping is usable only when it points at a real PuraMass SKU of the
// right form: it must start with "puramass-" AND a case/box ends "-case" (e.g.
// "…-ss-31-50mg-case") / a single vial ends "-vial". This rejects legacy/invalid
// values like "bacteriostatic-water-10ml" that lack the "puramass-" prefix, and
// stale "-10-pack" case SKUs that PuraMass no longer recognises.
const boxOk = (s: string | null) => {
  const t = s?.trim();
  return !!t && t.startsWith("puramass-") && t.endsWith("-case");
};
const vialOk = (s: string | null) =>
  !!s && s.trim().startsWith("puramass-") && s.trim().endsWith("-vial");

/** A courier option for the hosted checkout, priced in the customer's currency. */
interface PuramassRate {
  courierId: string;
  courier: string;
  cost: number;
  currency: string;
  minDays?: number;
  maxDays?: number;
}

/**
 * Courier options for the hosted checkout, re-fetched (debounced) as the
 * recipient address is typed. Scoped server-side to UPS, FedEx and Canada Post,
 * and already carrying the configured processing fee.
 *
 * `unavailable` is true once an address has been entered but no courier could
 * be quoted for it — the checkout says so rather than letting the customer
 * continue toward a payment link with no shipping on it.
 */
function usePuramassRates(params: {
  enabled: boolean;
  postalCode: string;
  line1: string;
  city: string;
  state: string;
  country: string;
  items: { id: string; packSize: number; quantity: number }[];
}) {
  const { enabled, postalCode, line1, city, state, country, items } = params;
  const [rates, setRates] = useState<PuramassRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const itemsSig = JSON.stringify(items.map((i) => [i.id, i.packSize, i.quantity]));

  useEffect(() => {
    if (!enabled || postalCode.trim().length < 3 || items.length === 0) {
      setRates([]);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const res = await fetch("/api/checkout/puramass/rates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            destination: { line1, city, state, postalCode, country },
            items,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: PuramassRate[] = Array.isArray(data.rates) ? data.rates : [];
        setRates(list);
        setUnavailable(res.ok && list.length === 0);
      } catch {
        if (!cancelled) {
          setRates([]);
          setUnavailable(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, postalCode, line1, city, state, country, itemsSig]);

  return { rates, loading, unavailable };
}

function PuramassCheckoutContent({
  guestCheckoutEnabled,
  customerCheckoutEnabled,
}: {
  guestCheckoutEnabled: boolean;
  /**
   * When true the customer's own prices and currency are what PuraMass charges,
   * and they choose their courier here — so this screen collects the recipient
   * address and shows a real total. When false it stays the light hand-off
   * screen: PuraMass prices the order and collects the address on its own page,
   * and neither of the choices below is offered — pickup depends on this screen
   * naming the amounts, and an invoiced payment (e-Transfer, Bitcoin) on it
   * holding the address.
   */
  customerCheckoutEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, totalItems, pricesReady, clearCart } = useCart();
  const { customer } = useCustomer();
  const { currency, rate, convert } = useCurrency();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Optional — the house number configured in admin Settings stands in for the
  // courier when this is blank.
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * How the customer is getting their order. Pickup drops the courier step and
   * the address with it: the hand-off sends `shipping_total_cents: 0`, so
   * nothing is charged for delivery and nothing is shipped.
   */
  const [fulfillment, setFulfillment] = useState<"shipment" | "pickup">(
    "shipment",
  );
  const isPickup = fulfillment === "pickup";

  /**
   * How they're paying.
   *
   * "card" is the hosted checkout — the cart is handed to PuraMass and they pay
   * on its secure page, which is what this screen has always done. Every other
   * value is one of the in-house methods (Interac e-Transfer, Bitcoin): those
   * never touch PuraMass at all. The order is placed here, invoiced, and the
   * payment instructions for that method are emailed — the same full flow the
   * in-house checkout runs.
   */
  const [payWith, setPayWith] = useState<"card" | CheckoutPaymentMethodId>(
    "card",
  );
  // The in-house methods are only offered where this screen holds the address
  // and names the amounts; the light hand-off screen has neither.
  const invoicedMethods = customerCheckoutEnabled
    ? activeCheckoutPaymentMethods()
    : [];
  const payByInvoice =
    payWith !== "card" && isCheckoutPaymentMethodActive(payWith);
  /** The chosen in-house method, for its wording. Null while paying by card. */
  const invoicedMethod = payByInvoice
    ? (invoicedMethods.find((m) => m.id === payWith) ?? null)
    : null;

  /**
   * A placed invoiced order. The cart is cleared once one is placed, so this is
   * what the screen shows from then on.
   *
   * The order number also goes into the URL as `?order=`, and a visit carrying
   * one rehydrates from the server below — so a refresh or a back-nav can't
   * drop the customer on an empty cart with no record of what they just
   * ordered. The method is read back off the order for the same reason: the
   * confirmation has to name the instructions they were actually emailed.
   */
  const [placedOrder, setPlacedOrder] = useState<{
    orderNumber: string;
    email: string;
    method: CheckoutPaymentMethodId;
  } | null>(null);

  // Recipient address, collected here (rather than on the PuraMass page) so the
  // customer can pick a courier and we can create the shipment on payment.
  const [address, setAddress] = useState({
    line1: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
  });

  // Prefill from the signed-in customer when available.
  useEffect(() => {
    if (customer) {
      setEmail((e) => e || customer.email || "");
      setFirstName((f) => f || customer.first_name || "");
      setLastName((l) => l || customer.last_name || "");
    }
  }, [customer]);

  // Rehydrate the confirmation from `?order=` on refresh / back-nav. Best
  // effort: an order number that doesn't resolve simply leaves the checkout as
  // it is rather than showing a confirmation for an order we can't find.
  const orderParam = searchParams.get("order");
  useEffect(() => {
    if (!orderParam) return;
    let active = true;
    fetch(`/api/orders-email?orderNumber=${encodeURIComponent(orderParam)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d?.order_number) return;
        setPlacedOrder({
          orderNumber: d.order_number,
          email: d.email ?? "",
          method: d.crypto === "btc" ? "btc" : "etransfer",
        });
      })
      .catch(() => {
        /* best-effort — the checkout simply stays as it is */
      });
    return () => {
      active = false;
    };
  }, [orderParam]);

  const rateItems = items.map((i) => ({
    id: i.id,
    packSize: i.packSize,
    quantity: i.quantity,
  }));
  const {
    rates: shippingRates,
    loading: ratesLoading,
    unavailable: ratesUnavailable,
  } = usePuramassRates({
    // Nothing to quote for an order being collected in person, and an invoiced
    // order's shipping is quoted server-side when its invoice is raised.
    enabled: customerCheckoutEnabled && !isPickup && !payByInvoice,
    postalCode: address.postalCode,
    line1: address.line1,
    city: address.city,
    state: address.state,
    country: address.country,
    items: rateItems,
  });

  const [courierId, setCourierId] = useState("");
  // Default to the cheapest option whenever the list changes, keeping the
  // customer's pick when it's still on offer.
  useEffect(() => {
    if (shippingRates.length > 0) {
      setCourierId((prev) =>
        shippingRates.some((r) => r.courierId === prev) ? prev : shippingRates[0].courierId,
      );
    }
  }, [shippingRates]);
  const selectedRate =
    shippingRates.find((r) => r.courierId === courierId) || shippingRates[0] || null;

  // Checkout upsell (bacteriostatic water, needed to reconstitute peptides).
  // PuraMass fulfils these, so we do NOT filter by the store's own stock. We do
  // hide any form that has no valid PuraMass mapping (a case SKU must end
  // "-case", a vial SKU "-vial") and drop a product entirely if neither form
  // is fulfillable. Clicking a tile opens the allowed single-vial / case + qty
  // modal.
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [addonProduct, setAddonProduct] = useState<AddToCartProduct | null>(null);
  const [addonAllowed, setAddonAllowed] = useState<(1 | 10)[]>([1, 10]);
  useEffect(() => {
    let active = true;
    const url = new URL("/api/products", window.location.origin);
    url.searchParams.set("addon", "1");
    if (customer?.id) url.searchParams.set("customer_id", customer.id);
    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => {
        if (!active) return;
        const list: AddonItem[] = (d.products || [])
          .filter((p: any) => Number(p.price) > 0)
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            vial_price: p.vial_price != null ? Number(p.vial_price) : null,
            price_usd: p.price_usd != null ? Number(p.price_usd) : null,
            has_override: p.has_override,
            strength: p.strength ?? "",
            image_url: p.image_url ?? undefined,
            box_image_url: p.box_image_url ?? undefined,
            puramass_sku: p.puramass_sku ?? null,
            puramass_sku_vial: p.puramass_sku_vial ?? null,
          }))
          // Keep only products with at least one fulfillable form.
          .filter((p: AddonItem) => boxOk(p.puramass_sku) || vialOk(p.puramass_sku_vial));
        setAddons(list);
      })
      .catch(() => {
        /* best-effort — the upsell simply doesn't render on failure */
      });
    return () => {
      active = false;
    };
  }, [customer?.id]);
  // The pack sizes we can actually hand off for this product.
  const allowedFor = (p: AddonItem): (1 | 10)[] => {
    const a: (1 | 10)[] = [];
    if (vialOk(p.puramass_sku_vial)) a.push(1);
    if (boxOk(p.puramass_sku)) a.push(10);
    return a.length ? a : [1];
  };
  // Price anchor for the tile, in the active display currency: the vial price
  // when a vial is offered, else the pack-of-10 price.
  const addonAnchor = (p: AddonItem): { amount: number; label: string } => {
    if (vialOk(p.puramass_sku_vial)) {
      const cad = p.vial_price != null && p.vial_price > 0 ? p.vial_price : p.price / 10;
      return { amount: currency === "USD" ? cad * rate : cad, label: "/ vial" };
    }
    // A catalog `price_usd` is itself a converted figure, so it is only used
    // when this customer's prices convert; otherwise the configured price
    // stands as-is (rate is 1 in that mode).
    const usd =
      convert && p.price_usd != null && p.price_usd > 0 ? p.price_usd : p.price * rate;
    return { amount: currency === "USD" ? usd : p.price, label: "/ 10-pack" };
  };

  const unitCur = (item: { price: number; priceUsd?: number | null }) =>
    currency === "USD"
      ? item.priceUsd != null
        ? item.priceUsd
        : item.price * rate
      : item.price;
  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
  const indicativeTotal = items.reduce((s, i) => s + unitCur(i) * i.quantity, 0);
  const shippingCost = isPickup ? 0 : (selectedRate?.cost ?? 0);
  const orderTotal = indicativeTotal + shippingCost;
  // Whether the figure above is the whole story. A pickup is free and a chosen
  // courier is quoted, but an invoiced order's shipping is quoted server-side
  // when its invoice is raised — so the screen says so rather than showing a
  // total the invoice then adds to.
  const shippingSettled = isPickup || (!payByInvoice && Boolean(selectedRate));

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const addressComplete = Boolean(
    address.line1.trim() && address.city.trim() && address.postalCode.trim(),
  );
  // An invoiced order is raised in our own system, which needs a name to make
  // the invoice out to; the hosted checkout collects one on its own page.
  const nameComplete = Boolean(firstName.trim() && lastName.trim());
  // With the feature on, an order can't be handed off until there is somewhere
  // to send it and something to charge for shipping — the payment link bakes
  // both in. Pickup removes the question; an invoiced order still needs the
  // address (it ships from here) but not a courier chosen up front.
  const fulfillmentReady =
    !customerCheckoutEnabled ||
    isPickup ||
    (addressComplete && (payByInvoice || Boolean(selectedRate)));
  const canSubmit =
    emailValid &&
    // Hold the hand-off until the cart carries this customer's own prices. The
    // server re-derives the amounts either way, but the screen would otherwise
    // quote a figure the payment link then contradicts.
    pricesReady &&
    (!payByInvoice || nameComplete) &&
    fulfillmentReady;

  /**
   * Place an order to be paid by one of the in-house methods — Interac
   * e-Transfer or Bitcoin.
   *
   * This never touches PuraMass: the cart goes to the in-house order API, which
   * prices it against this customer, raises the order and its invoice, and
   * emails the payment instructions for the chosen method. Shipping is quoted
   * there too (pickup is free), which is why this screen doesn't ask for a
   * courier. The method is re-resolved server-side against the same registry
   * this screen renders from, so one turned off in between can't be ordered
   * against.
   */
  const placeInvoicedOrder = async () => {
    setSubmitting(true);
    try {
      const stored = getStoredReferral();
      const res = await fetch("/api/orders-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The CAD base price plus the USD snapshot, as the in-house checkout
          // sends them: the server re-derives both against the signed-in
          // customer, so these are a starting point, never the billed amount.
          items: items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            priceUsd: i.priceUsd ?? null,
            quantity: i.quantity,
            strength: i.strength,
            priceType: i.priceType,
            packSize: i.packSize,
          })),
          shipping: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.line1.trim(),
            city: address.city.trim(),
            state: address.state.trim(),
            postalCode: address.postalCode.trim(),
            country: address.country,
          },
          referralCode: stored || undefined,
          customerId: customer?.id,
          currency,
          fulfillmentType: isPickup ? "pickup" : "shipping",
          paymentMethod: payWith,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.orderNumber) {
        toast.error(
          data.error || "Your order could not be placed. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      setPlacedOrder({
        orderNumber: data.orderNumber as string,
        email: email.trim(),
        method: payWith as CheckoutPaymentMethodId,
      });
      // Keep the order number in the URL so a refresh rehydrates this
      // confirmation instead of showing an empty cart.
      router.replace(`/checkout?order=${encodeURIComponent(data.orderNumber)}`);
      clearCart();
    } catch {
      toast.error("Your order could not be placed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!items.length) {
      toast.error("Your cart is empty.");
      return;
    }
    if (!emailValid) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (customerCheckoutEnabled && !isPickup && !addressComplete) {
      toast.error("Please enter your shipping address.");
      return;
    }
    if (customerCheckoutEnabled && !isPickup && !payByInvoice && !selectedRate) {
      toast.error("Please choose a shipping method.");
      return;
    }
    if (payByInvoice && !nameComplete) {
      toast.error("Please enter your first and last name.");
      return;
    }
    if (payByInvoice) {
      await placeInvoicedOrder();
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const stored = getStoredReferral();
      const res = await fetch("/api/checkout/puramass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          items: items.map((i) => ({
            id: i.id,
            packSize: i.packSize,
            quantity: i.quantity,
            name: i.name,
          })),
          customer: {
            email: email.trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim(),
          },
          // The address and the chosen courier. The server re-quotes the rate
          // before charging it, so no cost is sent from here. A pickup has
          // neither: the server charges zero shipping for it.
          ...(customerCheckoutEnabled && !isPickup
            ? {
                shipping: {
                  line1: address.line1.trim(),
                  city: address.city.trim(),
                  state: address.state.trim(),
                  postalCode: address.postalCode.trim(),
                  country: address.country,
                  courierId: selectedRate?.courierId ?? "",
                },
              }
            : {}),
          ...(customerCheckoutEnabled ? { fulfillment } : {}),
          referralCode: stored || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment_link) {
        if (Array.isArray(data.unmapped) && data.unmapped.length) {
          toast.error(
            `Not available for hosted checkout yet: ${data.unmapped.join(", ")}`,
          );
        } else {
          toast.error(data.error || "Checkout could not be started. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      // Redirect to the PuraMass hosted payment page. Keep `submitting` true so
      // the button stays disabled during navigation.
      window.location.href = data.payment_link;
    } catch {
      toast.error("Checkout could not be started. Please try again.");
      setSubmitting(false);
    }
  };

  if (!guestCheckoutEnabled && !customer) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white rounded-2xl border border-line p-8 text-center">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
            <Lock className="w-8 h-8 text-ink-muted" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">Account Required</h2>
          <p className="text-ink-muted text-sm mb-6">
            Guest checkout is currently disabled. Please sign in to continue.
          </p>
          <Link
            href="/login?redirect=/checkout"
            className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  // A placed invoiced order — the cart is empty by now, so this has to come
  // before the empty-cart screen or the customer would be told to go shopping
  // straight after ordering.
  if (placedOrder) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white rounded-2xl border border-line p-8 text-center">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
            <CheckCircle className="w-8 h-8 text-vital" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">Order placed</h2>
          <p className="text-ink-muted text-sm mb-4">
            Thanks — your order is in. We&apos;ve emailed{" "}
            {placedOrder.email ? (
              <span className="font-medium text-ink">{placedOrder.email}</span>
            ) : (
              "you"
            )}{" "}
            your invoice and the{" "}
            {placedOrder.method === "btc" ? "Bitcoin" : "Interac e-Transfer"}{" "}
            payment instructions. Your order is processed once the payment
            arrives.
          </p>
          <div className="bg-surface rounded-xl border border-line p-4 mb-6">
            <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
              Order number
            </p>
            <p className="font-mono text-base font-semibold text-ink">
              {placedOrder.orderNumber}
            </p>
          </div>
          <p className="text-xs text-ink-muted mb-6">
            {isPickup
              ? "We'll be in touch to arrange your pickup once payment is received."
              : "We'll email your fulfillment details as soon as your payment is received."}
          </p>
          <Link
            href="/products"
            className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-white rounded-2xl border border-line p-8 text-center">
          <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
            <ShoppingCart className="w-8 h-8 text-ink-muted" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">Your cart is empty</h2>
          <p className="text-ink-muted text-sm mb-6">
            Add a product before proceeding to checkout.
          </p>
          <Link
            href="/products"
            className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-ink/90 text-white py-3 rounded-xl font-semibold transition-all text-sm"
          >
            Browse Products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-5 sm:px-8 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 mb-4">
            <VytaMark size={38} />
            <span className="font-display text-lg font-semibold tracking-[0.28em] text-ink">VYTA</span>
          </Link>
          <h1 className="text-2xl font-bold text-ink">Secure Checkout</h1>
        </div>

        <div className="flex items-start gap-3 bg-surface border border-line rounded-xl p-4 mb-6">
          <ShieldCheck className="w-5 h-5 text-vital flex-shrink-0 mt-0.5" />
          <p className="text-sm text-ink-muted">
            {customerCheckoutEnabled ? (
              payByInvoice ? (
                <>
                  Place your order below and we&apos;ll email your invoice with
                  the {invoicedMethod?.label} payment instructions. Your order is
                  processed once the payment arrives.
                </>
              ) : isPickup ? (
                <>
                  You&apos;re collecting this order, so there&apos;s nothing to
                  ship and no shipping to pay. You&apos;ll be redirected to our
                  secure checkout to pay the total shown here.
                </>
              ) : (
                <>
                  Enter your shipping details and choose a courier below, then
                  you&apos;ll be redirected to our secure checkout to pay. The
                  total shown here is what you&apos;ll be charged.
                </>
              )
            ) : (
              <>
                You&apos;ll be redirected to our secure hosted checkout to enter
                your shipping details and complete payment. Final pricing,
                shipping, and taxes are calculated on that page.
              </>
            )}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* Details and (when collected here) the address + courier, stacked in
              the left column beside the order summary. */}
          <div className="space-y-6">
          {/* Contact details */}
          <div className="bg-white rounded-2xl border border-line p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-ink" />
              <h2 className="text-base font-semibold text-ink">Your details</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                  autoComplete="email"
                />
                <p className="text-xs text-ink-muted mt-1">
                  Your order confirmation is sent here.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    First name{" "}
                    {/* An invoiced order becomes an invoice in our own system,
                        which needs a name to make it out to. */}
                    {payByInvoice && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Last name{" "}
                    {payByInvoice && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="family-name"
                  />
                </div>
              </div>
              {customerCheckoutEnabled ? (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Phone{" "}
                    <span className="text-ink-muted font-normal">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="For courier delivery updates"
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="tel"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Leave blank and we&apos;ll give the courier our own number.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  Name and shipping address are optional here — you can also enter
                  them on the next page.
                </p>
              )}
            </div>
          </div>

          {/* How they're getting it, and how they're paying. Both only when the
              customer checkout is on: pickup needs us to name the amounts (it
              sends zero shipping), and an invoiced order needs the address this
              screen collects. */}
          {customerCheckoutEnabled && (
            <div className="bg-white rounded-2xl border border-line p-6">
              <div className="flex items-center gap-2 mb-4">
                <Store className="w-5 h-5 text-ink" />
                <h2 className="text-base font-semibold text-ink">
                  How would you like it?
                </h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {(
                  [
                    {
                      id: "shipment" as const,
                      label: "Ship it to me",
                      hint: "Choose a courier below",
                      Icon: Truck,
                    },
                    {
                      id: "pickup" as const,
                      label: "Pick it up",
                      hint: "Collect in person — no shipping charge",
                      Icon: Store,
                    },
                  ]
                ).map(({ id, label, hint, Icon }) => (
                  <label
                    key={id}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      fulfillment === id
                        ? "border-vital bg-vital/5"
                        : "border-line hover:border-ink-muted/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="puramass-fulfillment"
                      checked={fulfillment === id}
                      onChange={() => setFulfillment(id)}
                      className="mt-0.5 accent-vital"
                    />
                    <Icon className="w-4 h-4 text-ink mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{label}</p>
                      <p className="text-[11px] text-ink-muted">{hint}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Pay now by card, or place the order here and settle the
                  invoice by one of the in-house methods. The list after the
                  card comes straight from the payment-method registry, so
                  turning one off there removes it from this screen and from the
                  order API in the same move. */}
              {invoicedMethods.length > 0 && (
                <div className="mt-5 border-t border-line pt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="w-4 h-4 text-ink" />
                    <h3 className="text-sm font-semibold text-ink">
                      How would you like to pay?
                    </h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      {
                        id: "card" as const,
                        label: "Card — secure checkout",
                        description: "Pay now on our secure checkout page.",
                      },
                      ...invoicedMethods,
                    ].map(({ id, label, description }) => (
                      <label
                        key={id}
                        className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          payWith === id
                            ? "border-vital bg-vital/5"
                            : "border-line hover:border-ink-muted/30"
                        }`}
                      >
                        <input
                          type="radio"
                          name="puramass-payment"
                          checked={payWith === id}
                          onChange={() => setPayWith(id)}
                          className="mt-0.5 accent-vital"
                        />
                        {id === "btc" ? (
                          <span className="text-base leading-5 font-bold text-ink flex-shrink-0">
                            &#8383;
                          </span>
                        ) : id === "card" ? (
                          <ShieldCheck className="w-4 h-4 text-ink mt-0.5 flex-shrink-0" />
                        ) : (
                          <Mail className="w-4 h-4 text-ink mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{label}</p>
                          <p className="text-[11px] text-ink-muted">{description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {payByInvoice && (
                    <p className="mt-3 text-[11px] text-ink-muted">
                      Your order is placed here and invoiced by email — you
                      won&apos;t be sent to the card checkout.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Where it's going. Pickup has no address to collect — the counter
              is arranged with their sales person instead. */}
          {customerCheckoutEnabled && isPickup && (
            <div className="bg-white rounded-2xl border border-line p-6">
              <div className="flex items-center gap-2 mb-4">
                <Store className="w-5 h-5 text-ink" />
                <h2 className="text-base font-semibold text-ink">Pickup</h2>
              </div>
              <div className="bg-surface rounded-xl p-4 border border-line">
                <div className="flex items-start gap-3">
                  <User className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Please contact your sales person to arrange your pickup.
                    </p>
                    <p className="text-xs text-ink-muted mt-1">
                      They&apos;ll confirm the location and time once your
                      payment is received. Nothing is charged for shipping.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shipping address + courier. Only when the customer checkout is on;
              otherwise PuraMass collects the address on its own page. */}
          {customerCheckoutEnabled && !isPickup && (
            <div className="bg-white rounded-2xl border border-line p-6">
              <div className="flex items-center gap-2 mb-4">
                <Truck className="w-5 h-5 text-ink" />
                <h2 className="text-base font-semibold text-ink">
                  Shipping address
                </h2>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-ink mb-1">
                    Street address <span className="text-red-500">*</span>
                  </label>
                  <AddressAutocomplete
                    value={address.line1}
                    onChange={(street) =>
                      setAddress((a) => ({ ...a, line1: street }))
                    }
                    onSelect={(parsed: ParsedAddress) =>
                      setAddress({
                        line1: parsed.line1,
                        city: parsed.city,
                        state: parsed.state,
                        postalCode: parsed.postalCode,
                        country: parsed.country || "CA",
                      })
                    }
                    placeholder="Start typing your address…"
                    className="w-full px-4 py-2.5 pr-10 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={address.city}
                    onChange={(e) =>
                      setAddress((a) => ({ ...a, city: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="address-level2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Province / State
                  </label>
                  <input
                    type="text"
                    value={address.state}
                    onChange={(e) =>
                      setAddress((a) => ({ ...a, state: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="address-level1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Postal code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={address.postalCode}
                    onChange={(e) =>
                      setAddress((a) => ({ ...a, postalCode: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="postal-code"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value={address.country}
                    onChange={(e) =>
                      setAddress((a) => ({ ...a, country: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-vital focus:outline-none text-sm"
                    autoComplete="country"
                  />
                </div>
              </div>

              {/* Courier options, priced in the customer's own currency. An
                  invoiced order isn't charged here, so its shipping is quoted
                  server-side and stated on the invoice instead. */}
              {payByInvoice ? (
                <div className="mt-5 border-t border-line pt-5">
                  <h3 className="text-sm font-semibold text-ink mb-1">
                    Shipping
                  </h3>
                  <p className="text-sm text-ink-muted">
                    Shipping is calculated for this address and shown on the
                    invoice we email you.
                  </p>
                </div>
              ) : (
              <div className="mt-5 border-t border-line pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink">
                    Shipping method
                  </h3>
                  {ratesLoading && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Finding couriers…
                    </span>
                  )}
                </div>

                {!addressComplete ? (
                  <p className="text-sm text-ink-muted">
                    Enter your address to see available couriers.
                  </p>
                ) : ratesUnavailable ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      No courier could be quoted for that address. Double-check
                      it, or contact us and we&apos;ll arrange shipping for you.
                    </span>
                  </div>
                ) : shippingRates.length === 0 ? (
                  <p className="text-sm text-ink-muted">Looking up rates…</p>
                ) : (
                  <div className="space-y-2">
                    {shippingRates.map((r) => (
                      <label
                        key={r.courierId}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          courierId === r.courierId
                            ? "border-vital bg-vital/5"
                            : "border-line hover:border-ink-muted/30"
                        }`}
                      >
                        <input
                          type="radio"
                          name="puramass-courier"
                          checked={courierId === r.courierId}
                          onChange={() => setCourierId(r.courierId)}
                          className="accent-vital"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">
                            {r.courier}
                          </p>
                          {r.maxDays ? (
                            <p className="text-[11px] text-ink-muted">
                              {r.minDays ?? r.maxDays}-{r.maxDays} business days
                            </p>
                          ) : null}
                        </div>
                        <span className="text-sm font-semibold text-ink tabular-nums">
                          {money(r.cost)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          )}
          </div>

          {/* Order summary */}
          <div className="bg-white rounded-2xl border border-line p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="w-5 h-5 text-ink" />
              <h2 className="text-base font-semibold text-ink">
                Order summary ({totalItems})
              </h2>
            </div>
            <div className="divide-y divide-line">
              {items.map((item) => {
                const packLabel =
                  item.packSize === 1 ? "Single vial" : "Pack of 10";
                const packs = Math.max(1, Math.round(item.quantity / (item.packSize || 1)));
                return (
                  <div
                    key={cartLineKey(item.id, item.packSize)}
                    className="py-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{item.name}</p>
                      <p className="text-xs text-ink-muted">
                        {item.strength ? `${item.strength} · ` : ""}
                        {packs} × {packLabel}
                      </p>
                    </div>
                    <p className="text-sm text-ink whitespace-nowrap">
                      {money(unitCur(item) * item.quantity)}
                    </p>
                  </div>
                );
              })}
            </div>
            {customerCheckoutEnabled ? (
              <>
                <div className="border-t border-line mt-3 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-muted">Subtotal</span>
                    <span className="text-sm text-ink tabular-nums">
                      <PriceAmount value={indicativeTotal} ready={pricesReady} w="w-14" />
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-muted">
                      {isPickup ? "Pickup" : "Shipping"}
                      {!isPickup && selectedRate ? (
                        <span className="text-ink-muted/70"> · {selectedRate.courier}</span>
                      ) : null}
                    </span>
                    <span className="text-sm text-ink">
                      {isPickup
                        ? "Free"
                        : payByInvoice
                          ? "On your invoice"
                          : selectedRate
                            ? money(shippingCost)
                            : "—"}
                    </span>
                  </div>
                </div>
                <div className="border-t border-line mt-3 pt-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">Total</span>
                  <span className="text-base font-bold text-ink">
                    {money(orderTotal)} {currency}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted mt-2">
                  {payByInvoice
                    ? shippingSettled
                      ? "This is the amount due on the invoice we'll email you."
                      : "Shipping is added to the invoice we'll email you."
                    : shippingSettled
                      ? "This is what you'll be charged on the secure checkout page."
                      : "Choose a shipping method to see your total."}
                </p>
              </>
            ) : (
              <>
                <div className="border-t border-line mt-3 pt-3 flex items-center justify-between">
                  <span className="text-sm text-ink-muted">Indicative subtotal</span>
                  <span className="text-base font-bold text-ink tabular-nums">
                    <PriceAmount value={indicativeTotal} ready={pricesReady} w="w-16" /> {currency}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted mt-2">
                  Shown for reference. The amount charged is set on the secure
                  checkout page.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Upsell — bacteriostatic water. Each tile opens the single-vial /
            case + quantity modal. */}
        {addons.length > 0 && (
          <div className="mt-6 rounded-2xl border border-line bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-surface">
              <Sparkles className="w-4 h-4 text-vital" />
              <h3 className="text-sm font-semibold text-ink">Complete your order</h3>
            </div>
            <div className="p-4">
              <p className="text-xs text-ink-muted mb-3">
                Bacteriostatic water — needed to reconstitute lyophilized
                peptides. Choose your option and quantity on the next step.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                {addons.map((p) => {
                  const anchor = addonAnchor(p);
                  return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setAddonAllowed(allowedFor(p));
                      setAddonProduct(p);
                    }}
                    className="group flex items-center gap-3 text-left rounded-xl border border-line bg-white hover:border-ink/30 hover:bg-surface transition-all p-3"
                  >
                    <div className="bg-surface w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 border border-line overflow-hidden">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-full h-full object-contain p-0.5"
                        />
                      ) : (
                        <Beaker className="w-5 h-5 text-line" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-ink leading-snug line-clamp-2">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        from {money(anchor.amount)} {anchor.label}
                      </p>
                    </div>
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink text-white group-hover:bg-ink/90">
                      <Plus className="w-4 h-4" />
                    </span>
                  </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-ink hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold transition-all text-sm"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {payByInvoice ? "Placing your order…" : "Redirecting to secure checkout…"}
            </>
          ) : (
            <>
              {payByInvoice ? "Place order" : "Continue to secure checkout"}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        <p className="mt-2 text-center text-[11px] text-ink-muted">
          {payByInvoice ? (
            <>
              Your invoice is raised in{" "}
              <span className="font-medium text-ink">{currency}</span> and
              emailed with the {invoicedMethod?.label} payment instructions —
              nothing is charged to a card.
            </>
          ) : customerCheckoutEnabled ? (
            <>
              Your order is charged in{" "}
              <span className="font-medium text-ink">{currency}</span> on the
              secure checkout page, at the prices shown here.
            </>
          ) : (
            <>
              Your total is calculated and charged in{" "}
              <span className="font-medium text-ink">USD</span> on the secure
              checkout page.
            </>
          )}
        </p>

        <div className="mt-6 text-center">
          <Link
            href="/cart"
            className="text-ink-muted hover:text-vital transition-colors text-sm"
          >
            &larr; Back to cart
          </Link>
        </div>

        <AddToCartModal
          product={addonProduct}
          allowedPackSizes={addonAllowed}
          onClose={() => setAddonProduct(null)}
        />
      </div>
    </div>
  );
}

interface CheckoutSettings {
  checkout_type: "email" | "crypto";
  guest_checkout_enabled: boolean;
  puramass_checkout_enabled: boolean;
  /** Customer pricing + courier choice on the hosted checkout. */
  puramass_customer_checkout_enabled: boolean;
}

function CheckoutContent() {
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);

  useEffect(() => {
    // Never serve a stale settings response here — it decides which checkout
    // (in-house invoice vs PuraMass hosted) the customer is routed to.
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setSettings({
          // Crypto checkout is disabled site-wide — always use email/invoice.
          checkout_type: "email",
          guest_checkout_enabled: d.guest_checkout_enabled ?? true,
          puramass_checkout_enabled: d.puramass_checkout_enabled ?? false,
          puramass_customer_checkout_enabled:
            d.puramass_customer_checkout_enabled ?? false,
        }),
      )
      .catch(() =>
        setSettings({
          checkout_type: "email",
          guest_checkout_enabled: true,
          puramass_checkout_enabled: false,
          puramass_customer_checkout_enabled: false,
        }),
      );
  }, []);

  if (!settings) {
    return <CheckoutSkeleton />;
  }

  // PuraMass hosted checkout takes precedence when enabled; otherwise the
  // in-house email/invoice flow is used.
  if (settings.puramass_checkout_enabled) {
    return (
      <PuramassCheckoutContent
        guestCheckoutEnabled={settings.guest_checkout_enabled}
        customerCheckoutEnabled={settings.puramass_customer_checkout_enabled}
      />
    );
  }

  return settings.checkout_type === "email" ? (
    <EmailCheckoutContent />
  ) : (
    <CryptoCheckoutContent />
  );
}

/**
 * Loading placeholder for the checkout — mirrors the two-column layout (details
 * form on the left, order summary on the right) with shimmer blocks instead of a
 * bare spinner, so the page doesn't jump when the real content mounts.
 */
function CheckoutSkeleton() {
  return (
    <div className="min-h-screen bg-white pt-28 pb-16 animate-pulse">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
        <div className="h-8 w-48 bg-surface rounded mb-8" />
        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Details form */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-line space-y-4">
              <div className="h-5 w-40 bg-surface rounded" />
              <div className="grid grid-cols-2 gap-4">
                <div className="h-11 bg-surface rounded-xl" />
                <div className="h-11 bg-surface rounded-xl" />
              </div>
              <div className="h-11 bg-surface rounded-xl" />
              <div className="h-11 bg-surface rounded-xl" />
            </div>
            <div className="bg-white rounded-2xl p-6 border border-line space-y-4">
              <div className="h-5 w-32 bg-surface rounded" />
              <div className="h-11 bg-surface rounded-xl" />
              <div className="grid grid-cols-2 gap-4">
                <div className="h-11 bg-surface rounded-xl" />
                <div className="h-11 bg-surface rounded-xl" />
              </div>
            </div>
          </div>
          {/* Order summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl p-6 border border-line space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-14 h-14 bg-surface rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-surface rounded" />
                    <div className="h-3 w-1/2 bg-surface rounded" />
                  </div>
                </div>
              ))}
              <div className="h-px bg-line my-2" />
              <div className="flex justify-between">
                <div className="h-4 w-20 bg-surface rounded" />
                <div className="h-4 w-16 bg-surface rounded" />
              </div>
              <div className="flex justify-between">
                <div className="h-4 w-16 bg-surface rounded" />
                <div className="h-4 w-20 bg-surface rounded" />
              </div>
              <div className="h-px bg-line my-2" />
              <div className="flex justify-between">
                <div className="h-6 w-16 bg-surface rounded" />
                <div className="h-6 w-24 bg-surface rounded" />
              </div>
              <div className="h-12 bg-surface rounded-xl mt-2" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutContent />
    </Suspense>
  );
}
