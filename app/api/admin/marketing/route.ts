import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canManageMarketing, type UserRole } from '@/lib/permissions';
import { readSiteConfigRow, shapeSiteConfig } from '@/lib/site-config';
import { logAuditServer } from '@/lib/admin/audit';
import { logErrorServer } from '@/lib/admin/errorLog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function resolveRole(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { role: 'customer' as UserRole, userId: null };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { role: 'customer' as UserRole, userId: null };
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  return { role: (customer?.role || 'customer') as UserRole, userId: user.id };
}

const asText = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

// GET: current branding + tracking config (admins + analytics/marketing).
export async function GET(request: NextRequest) {
  const { role } = await resolveRole(request);
  if (!canManageMarketing(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const config = await readSiteConfigRow(supabase);
  return NextResponse.json({ config });
}

// PUT: update branding + tracking. Only the marketing columns are touched, so
// this never disturbs the operational settings on the (admin-only) Settings page.
export async function PUT(request: NextRequest) {
  const { role, userId } = await resolveRole(request);
  if (!canManageMarketing(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if ('store_name' in body) updates.store_name = asText(body.store_name);
    if ('store_tagline' in body) updates.store_tagline = asText(body.store_tagline);
    if ('logo_url' in body) updates.logo_url = asText(body.logo_url);
    if ('favicon_url' in body) updates.favicon_url = asText(body.favicon_url);
    if ('meta_pixel_id' in body) updates.meta_pixel_id = asText(body.meta_pixel_id);

    // GA4 measurement id must look like G-XXXXXXXXXX (or be cleared).
    if ('ga4_measurement_id' in body) {
      const g = asText(body.ga4_measurement_id);
      if (g && !/^G-[A-Z0-9]{4,}$/i.test(g)) {
        return NextResponse.json(
          { error: 'GA4 Measurement ID should look like G-XXXXXXXXXX' },
          { status: 400 },
        );
      }
      updates.ga4_measurement_id = g ? g.toUpperCase() : null;
    }

    if ('tracking_consent_required' in body) {
      if (typeof body.tracking_consent_required !== 'boolean') {
        return NextResponse.json(
          { error: 'tracking_consent_required must be a boolean' },
          { status: 400 },
        );
      }
      updates.tracking_consent_required = body.tracking_consent_required;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ config: await readSiteConfigRow(supabase) });
    }
    updates.updated_at = new Date().toISOString();

    // Update the singleton row, or create it if the store has never saved
    // settings before.
    const { data: existing } = await supabase
      .from('site_settings')
      .select('id')
      .single();

    let writeError: { message?: string } | null = null;
    if (existing) {
      const { error } = await supabase
        .from('site_settings')
        .update(updates)
        .eq('id', existing.id);
      writeError = error;
    } else {
      const { error } = await supabase
        .from('site_settings')
        .insert({ checkout_type: 'email', ...updates });
      writeError = error;
    }

    if (writeError) {
      return NextResponse.json(
        { error: writeError.message || 'Failed to save marketing settings' },
        { status: 500 },
      );
    }

    await logAuditServer(supabase, {
      actor_id: userId,
      action: 'marketing.update',
      entity_type: 'settings',
      entity_id: null,
      payload: { keys: Object.keys(updates).filter((k) => k !== 'updated_at') },
    });

    // Re-read shaped so the client gets normalised values back.
    const config = shapeSiteConfig(
      (await supabase.from('site_settings').select('*').single()).data ?? {},
    );
    return NextResponse.json({ success: true, config });
  } catch (error) {
    await logErrorServer(supabase, {
      area: 'marketing',
      route: '/api/admin/marketing',
      method: 'PUT',
      error,
      actor_id: userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
