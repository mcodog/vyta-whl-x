/**
 * Server-side test-email dispatcher. Maps each catalog `id` to the real email
 * sender, invoked with obviously-fake sample data and routed to the supplied
 * recipients. Import only from server code (it pulls in the SMTP transport).
 */
import {
  sendOrderConfirmation,
  sendShippingNotification,
  sendCustomerWelcome,
  sendAffiliateWelcome,
  sendPaymentConfirmed,
  sendAdminPaymentNotification,
  sendMagicLink,
} from '@/lib/email';
import {
  sendCustomerInvoiceSMTP,
  sendAdminInvoiceNotificationSMTP,
  sendBackInStockNotification,
  sendLowStockAlert,
  sendAffiliateRequestAdminNotification,
  sendNewCustomerAdminNotification,
  sendInactiveCustomerAdminNotification,
  sendAffiliateRequestDecision,
} from '@/lib/email-smtp';

// ---- Shared sample data (clearly fake so a test is never mistaken for real) ----
const SAMPLE_ITEMS = [
  { name: 'BPC-157', quantity: 2, price: 55, strength: '5mg' },
  { name: 'TB-500', quantity: 1, price: 70, strength: '5mg' },
];
const SAMPLE_ADDRESS = {
  address: '123 Sample Street',
  city: 'Toronto',
  state: 'ON',
  postalCode: 'M5V 1A1',
  country: 'CA',
};
const ORDER_NUMBER = 'NP-TEST-0000';
const CUSTOMER_NAME = 'Jordan Sample';
const CUSTOMER_EMAIL = 'sample.customer@example.com';
const SUBTOTAL = 180;
const SHIPPING = 20;
const TOTAL = 200;
const REFERRAL = 'SAMPLE10';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';

type SendResult = { success: boolean; error?: string };
type Sender = (recipients: string[]) => Promise<SendResult>;

// Senders that take a single `to: string` receive a comma-joined list
// (nodemailer accepts that); senders that take `adminEmails` get the array.
const join = (recipients: string[]) => recipients.join(', ');

const SENDERS: Record<string, Sender> = {
  // ---- Customer-facing ----
  order_confirmation: (to) =>
    sendOrderConfirmation({
      to: join(to),
      customerName: CUSTOMER_NAME,
      orderNumber: ORDER_NUMBER,
      items: SAMPLE_ITEMS,
      subtotal: SUBTOTAL,
      shipping: SHIPPING,
      total: TOTAL,
    }),
  customer_invoice: (to) =>
    sendCustomerInvoiceSMTP({
      to: join(to),
      customerName: CUSTOMER_NAME,
      orderNumber: ORDER_NUMBER,
      items: SAMPLE_ITEMS,
      subtotal: SUBTOTAL,
      shipping: SHIPPING,
      total: TOTAL,
      shippingAddress: SAMPLE_ADDRESS,
      fulfillmentType: 'shipping',
      referralCode: REFERRAL,
    }),
  payment_confirmed: (to) =>
    sendPaymentConfirmed({ to: join(to), orderNumber: ORDER_NUMBER }),
  shipping_notification: (to) =>
    sendShippingNotification({
      to: join(to),
      customerName: CUSTOMER_NAME,
      orderNumber: ORDER_NUMBER,
      trackingNumber: '1Z-TEST-9999',
    }),
  customer_welcome: (to) =>
    sendCustomerWelcome({ to: join(to), customerName: CUSTOMER_NAME }),
  back_in_stock: (to) =>
    sendBackInStockNotification({
      to: join(to),
      productName: 'BPC-157',
      productSlug: 'bpc-157',
      strength: '5mg',
      price: 55,
    }),
  magic_link: (to) =>
    sendMagicLink({
      to: join(to),
      customerName: CUSTOMER_NAME,
      actionLink: `${BASE_URL}/account/dashboard?sample=1`,
    }),
  affiliate_welcome: (to) =>
    sendAffiliateWelcome({
      to: join(to),
      affiliateName: CUSTOMER_NAME,
      referralCode: REFERRAL,
    }),
  affiliate_decision: (to) =>
    sendAffiliateRequestDecision({
      to: join(to),
      applicantName: CUSTOMER_NAME,
      approved: true,
      referralCode: REFERRAL,
    }),

  // ---- Admin-facing ----
  new_order: (to) =>
    sendAdminInvoiceNotificationSMTP({
      adminEmails: to,
      orderNumber: ORDER_NUMBER,
      customerName: CUSTOMER_NAME,
      customerEmail: CUSTOMER_EMAIL,
      items: SAMPLE_ITEMS,
      subtotal: SUBTOTAL,
      shipping: SHIPPING,
      total: TOTAL,
      shippingAddress: SAMPLE_ADDRESS,
      fulfillmentType: 'shipping',
    }),
  admin_payment: (to) =>
    sendAdminPaymentNotification({
      to,
      orderNumber: ORDER_NUMBER,
      total: TOTAL,
      crypto: 'btc',
      paymentAmount: '0.0031',
      customerEmail: CUSTOMER_EMAIL,
      items: SAMPLE_ITEMS,
    }),
  new_customer: (to) =>
    sendNewCustomerAdminNotification({
      adminEmails: to,
      customerName: CUSTOMER_NAME,
      customerEmail: CUSTOMER_EMAIL,
      phone: '+1 (555) 123-4567',
      referredBy: 'Alex Affiliate',
      registeredAt: new Date().toISOString(),
      customerId: '00000000-0000-0000-0000-000000000000',
    }),
  inactive_customer: (to) =>
    sendInactiveCustomerAdminNotification({
      adminEmails: to,
      customerName: CUSTOMER_NAME,
      customerEmail: CUSTOMER_EMAIL,
      phone: '+1 (555) 123-4567',
      daysSinceRegistration: 7,
      registeredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      hasCartItems: true,
      customerId: '00000000-0000-0000-0000-000000000000',
    }),
  affiliate_request: (to) =>
    sendAffiliateRequestAdminNotification({
      adminEmails: to,
      applicantName: CUSTOMER_NAME,
      applicantEmail: CUSTOMER_EMAIL,
      message: 'This is a sample affiliate application message.',
      walletAddress: '0xSAMPLEWALLETADDRESS0000',
    }),
  low_stock: (to) =>
    sendLowStockAlert({
      adminEmails: to,
      productName: 'BPC-157',
      currentStock: 2,
      threshold: 5,
      productSlug: 'bpc-157',
      strength: '5mg',
    }),
};

export function isTestEmailType(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SENDERS, id);
}

/**
 * Send a single sample email of the given type to `recipients`.
 * Returns a normalised `{ success, error? }` regardless of the underlying sender.
 */
export async function sendTestEmail(
  id: string,
  recipients: string[],
): Promise<SendResult> {
  const sender = SENDERS[id];
  if (!sender) return { success: false, error: `Unknown email type: ${id}` };
  try {
    const result = await sender(recipients);
    return result?.success
      ? { success: true }
      : { success: false, error: result?.error || 'Send failed' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Send failed',
    };
  }
}
