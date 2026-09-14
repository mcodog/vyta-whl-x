import type { Invoice } from '@/lib/supabase';

export const DEFAULT_CUSTOMER_SUBJECT =
  'Your PuraMass invoice {{invoice_number}}';

export const DEFAULT_CUSTOMER_BODY = `Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is \${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we'll sort it out.

— PuraMass`;

export const DEFAULT_ADMIN_SUBJECT =
  '[Copy] Invoice {{invoice_number}} sent to {{customer_email}}';

export const DEFAULT_ADMIN_BODY = `Invoice {{invoice_number}} was just emailed to {{customer_name}} <{{customer_email}}>.

  Total: \${{invoice_total}} {{currency}}
  Amount due: \${{amount_due}} {{currency}}
  Due date: {{due_date}}
  Sent by: {{sent_by_email}}

PDF attached.`;

export interface MergeVarSpec {
  name: string;
  description: string;
  sample: string;
}

export const MERGE_VARS: MergeVarSpec[] = [
  { name: 'customer_name', description: 'Full customer name', sample: 'Alex Brown' },
  { name: 'customer_first_name', description: 'Customer first name', sample: 'Alex' },
  { name: 'customer_last_name', description: 'Customer last name', sample: 'Brown' },
  { name: 'customer_email', description: 'Customer email address', sample: 'alex@example.com' },
  { name: 'invoice_number', description: 'Invoice number', sample: 'INV-1042' },
  { name: 'invoice_total', description: 'Total amount (formatted)', sample: '249.50' },
  { name: 'amount_due', description: 'Outstanding balance (formatted)', sample: '249.50' },
  { name: 'amount_paid', description: 'Paid so far (formatted)', sample: '0.00' },
  { name: 'due_date', description: 'Due date (locale string)', sample: 'June 14, 2026' },
  { name: 'issue_date', description: 'Issue date (locale string)', sample: 'May 28, 2026' },
  { name: 'currency', description: 'Invoice currency', sample: 'CAD' },
  { name: 'sent_by_email', description: 'Admin who sent the email', sample: 'admin@aminocan.com' },
  { name: 'company_name', description: 'Company name', sample: 'PuraMass' },
];

export type InvoiceMergeVars = Record<string, string>;

interface BuildVarsInput {
  invoice: Invoice;
  amountPaid: number;
  amountDue: number;
  customerName: string;
  customerEmail: string;
  sentByEmail: string;
  currency?: string;
  companyName?: string;
}

export function buildInvoiceMergeVars({
  invoice,
  amountPaid,
  amountDue,
  customerName,
  customerEmail,
  sentByEmail,
  currency = 'CAD',
  companyName = 'PuraMass',
}: BuildVarsInput): InvoiceMergeVars {
  const [first, ...rest] = customerName.split(' ').filter(Boolean);
  return {
    customer_name: customerName,
    customer_first_name: first ?? customerName,
    customer_last_name: rest.join(' '),
    customer_email: customerEmail,
    invoice_number: invoice.invoice_number,
    invoice_total: Number(invoice.total).toFixed(2),
    amount_due: amountDue.toFixed(2),
    amount_paid: amountPaid.toFixed(2),
    due_date: new Date(invoice.due_date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    issue_date: new Date(invoice.issue_date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    currency,
    sent_by_email: sentByEmail,
    company_name: companyName,
  };
}

export function renderTemplate(tpl: string, vars: InvoiceMergeVars): string {
  return tpl.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, key) =>
    vars[key as keyof InvoiceMergeVars] ?? `{{${key}}}`,
  );
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function plainTextToHtml(body: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.55; color: #1A1A1A; white-space: pre-wrap;">${escapeHtml(
    body,
  )}</div>`;
}
