import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';
import { syncAffiliatePriceListFromOwnRecord } from '@/lib/admin/affiliate-pricelist-sync';
import { markCustomerDedicated } from '@/lib/admin/pricing-mode';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function getCaller(request: NextRequest): Promise<{ id: string; role: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return { id: user.id, role: customer?.role || 'customer' };
}

async function boundCustomerIds(affiliateId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('affiliate_id', affiliateId);
  return new Set((data ?? []).map((c) => c.id));
}

interface ProductRef {
  id: string;
  sku: string | null;
  name: string;
  price: number;
}

async function loadProducts(): Promise<ProductRef[]> {
  const { data } = await supabase
    .from('products')
    .select('id, sku, name, price')
    .order('name');
  return (data ?? []) as ProductRef[];
}

/**
 * GET /api/admin/price-overrides/import
 * Returns the product catalogue used to build a downloadable price-list
 * template (admins, assistants and affiliates).
 */
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role === 'customer') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const products = await loadProducts();
  return NextResponse.json({
    products: products.map((p) => ({
      product_id: p.id,
      sku: p.sku ?? '',
      name: p.name,
      current_price: p.price,
    })),
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pick the first present value among candidate header keys (case-insensitive).
function pick(row: Record<string, any>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase())) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

interface PreviewRow {
  row: number;
  name: string;
  sku: string;
  product_id: string | null;
  price: number | null;
  error: string | null;
}

/**
 * POST /api/admin/price-overrides/import  (multipart/form-data)
 * fields: file (CSV), customer_ids (JSON string[]), mode ('preview' | 'apply')
 *
 * Parses a price-list CSV, matches rows to products (by product_id, then sku,
 * then name), validates prices, and either returns a preview or applies the
 * prices as per-customer overrides for the selected customers.
 */
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || (caller.role !== 'admin' && caller.role !== 'affiliate')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 });
  }

  const file = form.get('file');
  const mode = (form.get('mode') as string) || 'preview';
  let customerIds: string[] = [];
  try {
    customerIds = JSON.parse((form.get('customer_ids') as string) || '[]');
  } catch {
    customerIds = [];
  }

  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No CSV file provided' }, { status: 400 });
  }

  // A client's price list always applies to ALL of their customers, so for
  // affiliates we ignore any passed selection and target every bound customer.
  if (caller.role === 'affiliate') {
    customerIds = Array.from(await boundCustomerIds(caller.id));
  }

  // Parse the file.
  let records: Record<string, any>[];
  try {
    const buf = await (file as Blob).arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    records = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  } catch {
    return NextResponse.json({ error: 'Could not read the file. Please upload a valid CSV.' }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: 'The file has no rows.' }, { status: 400 });
  }

  // Build lookup maps.
  const products = await loadProducts();
  const byId = new Map(products.map((p) => [p.id.toLowerCase(), p]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku!.trim().toLowerCase(), p]));
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));

  const preview: PreviewRow[] = [];
  const seen = new Set<string>();

  records.forEach((raw, i) => {
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    const idVal = pick(raw, ['product_id', 'id']);
    const sku = pick(raw, ['sku']);
    const name = pick(raw, ['name', 'product', 'product_name']);
    const priceVal = pick(raw, ['your_price', 'price', 'override_price', 'new_price']);

    // Match a product.
    let product: ProductRef | undefined;
    if (idVal && UUID_RE.test(idVal)) product = byId.get(idVal.toLowerCase());
    if (!product && sku) product = bySku.get(sku.toLowerCase());
    if (!product && name) product = byName.get(name.toLowerCase());

    let error: string | null = null;
    let price: number | null = null;

    if (!product) {
      error = 'No matching product (check product_id / sku / name)';
    } else if (priceVal === '') {
      error = 'Missing price';
    } else {
      const n = Number(priceVal.replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(n)) error = 'Price is not a number';
      else if (n <= 0) error = 'Price must be greater than 0';
      else price = Number(n.toFixed(2));
    }

    if (product && !error) {
      if (seen.has(product.id)) error = 'Duplicate product in file';
      else seen.add(product.id);
    }

    preview.push({
      row: rowNum,
      name: product?.name || name || '(unknown)',
      sku: product?.sku || sku || '',
      product_id: product?.id ?? null,
      price,
      error,
    });
  });

  const valid = preview.filter((r) => !r.error && r.product_id && r.price != null);
  const summary = { total: preview.length, valid: valid.length, errors: preview.length - valid.length };

  if (mode !== 'apply') {
    return NextResponse.json({ preview, summary, customerCount: customerIds.length });
  }

  // APPLY ------------------------------------------------------------------
  if (valid.length === 0) {
    return NextResponse.json({ error: 'No valid rows to apply' }, { status: 400 });
  }
  // Admins must pick at least one customer. Affiliates always target all of
  // their customers, so an empty list is fine — the prices are still saved to
  // the client's price list and applied to any future customers.
  if (caller.role !== 'affiliate' && customerIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one customer to apply prices to' }, { status: 400 });
  }

  // Persist the client's own price list so it can be applied to customers they
  // add later (copied in at customer-creation time).
  if (caller.role === 'affiliate') {
    const affiliateRows = valid.map((r) => ({
      affiliate_id: caller.id,
      product_id: r.product_id!,
      override_price: r.price!,
    }));
    const { error: affErr } = await supabase
      .from('affiliate_price_overrides')
      .upsert(affiliateRows, { onConflict: 'affiliate_id,product_id' });
    if (affErr) {
      console.error('Affiliate price list upsert failed:', affErr);
      await logErrorServer(supabase, {
        area: 'price-overrides',
        route: '/api/admin/price-overrides/import',
        method: 'POST',
        error: affErr,
        actor_id: caller.id,
      });
      return NextResponse.json({ error: affErr.message }, { status: 500 });
    }

    // Keep the affiliate's OWN record in sync with the list they just imported,
    // so invoices they create price from these same numbers. Their own record is
    // separate from their bound customers, so it must be upserted explicitly (it
    // is not in `customerIds`). See lib/admin/affiliate-pricelist-sync.ts.
    const ownRows = valid.map((r) => ({
      customer_id: caller.id,
      product_id: r.product_id!,
      override_price: r.price!,
    }));
    const { error: ownErr } = await supabase
      .from('customer_price_overrides')
      .upsert(ownRows, { onConflict: 'customer_id,product_id' });
    if (ownErr) {
      console.error('Affiliate own-record price sync failed:', ownErr);
      await logErrorServer(supabase, {
        area: 'price-overrides',
        route: '/api/admin/price-overrides/import',
        method: 'POST',
        error: ownErr,
        actor_id: caller.id,
      });
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }

    // The affiliate just hand-imported their own price list → dedicated.
    await markCustomerDedicated(supabase, caller.id);
  }

  if (customerIds.length > 0) {
    const overrides = customerIds.flatMap((customer_id) =>
      valid.map((r) => ({ customer_id, product_id: r.product_id!, override_price: r.price! })),
    );

    const { error: upsertError } = await supabase
      .from('customer_price_overrides')
      .upsert(overrides, { onConflict: 'customer_id,product_id' });

    if (upsertError) {
      console.error('Price import upsert failed:', upsertError);
      await logErrorServer(supabase, {
        area: 'price-overrides',
        route: '/api/admin/price-overrides/import',
        method: 'POST',
        error: upsertError,
        actor_id: caller.id,
      });
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // A CSV import is bespoke pricing with no shared source → mark every
    // targeted customer 'dedicated'.
    for (const cid of customerIds) {
      await markCustomerDedicated(supabase, cid);
    }

    // If an admin imported prices onto an affiliate's OWN record, mirror them to
    // that affiliate's price list so their bound customers see them too. No-op
    // for ordinary customers. (Affiliate-role imports already wrote both sides.)
    if (caller.role === 'admin') {
      for (const cid of customerIds) {
        await syncAffiliatePriceListFromOwnRecord(supabase, cid);
      }
    }
  }

  await logAuditServer(supabase, {
    actor_id: caller.id,
    action: 'price_override.import',
    entity_type: 'price_override',
    entity_id: null,
    payload: { count: valid.length },
  });

  return NextResponse.json({
    applied: customerIds.length * valid.length,
    products: valid.length,
    customers: customerIds.length,
    futureCustomers: caller.role === 'affiliate',
    summary,
  });
}
