import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import {
  buildInvoiceMergeVars,
  renderTemplate,
} from '@/lib/invoice-email-templates';
import {
  DEFAULT_PAYMENT_BODY,
  DEFAULT_PAYMENT_SUBJECT,
  paymentEmailHtml,
  paymentPageUrl,
} from '@/lib/payment-email-templates';
import {
  assessPaymentRequestReadiness,
  ensureInvoicePaymentToken,
  logInvoicePaymentEvent,
  toPayableInvoice,
  invoiceIsPayable,
} from '@/lib/payments/invoice-payment';

/**
 * POST /api/admin/invoices/:id/payment-email
 *
 * Send the customer a *payment request* — a link to the hosted payment page
 * (/pay/<token>) where they choose crypto or Visa/Mastercard and pay. This is
 * the second of the invoice's two customer emails: the existing
 * `…/email` endpoint (invoice PDF attached) is untouched and unrelated.
 *
 * Minting the token is idempotent: the first send creates it, resends reuse it,
 * so a link already sitting in the customer's inbox keeps working.
 *
 * Body: `{ to?: string, bcc?: string[], acknowledge_warnings?: boolean }` — `to`
 * defaults to the invoice's customer email and `bcc` to the configured invoice
 * copy list. `acknowledge_warnings` is the admin overriding the overridable
 * pre-flight warnings (see `assessPaymentRequestReadiness`); the blockers it
 * reports are never overridable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role, email')
    .eq('id', user.id)
    .single();
  return {
    userId: user.id,
    role: (customer?.role || 'customer') as 'customer' | 'assistant' | 'admin',
    email: customer?.email ?? user.email ?? '',
  };
}

function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.protonmail.ch',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

function buildFrom() {
  const name = process.env.SMTP_FROM_NAME || 'VYTA Biosciences';
  const addr = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'info@aminocan.com';
  return `${name} <${addr}>`;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await getAuth(request);
  if (!auth || !canEdit(auth.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  const recipientOverride: string | undefined = body.to;
  const bccOverride: string[] | undefined = Array.isArray(body.bcc)
    ? body.bcc.filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0)
    : undefined;
  const acknowledgeWarnings = body.acknowledge_warnings === true;

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('*, payments (amount), customer:customers!customer_id (first_name, last_name, email)')
    .eq('id', id)
    .single();
  if (invErr || !inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const payable = toPayableInvoice(inv as Record<string, any>);
  if (!invoiceIsPayable(payable)) {
    // Nothing to collect — sending a "please pay" link would be wrong.
    const why =
      payable.status === 'paid'
        ? 'This invoice is already paid.'
        : payable.status === 'cancelled'
          ? 'This invoice is cancelled.'
          : payable.non_payable
            ? 'This invoice is marked non-payable.'
            : 'This invoice has nothing outstanding.';
    return NextResponse.json({ error: why }, { status: 422 });
  }

  // Pre-flight. A payment request that lands the customer on a page they can't
  // pay from is worse than not sending one, so check first: a missing address is
  // fatal (the card hand-off needs it), unmapped SKUs are the admin's call.
  const fallbackEmail = inv.customer_email || (inv as any).customer?.email || null;
  const readiness = await assessPaymentRequestReadiness(
    supabase,
    { id, customer_email: fallbackEmail },
    { recipient: recipientOverride },
  );
  if (readiness.blockers.length) {
    return NextResponse.json(
      {
        error: readiness.blockers[0].message,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        unmapped: readiness.unmapped,
        sku_lock: readiness.skuLock,
      },
      { status: 422 },
    );
  }
  if (readiness.warnings.length && !acknowledgeWarnings) {
    return NextResponse.json(
      {
        error: readiness.warnings[0].message,
        requires_acknowledgement: true,
        warnings: readiness.warnings,
        unmapped: readiness.unmapped,
      },
      { status: 409 },
    );
  }
  // Non-null: a readiness run with no blockers always resolved an address.
  const customerEmail = readiness.customerEmail!;

  const { data: settings } = await supabase
    .from('site_settings')
    .select('invoice_cc_emails, payment_email_subject, payment_email_body')
    .single();

  const bccList: string[] =
    bccOverride !== undefined
      ? bccOverride
      : Array.isArray(settings?.invoice_cc_emails)
        ? settings.invoice_cc_emails.filter(
            (e: unknown): e is string => typeof e === 'string' && e.trim().length > 0,
          )
        : [];

  // Mint (or reuse) the public token, then build the link the email is all about.
  let token: string;
  try {
    token = await ensureInvoicePaymentToken(supabase, payable);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not create a payment link' },
      { status: 500 },
    );
  }
  const paymentUrl = paymentPageUrl(token);

  const customerName =
    inv.customer_name ||
    ((inv as any).customer
      ? [(inv as any).customer.first_name, (inv as any).customer.last_name]
          .filter(Boolean)
          .join(' ')
      : '') ||
    'Customer';

  const vars = {
    ...buildInvoiceMergeVars({
      invoice: inv as any,
      amountPaid: payable.amount_paid,
      amountDue: payable.amount_due,
      customerName,
      customerEmail,
      sentByEmail: auth.email,
      currency: payable.currency,
    }),
    payment_url: paymentUrl,
  };

  const subject = renderTemplate(
    settings?.payment_email_subject || DEFAULT_PAYMENT_SUBJECT,
    vars,
  );
  let text = renderTemplate(settings?.payment_email_body || DEFAULT_PAYMENT_BODY, vars);
  // A template that dropped {{payment_url}} would email the customer no way to
  // pay. Append the link rather than sending a dead end.
  if (!text.includes(paymentUrl)) {
    text = `${text.trimEnd()}\n\n${paymentUrl}`;
  }

  const transport = buildTransport();
  const from = buildFrom();

  let messageId: string | null = null;
  let success = false;
  let errorMessage: string | null = null;

  try {
    const info = await transport.sendMail({
      from,
      to: customerEmail,
      // Replies about payment should reach a human, same as the invoice email.
      subject,
      text,
      html: paymentEmailHtml(text, paymentUrl),
      ...(bccList.length > 0 ? { bcc: bccList } : {}),
    });
    messageId = info.messageId ?? null;
    success = true;
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : 'Send failed';
    console.error('Payment request send failed:', e);
  }

  await supabase.from('invoice_payment_email_log').insert({
    invoice_id: id,
    sent_by: auth.userId,
    sent_by_email: auth.email,
    to_email: customerEmail,
    bcc_emails: bccList,
    subject,
    payment_url: paymentUrl,
    message_id: messageId,
    success,
    error: errorMessage,
  });

  if (!success) {
    await logInvoicePaymentEvent(supabase, id, 'failed', {
      detail: { stage: 'email_send', to: customerEmail, error: errorMessage },
    });
    return NextResponse.json({ error: errorMessage || 'Send failed' }, { status: 500 });
  }

  await supabase
    .from('invoices')
    .update({
      payment_email_sent_at: new Date().toISOString(),
      payment_email_sent_by: auth.userId,
      payment_email_sent_by_email: auth.email,
      payment_email_to: customerEmail,
      payment_email_count: (Number(inv.payment_email_count) || 0) + 1,
      // Fill a missing address so the payment page's card hand-off has one to
      // give PuraMass. Never overwrites an email already on the invoice.
      ...(inv.customer_email ? {} : { customer_email: customerEmail }),
      // A draft invoice the customer has now been asked to pay is "sent".
      status: inv.status === 'draft' ? 'sent' : inv.status,
    })
    .eq('id', id);

  await logInvoicePaymentEvent(supabase, id, 'email_sent', {
    detail: {
      to: customerEmail,
      bcc_count: bccList.length,
      resend: Number(inv.payment_email_count) > 0,
      ...(readiness.warnings.length
        ? { acknowledged_warnings: readiness.warnings.map((w) => w.code) }
        : {}),
    },
  });

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: 'invoice.payment_email_sent',
    entity_type: 'invoice',
    entity_id: id,
    payload: {
      to: customerEmail,
      bcc_count: bccList.length,
      ...(readiness.warnings.length
        ? { acknowledged_warnings: readiness.warnings.map((w) => w.code) }
        : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    to: customerEmail,
    bcc_count: bccList.length,
    message_id: messageId,
    payment_url: paymentUrl,
    warnings: readiness.warnings,
    unmapped: readiness.unmapped,
    card_available: readiness.cardAvailable,
  });
}
