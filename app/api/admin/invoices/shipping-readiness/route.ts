import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessAdmin } from '@/lib/permissions';
import {
  getShippingConfig,
  getEasyshipRates,
  diagnoseShipping,
  type ShippingRateItem,
} from '@/lib/shipping/easyship';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type CheckCategory = 'settings' | 'destination' | 'parcel';

interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  category: CheckCategory;
  hint?: string;
}

/**
 * POST /api/admin/invoices/shipping-readiness
 *
 * The order-page label-readiness check, adapted for the *invoice creation* form
 * where no order exists yet: the admin posts the destination + line items they
 * have typed so far and gets back the same Easyship checklist, an overall
 * `ready` flag, and — when ready — the live UPS/FedEx courier options so the
 * form can offer a courier to lock the shipment to. Read-only; creates nothing.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: customer } = await supabase
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!canAccessAdmin(customer?.role || 'customer')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dest = (body?.destination || {}) as Record<string, any>;
  const itemsIn: any[] = Array.isArray(body?.items) ? body.items : [];
  // Per-invoice processing-fee choice (admin invoice form). When omitted we keep
  // the historical behaviour of applying the global Settings handling fee.
  const applyProcessingFee =
    typeof body?.applyProcessingFee === 'boolean' ? body.applyProcessingFee : true;
  const processingFeeValueRaw = Number(body?.processingFeeValue);
  const processingFeeValue = Number.isFinite(processingFeeValueRaw)
    ? processingFeeValueRaw
    : null;

  const destination = {
    firstName: String(dest.firstName ?? ''),
    lastName: String(dest.lastName ?? ''),
    address: String(dest.address ?? ''),
    city: String(dest.city ?? ''),
    state: String(dest.state ?? ''),
    postalCode: String(dest.postalCode ?? ''),
    country: String(dest.country ?? 'CA'),
    phone: String(dest.phone ?? ''),
    email: String(dest.email ?? ''),
  };

  const config = await getShippingConfig();
  const originComplete = Boolean(
    config.origin.line_1 &&
      config.origin.city &&
      config.origin.postal_code &&
      config.origin.country_alpha2,
  );
  const originContactComplete = Boolean(
    config.originContact.company_name &&
      config.originContact.contact_name &&
      config.originContact.contact_email &&
      config.originContact.contact_phone,
  );
  const itemCount = itemsIn.length;

  const checks: ReadinessCheck[] = [
    {
      key: 'easyship_enabled',
      label: 'Easyship is enabled',
      ok: config.enabled,
      category: 'settings',
      hint: 'Turn Easyship on in Admin → Settings → Shipping.',
    },
    {
      key: 'api_key',
      label: 'Easyship API key configured',
      ok: Boolean(config.apiKey),
      category: 'settings',
      hint: 'Add your Easyship API key in Admin → Settings → Shipping.',
    },
    {
      key: 'origin_address',
      label: 'Warehouse / origin address complete',
      ok: originComplete,
      category: 'settings',
      hint: 'Set the origin line 1, city, postal code and country in Settings → Shipping.',
    },
    {
      key: 'origin_contact',
      label: 'Sender contact details complete',
      ok: originContactComplete,
      category: 'settings',
      hint: 'Easyship needs the sender company, contact name, email and phone (Settings → Shipping).',
    },
    {
      key: 'recipient_name',
      label: 'Recipient name',
      ok: Boolean(destination.firstName || destination.lastName),
      category: 'destination',
      hint: 'Add the recipient first/last name in the Ship to fields.',
    },
    {
      // Optional: a house default is used when the customer has no phone, so
      // this never blocks the shipment.
      key: 'recipient_phone',
      label: 'Recipient phone (optional)',
      ok: true,
      category: 'destination',
    },
    {
      // Optional: a house default is used when the customer has no email.
      key: 'recipient_email',
      label: 'Recipient email (optional)',
      ok: true,
      category: 'destination',
    },
    {
      key: 'address',
      label: 'Street address',
      ok: Boolean(destination.address),
      category: 'destination',
      hint: 'Add the Ship to street address.',
    },
    { key: 'city', label: 'City', ok: Boolean(destination.city), category: 'destination' },
    { key: 'state', label: 'Province / state', ok: Boolean(destination.state), category: 'destination' },
    { key: 'postal_code', label: 'Postal code', ok: Boolean(destination.postalCode), category: 'destination' },
    { key: 'country', label: 'Country', ok: Boolean(destination.country), category: 'destination' },
    {
      key: 'items',
      label: 'At least one line item',
      ok: itemCount > 0,
      category: 'parcel',
      hint: 'Add at least one line item to ship.',
    },
  ];

  const ready = checks.every((c) => c.ok);

  // Only quote couriers once the invoice is Easyship-ready. The returned cost
  // already includes the processing/handling fee (getEasyshipRates bakes it in
  // via applyHandlingFee), so it matches the figure the customer checkout shows.
  // When ready but no UPS/FedEx rate comes back, run a diagnosis so the admin
  // sees WHY (no courier connected, address rejected, HTTP error…) instead of a
  // vague "no rates" message.
  let rates: Awaited<ReturnType<typeof getEasyshipRates>> = [];
  let ratesNote: string | null = null;
  if (ready) {
    const items: ShippingRateItem[] = itemsIn.map((it) => ({
      quantity: Number(it.quantity) || 1,
      declaredValue: Number(it.declaredValue) || 0,
    }));
    const rateDest = {
      address: destination.address,
      city: destination.city,
      state: destination.state,
      postalCode: destination.postalCode,
      country: destination.country,
    };
    try {
      rates = await getEasyshipRates(rateDest, items, {
        apply: applyProcessingFee,
        value: processingFeeValue,
      });
      if (rates.length === 0) {
        const diag = await diagnoseShipping(rateDest, items);
        if (diag.test && diag.test.rateCount > 0) {
          ratesNote =
            'Easyship returned rates, but none from UPS or FedEx — check which couriers are connected in Easyship.';
        } else {
          // TEMPORARY: surface the full Easyship diagnostic so a 403 / auth /
          // config problem is visible right in the form. Remove once resolved.
          const sample =
            typeof diag.test?.sample === 'string'
              ? diag.test.sample
              : diag.test?.sample
                ? JSON.stringify(diag.test.sample)
                : '';
          ratesNote = [
            diag.reason || 'Easyship returned no rates for this address.',
            diag.test?.error ? `Response: ${diag.test.error}` : '',
            sample ? `Body: ${sample.slice(0, 600)}` : '',
            `HTTP: ${diag.test?.httpStatus ?? 'n/a'}`,
            `Key: ${diag.apiKeySource}${diag.apiKeyLast4 ? ` …${diag.apiKeyLast4}` : ''}`,
            `Endpoint: ${diag.ratesEndpoint}`,
            `Origin complete: ${diag.originComplete}`,
          ]
            .filter(Boolean)
            .join(' · ');
        }
      }
    } catch {
      rates = [];
      ratesNote = 'Could not reach Easyship for live rates — try again in a moment.';
    }
  }

  // Surface the global handling ("processing") fee so the invoice form can
  // prefill its per-invoice override field and show the correct unit.
  const handlingFee = { type: config.handlingFeeType, value: config.handlingFeeValue };

  return NextResponse.json({ ready, checks, rates, ratesNote, handlingFee });
}
