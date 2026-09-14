import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { isPuramassPriceRejection, PuramassApiError } from '@/lib/payments/puramass';
import {
  createInvoiceCardHandOff,
  loadPendingInvoiceHandOff,
  supersedePendingInvoiceHandOffs,
} from '@/lib/payments/invoice-checkout';
import {
  checkoutShippingTotalCents,
  invoiceIsPayable,
  logInvoicePaymentEvent,
  PAYMENT_EMAIL_RE,
  readPaymentPageSettings,
  resolveInvoicePuramassLines,
  toPayableInvoice,
  UNMAPPED_LINE_REASON_LABELS,
  assessInvoiceSkuLock,
  skuLockAdminMessage,
} from '@/lib/payments/invoice-payment';

/**
 * `/api/admin/invoices/:id/checkout-link`
 *
 * The Stealth Health (PuraMass) checkout link, from the admin side.
 *
 * POST — mint a NEW hosted-checkout link for this invoice and supersede the
 *        pending one, so the payment page and the admin panel both hand out the
 *        new link from here on.
 *
 * Why this exists: a hand-off sits at `payment_pending` until the customer pays
 * it, and the PuraMass order behind it is immutable. When it goes stale — the
 * customer lost the link, the checkout timed out on their end, the invoice was
 * corrected — the admin needs a fresh one without waiting for the customer to
 * re-open the payment page.
 *
 * The superseded order is NOT cancelled at PuraMass: the partner API has no
 * cancel, so the old link may still be payable there until it expires. That is
 * safe — the webhook correlates on `transaction_id`, so if the old link is paid
 * the money still lands on this invoice.
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

const INVOICE_SELECT = '*, payments (amount), customer:customers!customer_id (email)';

/** Why this invoice can't be paid, phrased for the admin. */
function notPayableReason(payable: ReturnType<typeof toPayableInvoice>): string {
  if (payable.status === 'paid') return 'This invoice is already paid.';
  if (payable.status === 'cancelled') return 'This invoice is cancelled.';
  if (payable.non_payable) return 'This invoice is marked non-payable.';
  return 'This invoice has nothing outstanding.';
}

/**
 * Everything that has to hold before a card hand-off can be created — the
 * invoice, the address, the SKU mapping — resolved in one pass so a refusal can
 * name the one thing the admin has to fix.
 */
