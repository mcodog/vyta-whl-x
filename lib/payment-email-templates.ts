/**
 * Payment-request email — defaults, merge variables and rendering.
 *
 * This is the SECOND customer email an invoice can send. The first
 * (`lib/invoice-email-templates.ts`) attaches the invoice PDF and is unchanged;
 * this one carries a link to the hosted payment page (/pay/<token>) where the
 * customer picks crypto or Visa/Mastercard and pays.
 *
 * Templates are editable in admin Settings → "Payment Emails"; these constants
 * are the fallback when a store hasn't customised them.
 */
import {
  MERGE_VARS as INVOICE_MERGE_VARS,
  type MergeVarSpec,
  type InvoiceMergeVars,
  renderTemplate,
} from '@/lib/invoice-email-templates';

export const DEFAULT_PAYMENT_SUBJECT = 'Payment for invoice {{invoice_number}}';

export const DEFAULT_PAYMENT_BODY = `Hi {{customer_first_name}},

Your order is ready for payment. Invoice {{invoice_number}} has a balance of \${{amount_due}} {{currency}}.

Review your order and pay securely here:
{{payment_url}}

You can pay by crypto or by Visa / Mastercard — pick whichever you prefer on that page.

If anything looks off, just reply to this email and we'll sort it out.

— VYTA Biosciences`;

/**
 * Merge variables available in the payment email: everything the invoice email
 * offers, plus the payment-page link. `{{payment_url}}` is the one that matters
 * — a template without it emails the customer no way to pay, which the send
 * endpoint guards against by appending the link.
 */
export const PAYMENT_MERGE_VARS: MergeVarSpec[] = [
  ...INVOICE_MERGE_VARS,
  {
    name: 'payment_url',
    description: 'Link to the hosted payment page',
    sample: 'https://puramass.com/pay/abc123',
  },
];

export type PaymentMergeVars = InvoiceMergeVars;

export { renderTemplate };

/** Build the absolute payment-page URL for a token. */
export function paymentPageUrl(token: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com').replace(
    /\/+$/,
    '',
  );
  return `${base}/pay/${token}`;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Render the payment email as HTML: the admin's plain-text body with the
 * payment URL promoted to a real "Pay invoice" button, so the customer gets one
 * obvious thing to click rather than a bare link in a wall of text. The line
 * that held the URL is replaced by the button; the raw link is repeated
 * underneath for clients that strip buttons, and the plain-text alternative
 * (the body verbatim) still carries it for text-only readers.
 */
export function paymentEmailHtml(body: string, paymentUrl: string): string {
  const lines = body.split('\n');
  const urlLineIndex = lines.findIndex((l) => l.trim() === paymentUrl);
  const before = (urlLineIndex >= 0 ? lines.slice(0, urlLineIndex) : lines).join('\n').trimEnd();
  const after = urlLineIndex >= 0 ? lines.slice(urlLineIndex + 1).join('\n').trimStart() : '';

  const block = (text: string) =>
    text
      ? `<div style="white-space:pre-wrap;margin:0 0 20px;">${escapeHtml(text)}</div>`
      : '';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;color:#07203A;max-width:560px;">
${block(before)}
<div style="margin:0 0 20px;">
  <a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#438B9E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Pay invoice</a>
</div>
<div style="margin:0 0 20px;font-size:12px;color:#4E6E85;">Or paste this link into your browser:<br /><a href="${escapeHtml(
    paymentUrl,
  )}" style="color:#1B5D83;word-break:break-all;">${escapeHtml(paymentUrl)}</a></div>
${block(after)}
</div>`;
}
