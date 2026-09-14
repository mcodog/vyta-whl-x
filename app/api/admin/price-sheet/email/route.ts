import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { buildPriceSheetData, type PriceSheetKind } from '@/lib/admin/price-sheet';
import { renderPriceSheetPdf, priceSheetFileName } from '@/lib/admin/price-sheet-pdf';
import { plainTextToHtml } from '@/lib/invoice-email-templates';

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
    .maybeSingle();
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a comma / semicolon / newline separated list into unique valid emails. */
function parseRecipients(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,;\n]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const e = String(item).trim();
    if (!e || !EMAIL_RE.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// POST /api/admin/price-sheet/email
// Body: { type, id, inventory, to, cc, subject, body }
// Regenerates the price-list PDF server-side (never trusting a client blob) and
// emails it as an attachment to the given recipients.
export async function POST(request: NextRequest) {
  const auth = await getAuth(request);
  if (!auth || !canEdit(auth.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawType = body.type;
  const kind: PriceSheetKind =
    rawType === 'salesperson' || rawType === 'sales_person' ? 'salesperson' : 'customer';
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const includeInventory = body.inventory === true || body.inventory === '1' || body.inventory === 1;

  const to = parseRecipients(body.to);
  const cc = parseRecipients(body.cc);
  if (to.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one valid recipient in the To field.' },
      { status: 400 },
    );
  }

  const subject = (typeof body.subject === 'string' && body.subject.trim()) || 'Your PuraMass price list';
  const text = typeof body.body === 'string' && body.body.trim()
    ? body.body
    : 'Please find your current price list attached as a PDF.';

  const data = await buildPriceSheetData(supabase, { kind, id, includeInventory });
  if (data === null) {
    return NextResponse.json(
      { error: kind === 'customer' ? 'Customer not found' : 'Sales person not found' },
      { status: 404 },
    );
  }

  let pdf: Buffer;
  try {
    pdf = await renderPriceSheetPdf(data);
  } catch (e) {
    console.error('Price-sheet PDF render failed:', e);
    return NextResponse.json(
      { error: `Failed to generate the price list PDF: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  const attachment = {
    filename: priceSheetFileName(data),
    content: pdf,
    contentType: 'application/pdf',
  };

  const transport = buildTransport();
  const from = buildFrom();
  const entityType = kind === 'customer' ? 'customer' : 'sales_person';

  let messageId: string | null = null;
  let success = false;
  let errorMessage: string | null = null;
  try {
    const info = await transport.sendMail({
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      text,
      html: plainTextToHtml(text),
      attachments: [attachment],
    });
    messageId = info.messageId ?? null;
    success = true;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Send failed';
    console.error('Price-sheet email send failed:', e);
  }

  // Record every attempt (success or failure) so each entity keeps a full
  // send history: when, who, and the exact config used.
  await supabase.from('price_sheet_email_log').insert({
    entity_type: entityType,
    entity_id: id,
    sent_by: auth.userId,
    sent_by_email: auth.email,
    to_emails: to,
    cc_emails: cc,
    include_inventory: includeInventory,
    currency: data.currency,
    product_count: data.rows.length,
    subject,
    message_id: messageId,
    success,
    error: errorMessage,
  });

  if (success) {
    await logAuditServer(supabase, {
      actor_id: auth.userId,
      action: 'price_sheet.emailed',
      entity_type: entityType,
      entity_id: id,
      payload: {
        to,
        cc,
        include_inventory: includeInventory,
        sent_by_email: auth.email,
      },
    });
  }

  if (!success) {
    return NextResponse.json({ error: errorMessage || 'Send failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    to,
    cc_count: cc.length,
    message_id: messageId,
  });
}

// GET /api/admin/price-sheet/email?type=customer|salesperson&id=<uuid>
// Returns the send history for one entity's price list, newest first.
export async function GET(request: NextRequest) {
  const auth = await getAuth(request);
  if (!auth || (auth.role !== 'admin' && auth.role !== 'assistant')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const rawType = sp.get('type');
  const entityType = rawType === 'salesperson' || rawType === 'sales_person' ? 'sales_person' : 'customer';
  const id = (sp.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: rows, error } = await supabase
    .from('price_sheet_email_log')
    .select(
      'id, sent_by_email, to_emails, cc_emails, include_inventory, currency, product_count, subject, success, error, created_at',
    )
    .eq('entity_type', entityType)
    .eq('entity_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    // The table may not exist yet (migration not run) — treat as empty history
    // rather than failing the modal.
    console.error('Price-sheet email history load failed:', error);
    return NextResponse.json({ history: [] });
  }

  return NextResponse.json({ history: rows ?? [] });
}
