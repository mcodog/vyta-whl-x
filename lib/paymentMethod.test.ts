import { describe, expect, it } from "vitest";
import {
  BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
  renderPaymentInstructionsTemplate,
  resolveCheckoutPaymentMethod,
} from "./paymentMethod";

/**
 * The payment instructions a customer is emailed after checkout.
 *
 * Two things must hold however little we can fill in: the customer never sees a
 * raw `{{token}}`, and never sees a label with nothing after it ("BTC amount:")
 * — which is what an unfilled value would otherwise leave behind, reading as if
 * we forgot to say the amount rather than as if there is none to state.
 */
describe("renderPaymentInstructionsTemplate", () => {
  it("substitutes the values it is given", () => {
    const out = renderPaymentInstructionsTemplate(
      BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
      {
        order_number: "AMC-ABC12345",
        amount: "420.00",
        currency: "CAD",
        btc_address: "bc1qexampleaddress",
      },
    );
    expect(out).toContain("AMC-ABC12345");
    expect(out).toContain("Amount due: 420.00 CAD");
    expect(out).toContain("Deposit address: bc1qexampleaddress");
  });

  it("leaves no raw placeholder behind", () => {
    const out = renderPaymentInstructionsTemplate(
      BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
      { order_number: "AMC-ABC12345" },
    );
    expect(out).not.toMatch(/\{\{/);
  });

  it("drops a line left as a bare label", () => {
    // btc_amount is deliberately never filled — BTC moves against the dollar
    // between the order and the payment.
    const out = renderPaymentInstructionsTemplate(
      BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
      {
        order_number: "AMC-ABC12345",
        amount: "420.00",
        currency: "CAD",
        btc_address: "bc1qexampleaddress",
      },
    );
    expect(out).not.toContain("BTC amount:");
    // The lines that did get a value are untouched.
    expect(out).toContain("Deposit address: bc1qexampleaddress");
  });

  it("keeps the numbered steps, which carry no placeholders", () => {
    const out = renderPaymentInstructionsTemplate(
      BTC_PAYMENT_INSTRUCTIONS_TEMPLATE,
      {},
    );
    expect(out).toContain("Send only BTC on the Bitcoin network");
  });
});

/**
 * The registry is the single switch over which methods can be ordered against:
 * the checkout renders from it and the order API re-resolves against it, so a
 * client asking for something it doesn't offer is normalised, never trusted.
 */
describe("resolveCheckoutPaymentMethod", () => {
  it("keeps an active method", () => {
    expect(resolveCheckoutPaymentMethod("btc")).toBe("btc");
    expect(resolveCheckoutPaymentMethod("etransfer")).toBe("etransfer");
  });

  it("falls back to the default for anything unknown", () => {
    expect(resolveCheckoutPaymentMethod("doge")).toBe("etransfer");
    expect(resolveCheckoutPaymentMethod(null)).toBe("etransfer");
    expect(resolveCheckoutPaymentMethod(undefined)).toBe("etransfer");
  });
});
