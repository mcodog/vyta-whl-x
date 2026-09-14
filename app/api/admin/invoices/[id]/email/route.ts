import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import { loadInvoiceRosters } from '@/lib/admin/sales-attribution';
import {
  DEFAULT_ADMIN_BODY,
  DEFAULT_ADMIN_SUBJECT,
  DEFAULT_CUSTOMER_BODY,
  DEFAULT_CUSTOMER_SUBJECT,
  buildInvoiceMergeVars,
  plainTextToHtml,
  renderTemplate,
} from '@/lib/invoice-email-templates';

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
    .select('role, email, first_name, last_name')
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
  const name = process.env.SMTP_FROM_NAME || 'PuraMass';
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

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select(`
      *,
      customer:customers!customer_id (*),
      client:customer_clients!client_id (*),
      sales_person:sales_persons (*),
      line_items:invoice_line_items (*, product:products (sku)),
      payments (*)
    `)
    .eq('id', id)
    .single();
  if (invErr || !inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const customerEmail =
    recipientOverride?.trim() ||
    inv.customer_email ||
    inv.customer?.email ||
    '';
  if (!customerEmail) {
    return NextResponse.json(
      { error: 'No customer email on invoice. Provide a recipient.' },
      { status: 400 },
    );
  }

  const { data: settings } = await supabase
    .from('site_settings')
    .select(
      'invoice_cc_emails, invoice_customer_email_subject, invoice_customer_email_body, invoice_admin_email_subject, invoice_admin_email_body',
    )
    .single();

  // Caller-supplied bcc wins (the modal sends the user's checkbox selection
  // plus any one-off additions). When the client omits `bcc` entirely we fall
  // back to the configured CC list so other callers / older clients still work.
  const bccList: string[] =
    bccOverride !== undefined
      ? bccOverride
      : Array.isArray(settings?.invoice_cc_emails)
        ? settings.invoice_cc_emails.filter(
            (e: unknown): e is string => typeof e === 'string' && e.trim().length > 0,
          )
        : [];

  const amount_paid = (inv.payments ?? []).reduce(
    (s: number, p: { amount: number }) => s + Number(p.amount),
    0,
  );
  const amount_due = Math.max(0, Number(inv.total) - amount_paid);
  const customerName =
    inv.customer_name ||
    (inv.customer
      ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(' ')
      : 'Customer');

  const vars = buildInvoiceMergeVars({
    invoice: inv,
    amountPaid: amount_paid,
    amountDue: amount_due,
    customerName,
    customerEmail,
    sentByEmail: auth.email,
    // Use the invoice's own currency so USD invoices don't render as CAD.
    currency: inv.currency === 'USD' ? 'USD' : 'CAD',
  });

  const customerSubject = renderTemplate(
    settings?.invoice_customer_email_subject || DEFAULT_CUSTOMER_SUBJECT,
    vars,
  );
  const customerBody = renderTemplate(
    settings?.invoice_customer_email_body || DEFAULT_CUSTOMER_BODY,
    vars,
  );
  const adminSubject = renderTemplate(
    settings?.invoice_admin_email_subject || DEFAULT_ADMIN_SUBJECT,
    vars,
  );
  const adminBody = renderTemplate(
    settings?.invoice_admin_email_body || DEFAULT_ADMIN_BODY,
    vars,
  );

  let pdf: Buffer;
  try {
    // The roster is fetched separately (never embedded) so a database that
    // hasn't run the migration still renders the PDF off the primary.
    const rosters = await loadInvoiceRosters(supabase, [id]);
    pdf = await renderInvoicePdf({ ...inv, sales_people: rosters.get(id) ?? [] });
  } catch (e) {
    console.error('PDF render failed:', e);
    return NextResponse.json(
      {
        error: `Failed to generate invoice PDF: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 500 },
    );
  }

  const attachment = {
    filename: `${inv.invoice_number}.pdf`,
    content: pdf,
    contentType: 'application/pdf',
  };

  const transport = buildTransport();
  const from = buildFrom();

  let messageId: string | null = null;
  let success = false;
  let errorMessage: string | null = null;

  try {
    const info = await transport.sendMail({
      from,
      to: customerEmail,
      subject: customerSubject,
      text: customerBody,
      html: plainTextToHtml(customerBody),
      attachments: [attachment],
    });
    messageId = info.messageId ?? null;
    success = true;

    if (bccList.length > 0) {
      try {
        await transport.sendMail({
          from,
          to: bccList,
          subject: adminSubject,
          text: adminBody,
          html: plainTextToHtml(adminBody),
          attachments: [attachment],
        });
      } catch (e) {
        console.error('Admin copy send failed:', e);
      }
    }
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : 'Send failed';
    console.error('Customer invoice send failed:', e);
  }

  await supabase.from('invoice_email_log').insert({
    invoice_id: id,
    sent_by: auth.userId,
    sent_by_email: auth.email,
    to_email: customerEmail,
    bcc_emails: bccList,
    subject: customerSubject,
    message_id: messageId,
    success,
    error: errorMessage,
  });

  if (success) {
    await supabase
      .from('invoices')
      .update({
        last_emailed_at: new Date().toISOString(),
        last_emailed_by: auth.userId,
        last_emailed_by_email: auth.email,
        status: inv.status === 'draft' ? 'sent' : inv.status,
      })
      .eq('id', id);

    await logAuditServer(supabase, {
      actor_id: auth.userId,
      action: 'invoice.email_sent',
      entity_type: 'invoice',
      entity_id: id,
      payload: { to: customerEmail, bcc_count: bccList.length },
    });
  }

  if (!success) {
    return NextResponse.json(
      { error: errorMessage || 'Send failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    to: customerEmail,
    bcc_count: bccList.length,
    message_id: messageId,
  });
}
