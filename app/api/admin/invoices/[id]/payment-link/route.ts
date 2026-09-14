import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { paymentPageUrl } from '@/lib/payment-email-templates';
import {
  assessPaymentRequestReadiness,
  ensureInvoicePaymentToken,
  invoiceIsPayable,
  logInvoicePaymentEvent,
  toPayableInvoice,
} from '@/lib/payments/invoice-payment';

/**
 * `/api/admin/invoices/:id/payment-link`
 *
 * GET  — pre-flight only. Reports whether a payment request for this invoice is
 *        fit to send (see `assessPaymentRequestReadiness`) so the admin panel
 *        can warn *before* the link goes out, plus the existing token if one has
 *        already been minted. Mints nothing and logs nothing.
 *
 * POST — mint (or return) the invoice's payment-page link **without emailing
 *        anything** — for an admin who'd rather paste the link into a chat, a
 *        text, or their own message than have us send it.
 *
 * Shares the token with the payment-request email: whichever comes first mints
 * it, and both hand out the same URL, so a link copied here and an email sent
 * later point at the same page.
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

/** Why this invoice can't be paid, phrased for the admin. */
function notPayableReason(payable: ReturnType<typeof toPayableInvoice>): string {
  if (payable.status === 'paid') return 'This invoice is already paid.';
  if (payable.status === 'cancelled') return 'This invoice is cancelled.';
  if (payable.non_payable) return 'This invoice is marked non-payable.';
  return 'This invoice has nothing outstanding.';
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await getAuth(request);
  if (!auth || !canEdit(auth.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*, payments (amount), customer:customers!customer_id (email)')
    .eq('id', id)
    .single();
  if (error || !inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const payable = toPayableInvoice(inv as Record<string, any>);
  // The invoice's own column wins, but a customer record's address is a fine
  // default — it is what the panel pre-fills the recipient box with.
  const fallbackEmail = payable.customer_email || (inv as any).customer?.email || null;
  const readiness = await assessPaymentRequestReadiness(
    supabase,
    { id, customer_email: fallbackEmail },
    { recipient: request.nextUrl.searchParams.get('to') },
  );

  return NextResponse.json({
    ok: true,
    payable: invoiceIsPayable(payable),
    not_payable_reason: invoiceIsPayable(payable) ? null : notPayableReason(payable),
    token: payable.payment_token,
    payment_url: payable.payment_token ? paymentPageUrl(payable.payment_token) : null,
    suggested_email: fallbackEmail,
    ...readiness,
  });
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
  const suppliedEmail: string | undefined =
    typeof body.customer_email === 'string' ? body.customer_email.trim() : undefined;
  const acknowledgeWarnings = body.acknowledge_warnings === true;

  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*, payments (amount), customer:customers!customer_id (email)')
    .eq('id', id)
    .single();
  if (error || !inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const payable = toPayableInvoice(inv as Record<string, any>);
  if (!invoiceIsPayable(payable)) {
    return NextResponse.json({ error: notPayableReason(payable) }, { status: 422 });
  }

  const fallbackEmail = payable.customer_email || (inv as any).customer?.email || null;
  const readiness = await assessPaymentRequestReadiness(
    supabase,
    { id, customer_email: fallbackEmail },
    { recipient: suppliedEmail },
  );

  // Hard stops: the SKU lock (a line whose own SKU column is empty — only
  // a developer can fix it) and a missing address (the card hand-off needs one,
  // and no customer action can supply it).
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

  // Soft stop: unmapped SKUs only hide the card option, so the admin gets to
  // decide. The panel re-posts with `acknowledge_warnings` to proceed.
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

  // Persist the address so the payment page's card hand-off can use it. Only
  // fills a gap — never overwrites an email already on the invoice.
  if (!payable.customer_email && readiness.customerEmail) {
    await supabase
      .from('invoices')
      .update({ customer_email: readiness.customerEmail })
      .eq('id', id);
  }

  const alreadyExisted = Boolean(payable.payment_token);
  let token: string;
  try {
    token = await ensureInvoicePaymentToken(supabase, payable);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not create a payment link' },
      { status: 500 },
    );
  }

  // Only worth a timeline entry the first time — after that the link already
  // exists and this is just reading it back.
  if (!alreadyExisted) {
    await logInvoicePaymentEvent(supabase, id, 'link_created', {
      detail: {
        by: auth.email,
        ...(readiness.warnings.length
          ? { acknowledged_warnings: readiness.warnings.map((w) => w.code) }
          : {}),
      },
    });
    await logAuditServer(supabase, {
      actor_id: auth.userId,
      action: 'invoice.payment_link_created',
      entity_type: 'invoice',
      entity_id: id,
      payload: {
        ...(readiness.warnings.length
          ? { acknowledged_warnings: readiness.warnings.map((w) => w.code) }
          : {}),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    token,
    payment_url: paymentPageUrl(token),
    created: !alreadyExisted,
    warnings: readiness.warnings,
    unmapped: readiness.unmapped,
    card_available: readiness.cardAvailable,
  });
}
