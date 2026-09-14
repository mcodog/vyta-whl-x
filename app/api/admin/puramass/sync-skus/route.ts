import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canAccessAdmin } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import {
  isPuramassConfigured,
  fetchPuramassCatalog,
} from '@/lib/payments/puramass';
import {
  PURAMASS_CATALOG_SNAPSHOT,
  PURAMASS_VIAL_CATALOG_SNAPSHOT,
  matchProductToPuramass,
  type PuramassCatalogEntry,
} from '@/lib/payments/puramass-catalog';

/**
 * POST /api/admin/puramass/sync-skus
 *
 * Auto-fill BOTH PuraMass SKU mappings on each product:
 *  - `puramass_sku`      — the case SKU (`…-case`)
 *  - `puramass_sku_vial` — the single-vial SKU (`…-vial`)
 *
 * Matches each product (name + strength) against the PuraMass catalog, split by
 * SKU suffix into a box catalog and a vial catalog. Prefers the live catalog
 * (`GET /partner/store/products`, partitioned) and falls back to the bundled
 * snapshots. Confident matches are written; ambiguous/unmatched are reported per
 * mapping. Existing values are preserved unless `{ overwrite: true }`;
 * `{ dryRun: true }` previews without writing. Admin-only.
 */

type Report = {
  counts: { updated: number; skipped_already_set: number; ambiguous: number; unmatched: number };
  updated: { id: string; name: string; sku: string }[];
  ambiguous: { id: string; name: string; candidates: string[] }[];
  unmatched: { id: string; name: string }[];
};

const emptyReport = (): Report => ({
  counts: { updated: 0, skipped_already_set: 0, ambiguous: 0, unmatched: 0 },
  updated: [],
  ambiguous: [],
  unmatched: [],
});

type Classified =
  | { kind: 'write'; sku: string }
  | { kind: 'skip' }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unmatched' };

// Only ever target real PuraMass SKUs: a case/box starts `puramass-` and ends
// `-case` (e.g. `puramass-ss-31-50mg-case`); a single vial starts `puramass-`
// and ends `-vial`. The legacy `-10-pack` suffix is deliberately NOT accepted —
// PuraMass case SKUs are `-case` — so a stale `-10-pack` value is repaired by
// the sync rather than carried forward. This also keeps the matcher off
// legacy/general non-`puramass-` SKUs (an old `bacteriostatic-water-10ml`,
// general products like `tempramed-vivi-cap`, …).
const isBoxSku = (sku: string) => sku.startsWith('puramass-') && sku.endsWith('-case');
const isVialSku = (sku: string) => sku.startsWith('puramass-') && sku.endsWith('-vial');

function classify(
  name: string,
  strength: string | null,
  existing: string | null,
  overwrite: boolean,
  catalog: PuramassCatalogEntry[],
  isValidSku: (sku: string) => boolean,
): Classified {
  // A pre-existing value only "counts" when it is already a real PuraMass SKU
  // of the right form for this column. A legacy/invalid value — an old
  // `bacteriostatic-water-10ml`, or a stale `puramass-…-10-pack` case SKU — is
  // treated as unset, so the sync repairs it even without `overwrite`.
  const current = existing && isValidSku(existing) ? existing : null;
  const result = matchProductToPuramass(name, strength, catalog);
  if (result.status === 'exact' || result.status === 'matched') {
    if (current && !overwrite) return { kind: 'skip' };
    if (current === result.sku) return { kind: 'skip' };
    return { kind: 'write', sku: result.sku as string };
  }
  if (result.status === 'ambiguous') {
    return { kind: 'ambiguous', candidates: result.candidates.map((c) => c.sku) };
  }
  return { kind: 'unmatched' };
}