async function assessCheckoutLink(id: string) {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .single();
  if (error || !inv) return { notFound: true as const };

  const payable = toPayableInvoice(inv as Record<string, any>);
  const email = (payable.customer_email || (inv as any).customer?.email || '').trim();
  const settings = await readPaymentPageSettings(supabase);

  // The SKU lock outranks everything else here: it is the one problem the
  // admin cannot fix from this screen, so it is the one they should be told
  // about first.
  const skuLock = await assessInvoiceSkuLock(supabase, id);

  let blocked: { status: number; message: string } | null = null;
  if (skuLock.locked) {
    blocked = { status: 423, message: skuLockAdminMessage(skuLock.products) };
  } else if (!invoiceIsPayable(payable)) {
    blocked = { status: 422, message: notPayableReason(payable) };
  } else if (!settings.cardEnabled) {
    blocked = {
      status: 503,
      message: `Card payment is turned off, so no checkout link can be created. ${
        settings.cardUnavailableReason ?? ''
      }`.trim(),
    };
  } else if (!email || !PAYMENT_EMAIL_RE.test(email)) {
    blocked = {
      status: 409,
      message: email
        ? `“${email}” is not a valid email address. Stealth Health will not take the order without a valid one.`
        : 'This invoice has no customer email. Stealth Health needs one to take a card payment.',
    };
  }

  // Only worth resolving lines once the cheap checks pass — it is two queries.
  let lines: { sku: string; quantity: number; unit_price_cents: number }[] = [];
  let unmappedDetails: { label: string; reason: string; field: string }[] = [];
  if (!blocked) {
    const resolution = await resolveInvoicePuramassLines(supabase, id);
    lines = resolution.lines;
    unmappedDetails = resolution.unmappedDetails;
    if (!lines.length || unmappedDetails.length) {
      const labels = unmappedDetails
        .map(
          (u) =>
            `${u.label} (${
              UNMAPPED_LINE_REASON_LABELS[u.reason as keyof typeof UNMAPPED_LINE_REASON_LABELS] ??
              u.reason
            })`,
        )
        .join(', ');
      blocked = {
        status: 409,
        message: labels
          ? `These items have no Stealth Health SKU, so a card checkout cannot be created: ${labels}.`
          : 'No item on this invoice maps to a Stealth Health SKU, so a card checkout cannot be created.',
      };
    }
  }

  return {
    notFound: false as const,
    invoice: inv as Record<string, any>,
    payable,
    email,
    lines,
    unmapped: unmappedDetails,
    skuLock,
    // `0` unless this invoice ticked "charge shipping on the payment link" —
    // shipping is usually settled elsewhere, and 0 is also what switches off
    // PuraMass's own default rate.
    shippingTotalCents: checkoutShippingTotalCents(inv as Record<string, any>),
    blocked,
  };
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

  const state = await assessCheckoutLink(id);
  if (state.notFound) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (state.blocked) {
    return NextResponse.json(
      { error: state.blocked.message, unmapped: state.unmapped, sku_lock: state.skuLock },
      { status: state.blocked.status },
    );
  }

  // Read the hand-off we are about to replace *before* creating the new one, so
  // the timeline and the audit row can name it even though it is only retired
  // afterwards.
  const replacing = await loadPendingInvoiceHandOff(supabase, id);

  let handOff;
  try {
    handOff = await createInvoiceCardHandOff(supabase, {
      invoiceId: id,
      customerId: state.payable.customer_id,
      customerEmail: state.email,
      customerName: state.payable.customer_name,
      lines: state.lines,
      shippingTotalCents: state.shippingTotalCents,
    });
  } catch (err) {
    // Unlike the customer-facing route, an admin gets the real reason —
    // including the wholesale floor a rejected price names, which is what they
    // need to fix the invoice.
    const detail = err instanceof PuramassApiError ? err.message : String(err);
    console.error('Admin invoice checkout link error:', err);
    await logInvoicePaymentEvent(supabase, id, 'failed', {
      method: 'card',
      detail: {
        stage: 'admin_checkout_link',
        by: auth.email,
        error: detail,
        ...(isPuramassPriceRejection(err)
          ? { code: (err as PuramassApiError).code ?? null }
          : {}),
      },
    });
    return NextResponse.json(
      {
        error:
          err instanceof PuramassApiError
            ? detail || 'Stealth Health could not create the checkout.'
            : 'Stealth Health could not create the checkout. Please try again.',
      },
      { status: err instanceof PuramassApiError && isPuramassPriceRejection(err) ? 409 : 502 },
    );
  }

  // The new link is the one to hand out from here on. The old PuraMass order is
  // left alone (there is no cancel) — this only stops us pointing at it.
  const superseded = await supersedePendingInvoiceHandOffs(supabase, id, {
    exceptId: handOff.ledgerId ?? undefined,
  });

  // The customer's method is settled by the admin choosing the card link for
  // them — the payment page reflects that when they open it.
  await supabase
    .from('invoices')
    .update({
      payment_method_selected: 'card',
      payment_method_selected_at: new Date().toISOString(),
    })
    .eq('id', id);

  const supersededTxns = superseded
    .map((h) => h.transaction_id)
    .filter((v): v is string => Boolean(v));

  await logInvoicePaymentEvent(supabase, id, 'checkout_created', {
    method: 'card',
    detail: {
      by: auth.email,
      source: 'admin',
      transaction_id: handOff.transactionId,
      payment_link: handOff.paymentLink,
      subtotal_cents: handOff.subtotalCents,
      shipping_total_cents: state.shippingTotalCents,
      items: state.lines,
      ...(supersededTxns.length ? { superseded_transaction_ids: supersededTxns } : {}),
    },
  });
  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: 'invoice.payment_checkout_link_created',
    entity_type: 'invoice',
    entity_id: id,
    payload: {
      transaction_id: handOff.transactionId,
      replaced_transaction_id: replacing?.transaction_id ?? null,
      superseded_count: superseded.length,
    },
  });

  return NextResponse.json({
    ok: true,
    payment_link: handOff.paymentLink,
    transaction_id: handOff.transactionId,
    superseded: superseded.length,
    replaced_transaction_id: replacing?.transaction_id ?? null,
    // The link is live either way, but without its ledger row the webhook
    // cannot tie the payment back to this invoice — say so rather than let it
    // be discovered at reconciliation time.
    ledger_error: handOff.ledgerError,
  });
}
