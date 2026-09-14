import type { ReceivingWallet } from '@/lib/payments/receiving-wallets';

/** The payload returned by GET /api/pay/:token. */
export interface PayView {
  invoice: {
    invoice_number: string;
    status: string;
    currency: string;
    issue_date: string | null;
    due_date: string | null;
    customer_name: string | null;
    subtotal: number;
    tax_total: number;
    shipping_cost: number;
    processing_fee: number;
    total: number;
    amount_paid: number;
    amount_due: number;
    payable: boolean;
    selected_method: 'crypto' | 'card' | null;
    crypto_wallet_id: string | null;
    crypto_payment_reference: string | null;
    crypto_payment_declared_at: string | null;
    items: {
      description: string;
      qty: number;
      unit_price: number;
      line_total: number;
      price_type: string | null;
    }[];
  };
  /**
   * The payment link is locked — a product on the invoice is missing its
   * Stealth Health single-vial SKU. Every method is off and the customer is
   * asked to contact us; the reason itself stays on the admin side.
   */
  locked: boolean;
  locked_message: string | null;
  methods: { crypto: boolean; card: boolean };
  wallets: ReceivingWallet[];
  crypto_instructions: string;
}

export function money(amount: number, currency: string): string {
  return `$${Number(amount).toFixed(2)} ${currency}`;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