export async function POST(req: NextRequest) {
  const db = getSupabase();

  // --- Auth: admin only (mirrors /api/admin/settings) ---
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { data: customer } = await db
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = customer?.role || 'customer';
  if (!canAccessAdmin(role) || role === 'assistant') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const overwrite = body?.overwrite === true;
  const dryRun = body?.dryRun === true;

  // --- Load the catalog (live preferred, snapshot fallback), split box/vial ---
  let boxCatalog: PuramassCatalogEntry[] = PURAMASS_CATALOG_SNAPSHOT.filter((e) => isBoxSku(e.sku));
  let vialCatalog: PuramassCatalogEntry[] = PURAMASS_VIAL_CATALOG_SNAPSHOT.filter((e) => isVialSku(e.sku));
  const source = { box: 'snapshot', vial: 'snapshot' };
  if (isPuramassConfigured()) {
    try {
      const live = await fetchPuramassCatalog();
      const liveBox = live.filter((p) => isBoxSku(p.sku)).map((p) => ({ sku: p.sku, name: p.name }));
      const liveVial = live.filter((p) => isVialSku(p.sku)).map((p) => ({ sku: p.sku, name: p.name }));
      if (liveBox.length) {
        boxCatalog = liveBox;
        source.box = 'live';
      }
      if (liveVial.length) {
        vialCatalog = liveVial;
        source.vial = 'live';
      }
    } catch (err) {
      console.error('PuraMass live catalog fetch failed, using snapshots:', err);
    }
  }

  // --- Load ACTIVE storefront products (resilient to the vial migration not
  // run). Inactive/deactivated products are skipped — they can't be bought, so
  // they shouldn't be mapped or cluttering the unmatched report. ---
  let vialColumnAvailable = true;
  let products: any[] | null = null;
  {
    const full = await db
      .from('products')
      .select('id, name, strength, puramass_sku, puramass_sku_vial')
      .eq('active', true)
      .order('name');
    if (full.error) {
      vialColumnAvailable = false;
      const base = await db
        .from('products')
        .select('id, name, strength, puramass_sku')
        .eq('active', true)
        .order('name');
      if (base.error) {
        return NextResponse.json({ error: 'Could not load products' }, { status: 500 });
      }
      products = base.data;
    } else {
      products = full.data;
    }
  }

  const box = emptyReport();
  const vial = emptyReport();

  for (const p of products ?? []) {
    const id = p.id as string;
    const name = (p.name as string) ?? '';
    const strength = (p.strength as string | null) ?? null;
    const existingBox = (p.puramass_sku as string | null)?.trim() || null;
    const existingVial = (p.puramass_sku_vial as string | null)?.trim() || null;

    const boxC = classify(name, strength, existingBox, overwrite, boxCatalog, isBoxSku);
    const vialC = vialColumnAvailable
      ? classify(name, strength, existingVial, overwrite, vialCatalog, isVialSku)
      : ({ kind: 'skip' } as Classified);

    const update: Record<string, unknown> = {};
    if (boxC.kind === 'write') update.puramass_sku = boxC.sku;
    if (vialC.kind === 'write') update.puramass_sku_vial = vialC.sku;

    let writeOk = true;
    if (!dryRun && Object.keys(update).length) {
      const { error } = await db.from('products').update(update).eq('id', id);
      if (error) writeOk = false;
    }

    // Box report
    if (boxC.kind === 'write') {
      writeOk
        ? (box.counts.updated++, box.updated.push({ id, name, sku: boxC.sku }))
        : (box.counts.unmatched++, box.unmatched.push({ id, name }));
    } else if (boxC.kind === 'skip') box.counts.skipped_already_set++;
    else if (boxC.kind === 'ambiguous') {
      box.counts.ambiguous++;
      box.ambiguous.push({ id, name, candidates: boxC.candidates });
    } else {
      box.counts.unmatched++;
      box.unmatched.push({ id, name });
    }

    // Vial report (only when the column exists)
    if (vialColumnAvailable) {
      if (vialC.kind === 'write') {
        writeOk
          ? (vial.counts.updated++, vial.updated.push({ id, name, sku: vialC.sku }))
          : (vial.counts.unmatched++, vial.unmatched.push({ id, name }));
      } else if (vialC.kind === 'skip') vial.counts.skipped_already_set++;
      else if (vialC.kind === 'ambiguous') {
        vial.counts.ambiguous++;
        vial.ambiguous.push({ id, name, candidates: vialC.candidates });
      } else {
        vial.counts.unmatched++;
        vial.unmatched.push({ id, name });
      }
    }
  }

  if (!dryRun && (box.counts.updated || vial.counts.updated)) {
    await logAuditServer(db, {
      actor_id: user.id,
      action: 'puramass.sync_skus',
      entity_type: 'products',
      entity_id: null,
      payload: {
        source,
        box: box.counts,
        vial: vial.counts,
        overwrite,
      },
    });
  }

  return NextResponse.json({
    source,
    catalog_count: { box: boxCatalog.length, vial: vialCatalog.length },
    vial_column_available: vialColumnAvailable,
    dry_run: dryRun,
    box,
    vial,
  });
}
