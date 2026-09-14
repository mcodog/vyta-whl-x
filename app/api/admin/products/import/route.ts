import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canCreate } from '@/lib/permissions';
import { recordProductChanges } from '@/lib/admin/product-history';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';
import * as XLSX from 'xlsx';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

interface ParsedRow {
  slug: string;
  name: string;
  strength: string | null;
  price: number;
  description_short: string | null;
}

async function verifyAdminRole(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return { authorized: false, role: 'customer' as const, userId: null };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, role: 'customer' as const, userId: null };
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = customer?.role || 'customer';

    return { authorized: canCreate(role), role, userId: user.id };
  } catch (error) {
    console.error('Error verifying admin role:', error);
    return { authorized: false, role: 'customer' as const, userId: null };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseDollar(raw: string): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

function parseCSVBuffer(buffer: Buffer): { rows: ParsedRow[]; skippedRows: number } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

  const rows: ParsedRow[] = [];
  let skippedRows = 0;

  for (const row of rawRows) {
    const code = row['Code'] ?? '';
    const slug = slugify(code) || code.toLowerCase();
    if (!slug) {
      skippedRows++;
      continue;
    }

    const wholesale = parseDollar(row['Wholesale Price']);
    const cad = parseDollar(row['CAD Price']);
    const price = cad ?? wholesale ?? 0;

    const priceParts: string[] = [];
    if (wholesale !== null) priceParts.push(`Wholesale: $${wholesale.toFixed(2)}`);
    if (cad !== null) priceParts.push(`CAD: $${cad.toFixed(2)}`);

    rows.push({
      slug,
      name: row['Product Name'] ?? '',
      strength: row['MG'] || null,
      price,
      description_short: priceParts.length > 0 ? priceParts.join(' | ') : null,
    });
  }

  return { rows, skippedRows };
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/csv'];

// POST: Upload CSV, parse, and return preview (new vs update split)
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type) && !file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a CSV file.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 5MB limit' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to product-imports bucket for audit trail
    const rand = Math.random().toString(36).substring(7);
    const fileName = `imports/${Date.now()}-${rand}.csv`;

    const { data: storageData, error: storageError } = await supabase.storage
      .from('product-imports')
      .upload(fileName, buffer, {
        contentType: 'text/csv',
        upsert: false,
      });

    if (storageError) {
      console.error('Storage upload error:', storageError);
      if (storageError.message.includes('Bucket not found')) {
        return NextResponse.json(
          { error: 'Storage bucket "product-imports" does not exist. Please create it in Supabase Storage.' },
          { status: 500 }
        );
      }
      if (storageError.message.includes('row-level security') || storageError.message.includes('RLS')) {
        return NextResponse.json(
          { error: 'Storage bucket permissions not configured for "product-imports".' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }

    // Parse CSV
    let rows: ParsedRow[];
    let skippedRows: number;
    try {
      ({ rows, skippedRows } = parseCSVBuffer(buffer));
    } catch (parseError) {
      console.error('CSV parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid CSV file: could not parse. Ensure columns: Code, Product Name, MG, Wholesale Price, CAD Price.' },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'CSV contains no valid rows. Ensure it has a "Code" column with values.' },
        { status: 400 }
      );
    }

    // Query existing products by slug
    const slugs = rows.map((r) => r.slug);
    const { data: existingProducts, error: queryError } = await supabase
      .from('products')
      .select('slug, name, price, strength')
      .in('slug', slugs);

    if (queryError) {
      console.error('DB query error:', queryError);
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    const existingSlugSet = new Set((existingProducts ?? []).map((p: { slug: string }) => p.slug));

    const newProducts = rows.filter((r) => !existingSlugSet.has(r.slug));
    const updateProducts = rows.filter((r) => existingSlugSet.has(r.slug));

    return NextResponse.json({
      csvPath: storageData.path,
      newProducts,
      updateProducts,
      skippedRows,
    });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'products',
      route: '/api/admin/products/import',
      method: 'POST',
      error,
      actor_id: userId,
    });
    console.error('Unexpected error in import POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT: Commit upsert after user confirms preview
export async function PUT(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { newProducts, updateProducts } = body as {
      newProducts: ParsedRow[];
      updateProducts: ParsedRow[];
      csvPath: string;
    };

    if (!Array.isArray(newProducts) || !Array.isArray(updateProducts)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const total = newProducts.length + updateProducts.length;
    if (total === 0) {
      return NextResponse.json({ error: 'No products to import' }, { status: 400 });
    }
    if (total > 500) {
      return NextResponse.json({ error: 'Too many rows. Maximum 500 products per import.' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // New products get full defaults
    const newRecords = newProducts.map((row) => ({
      slug: row.slug,
      name: row.name,
      strength: row.strength,
      price: row.price,
      description_short: row.description_short,
      stock_quantity: 0,
      featured: false,
      active: row.price > 0,
      description: null,
      category: null,
      image_url: null,
      purity: null,
      form: null,
      benefits: null,
      mechanism: null,
      coa_url: [],
      updated_at: now,
    }));

    // Update products only include CSV-sourced fields to avoid nulling existing DB values
    const updateRecords = updateProducts.map((row) => ({
      slug: row.slug,
      name: row.name,
      strength: row.strength,
      price: row.price,
      description_short: row.description_short,
      updated_at: now,
    }));

    const allRecords = [...newRecords, ...updateRecords];

    // Capture pre-import prices for the slugs we're about to update, so we can
    // log only genuine price changes to the history timeline.
    const updateSlugs = updateProducts.map((r) => r.slug);
    const priceBySlugBefore = new Map<string, number>();
    if (updateSlugs.length > 0) {
      const { data: before } = await supabase
        .from('products')
        .select('slug, price')
        .in('slug', updateSlugs);
      for (const p of before ?? []) priceBySlugBefore.set(p.slug, Number(p.price));
    }

    const { data: upserted, error: upsertError } = await supabase
      .from('products')
      .upsert(allRecords, { onConflict: 'slug', ignoreDuplicates: false })
      .select('id, slug');

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Record price history for the import. New products get a 'create' baseline
    // (price + stock 0); updated products log a price change only when it moved.
    // Best-effort — never fail the import over a history write.
    const idBySlug = new Map<string, string>();
    for (const row of upserted ?? []) idBySlug.set(row.slug, row.id);
    const newSlugs = new Set(newProducts.map((r) => r.slug));

    await Promise.all(
      (allRecords as Array<{ slug: string; price: number }>).map((rec) => {
        const productId = idBySlug.get(rec.slug);
        if (!productId) return Promise.resolve();
        if (newSlugs.has(rec.slug)) {
          return recordProductChanges(supabase, {
            productId,
            actorId: userId,
            source: 'create',
            after: { price: rec.price, stock_quantity: 0 },
          });
        }
        return recordProductChanges(supabase, {
          productId,
          actorId: userId,
          source: 'import',
          before: { price: priceBySlugBefore.get(rec.slug) },
          after: { price: rec.price },
        });
      }),
    );

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'product.import',
      entity_type: 'product',
      entity_id: null,
      payload: { count: total },
    });

    return NextResponse.json({
      inserted: newProducts.length,
      updated: updateProducts.length,
    });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'products',
      route: '/api/admin/products/import',
      method: 'PUT',
      error,
      actor_id: userId,
    });
    console.error('Unexpected error in import PUT:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
