import type { RecordedPaymentMethod } from "@/lib/supabase";

/**
 * Maps an order's raw `crypto` column (which doubles as the payment-method
 * indicator) to a human-friendly label for the admin UI. Email-checkout orders
 * are paid via Interac e-Transfer; legacy crypto orders keep their ticker.
 */
const PAYMENT_LABELS: Record<string, string> = {
  email: "Interac e-Transfer",
  etransfer: "Interac e-Transfer",
  btc: "Bitcoin (BTC)",
  eth: "Ethereum (ETH)",
  sol: "Solana (SOL)",
};

export function paymentMethodLabel(crypto?: string | null): string {
  if (!crypto) return "Unknown";
  return PAYMENT_LABELS[crypto] ?? crypto.toUpperCase();
}

/** Compact label for tight spaces such as table cells. */
export function paymentMethodShortLabel(crypto?: string | null): string {
  if (!crypto) return "—";
  if (crypto === "email" || crypto === "etransfer") return "e-Transfer";
  return crypto.toUpperCase();
}

/**
 * Selectable methods for a manually recorded order payment, in display order.
 * Drives both the Record Payment dropdown and the read-back label.
 */
export const RECORDED_PAYMENT_METHODS: {
  value: RecordedPaymentMethod;
  label: string;
}[] = [
  { value: "etransfer", label: "E-Transfer" },
  { value: "crypto", label: "Crypto" },
  { value: "credit_card", label: "Credit Card" },
  { value: "other", label: "Other" },
];

/** Human label for a manually recorded payment method. */
export function recordedPaymentMethodLabel(
  method?: RecordedPaymentMethod | string | null,
): string {
  if (!method) return "—";
  return RECORDED_PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/* -------------------------------------------------------------------------- */
/* Storefront checkout payment methods                                        */
/* -------------------------------------------------------------------------- */

/**
 * Payment methods the customer can pick at checkout, in display order.
 *
 * Both are live: Interac e-Transfer and Bitcoin. Either way the order is placed
 * here and the payment instructions follow by email — the BTC ones render from
 * the template below, filled with the receiving address configured in
 * Settings → Crypto Payments.
 *
 * Turning a method off is a matter of flipping its `active` to false: it then
 * disappears from the checkout selector, is rejected server-side by
 * {@link resolveCheckoutPaymentMethod}, and shows as "coming soon" on the
 * in-house checkout.
 */
export type CheckoutPaymentMethodId = "etransfer" | "btc";

export interface CheckoutPaymentMethod {
  id: CheckoutPaymentMethodId;
  label: string;
  /** Short line shown under the method in the checkout selector. */
  description: string;
  /** When false the method is hidden from selection and rejected server-side. */
  active: boolean;
}

export const CHECKOUT_PAYMENT_METHODS: CheckoutPaymentMethod[] = [
  {
    id: "etransfer",
    label: "Interac e-Transfer",
    description:
      "We'll email you payment instructions shortly after you place your order.",
    active: true,
  },
  {
    id: "btc",
    label: "Bitcoin (BTC)",
    description: "Pay in Bitcoin. Instructions are emailed after you order.",
    active: true,
  },
];

/** The default/fallback method — the first active one (Interac e-Transfer). */
export const DEFAULT_CHECKOUT_PAYMENT_METHOD: CheckoutPaymentMethodId =
  CHECKOUT_PAYMENT_METHODS.find((m) => m.active)?.id ?? "etransfer";

export function activeCheckoutPaymentMethods(): CheckoutPaymentMethod[] {
  return CHECKOUT_PAYMENT_METHODS.filter((m) => m.active);
}

export function isCheckoutPaymentMethodActive(
  id: string | null | undefined,
): boolean {
  return CHECKOUT_PAYMENT_METHODS.some((m) => m.id === id && m.active);
}

/**
 * Normalise a requested checkout payment method to one that is actually active.
 * An inactive or unknown value (e.g. a client asking for BTC while it's off)
 * falls back to the default active method rather than being trusted.
 */
export function resolveCheckoutPaymentMethod(
  requested: string | null | undefined,
): CheckoutPaymentMethodId {
  return isCheckoutPaymentMethodActive(requested)
    ? (requested as CheckoutPaymentMethodId)
    : DEFAULT_CHECKOUT_PAYMENT_METHOD;
}

/**
 * Generic Bitcoin payment-instructions template used in the invoice email.
 * `{{placeholders}}` are filled by `renderPaymentInstructionsTemplate`; any left
 * unfilled are stripped, along with the label line they sat on, so a
 * partially-populated template never leaks raw `{{tokens}}` or a dangling
 * "BTC amount:" to the customer.
 *
 * `btc_address` comes from the receiving wallet configured in Settings → Crypto
 * Payments. `btc_amount` is deliberately left unfilled: BTC moves against the
 * dollar between the order and the payment, so the amount due is stated in the
 * order's own currency and the conversion is the customer's to make when they
 * send it.
 */
export const BTC_PAYMENT_INSTRUCTIONS_TEMPLATE = `Pay for order {{order_number}} with Bitcoin (BTC).

Amount due: {{amount}} {{currency}}

1. Send the amount due, in BTC, to the deposit address below.
2. Send only BTC on the Bitcoin network — funds sent on another network may be lost.
3. Your order is confirmed once the transaction reaches the required confirmations.

Deposit address: {{btc_address}}
BTC amount: {{btc_amount}}

Questions? Just reply to this email and our team will help.`;

/**
 * Fill a `{{placeholder}}` template. Provided keys are substituted; any
 * placeholder without a (non-empty) value is removed so the customer never sees
 * a raw token.
 *
 * A line that was nothing but a label and its placeholder ("BTC amount:
 * {{btc_amount}}") is dropped entirely rather than left as a label with nothing
 * after it — an unfilled value means we have nothing to say on that line.
 */
export function renderPaymentInstructionsTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  const filled = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
  return filled
    .split("\n")
    // A line ending in ":" only got there by losing its value — the template
    // itself never ends a line on a bare label.
    .filter((line) => !/:\s*$/.test(line))
    .join("\n");
}
