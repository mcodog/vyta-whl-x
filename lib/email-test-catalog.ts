/**
 * Catalog of every transactional email the app can send, used to render the
 * "send a test email" quick buttons in admin settings and to drive the
 * server-side test dispatcher.
 *
 * This file is intentionally free of any server-only imports (no nodemailer /
 * SMTP), so it can be imported from client components. The actual senders live
 * in `lib/email-test.ts`, keyed by the same `id`s.
 */

export type EmailAudience = 'customer' | 'admin';

export interface TestEmailType {
  /** Stable key shared with the server dispatcher. */
  id: string;
  /** Short button label. */
  label: string;
  /** One-line explanation of when this email is normally sent. */
  description: string;
  /** Who the email normally goes to in production. */
  audience: EmailAudience;
}

export const TEST_EMAIL_TYPES: TestEmailType[] = [
  // ---- Customer-facing ----
  {
    id: 'order_confirmation',
    label: 'Order Confirmation',
    description: 'Sent to a customer right after they place an order.',
    audience: 'customer',
  },
  {
    id: 'customer_invoice',
    label: 'Customer Invoice',
    description: 'Itemised invoice with payment instructions (email checkout).',
    audience: 'customer',
  },
  {
    id: 'payment_confirmed',
    label: 'Payment Confirmed',
    description: "Confirms a customer's payment has been received.",
    audience: 'customer',
  },
  {
    id: 'shipping_notification',
    label: 'Shipping Notification',
    description: 'Tracking details once an order ships.',
    audience: 'customer',
  },
  {
    id: 'customer_welcome',
    label: 'Customer Welcome',
    description: 'Greets a newly registered customer.',
    audience: 'customer',
  },
  {
    id: 'back_in_stock',
    label: 'Back in Stock',
    description: 'Tells a customer a watched product is available again.',
    audience: 'customer',
  },
  {
    id: 'magic_link',
    label: 'Sign-in Link',
    description: 'Passwordless magic-link sign-in email.',
    audience: 'customer',
  },
  {
    id: 'affiliate_welcome',
    label: 'Affiliate Welcome',
    description: 'Onboards a newly approved affiliate with their code.',
    audience: 'customer',
  },
  {
    id: 'affiliate_decision',
    label: 'Affiliate Decision',
    description: 'Notifies an applicant their affiliate request was approved.',
    audience: 'customer',
  },
  // ---- Admin-facing ----
  {
    id: 'new_order',
    label: 'New Order',
    description: 'Alerts admins that a new order has come in.',
    audience: 'admin',
  },
  {
    id: 'admin_payment',
    label: 'Payment Received',
    description: 'Alerts admins that a payment has cleared.',
    audience: 'admin',
  },
  {
    id: 'new_customer',
    label: 'New Customer',
    description: 'Alerts admins that a new customer has registered.',
    audience: 'admin',
  },
  {
    id: 'inactive_customer',
    label: 'Inactive Customer',
    description: 'Alerts admins a customer registered but has not ordered.',
    audience: 'admin',
  },
  {
    id: 'affiliate_request',
    label: 'Affiliate Request',
    description: 'Alerts admins of a new affiliate application.',
    audience: 'admin',
  },
  {
    id: 'low_stock',
    label: 'Low Stock',
    description: 'Alerts admins that a product is low or out of stock.',
    audience: 'admin',
  },
];

export const TEST_EMAIL_IDS = new Set(TEST_EMAIL_TYPES.map((t) => t.id));
