import type { ShippingConfig } from '@/lib/shipping/easyship';

export type CheckCategory = 'settings' | 'destination' | 'parcel';

export interface LabelCheck {
  key: string;
  label: string;
  ok: boolean;
  category: CheckCategory;
  /** Shown when the check fails. */
  hint?: string;
}

export interface LabelDestination {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
}

export interface ReadinessEvaluation {
  isPickup: boolean;
  /** True only when the order is shippable and every required check passes. */
  ready: boolean;
  checks: LabelCheck[];
  destination: LabelDestination;
}

/** Minimal order shape needed to evaluate Easyship label readiness. */
export interface ReadinessOrder {
  notes?: string | null;
  fulfillment_type?: string | null;
  email?: string | null;
  shipping_address?: Record<string, any> | null;
  items?: unknown;
}

/**
 * Evaluate everything Easyship needs before a shipment/label can be created for
 * an order: settings (account/origin), destination address completeness, and
 * parcel contents. Shared by the single-order readiness route and the bulk
 * pre-flight check so both stay in lock-step.
 */
export function evaluateLabelReadiness(
  order: ReadinessOrder,
  config: ShippingConfig,
): ReadinessEvaluation {
  const isPickup = order.notes === 'PICKUP' || order.fulfillment_type === 'pickup';

  const ship = (order.shipping_address || {}) as Record<string, any>;
  const destination: LabelDestination = {
    firstName: ship.firstName ?? ship.first_name ?? '',
    lastName: ship.lastName ?? ship.last_name ?? '',
    address: ship.address ?? ship.line_1 ?? '',
    city: ship.city ?? '',
    state: ship.state ?? '',
    postalCode: ship.postalCode ?? ship.postal_code ?? '',
    country: ship.country ?? 'CA',
    phone: ship.phone ?? '',
    email: ship.email ?? order.email ?? '',
  };

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

  const itemCount = Array.isArray(order.items) ? order.items.length : 0;

  const checks: LabelCheck[] = [
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
      hint: "Add the recipient's name below.",
    },
    {
      // Optional: a house default is used when the customer has no phone, so
      // this never blocks label creation.
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
      hint: 'Add the street address below.',
    },
    {
      key: 'city',
      label: 'City',
      ok: Boolean(destination.city),
      category: 'destination',
    },
    {
      key: 'state',
      label: 'Province / state',
      ok: Boolean(destination.state),
      category: 'destination',
    },
    {
      key: 'postal_code',
      label: 'Postal code',
      ok: Boolean(destination.postalCode),
      category: 'destination',
    },
    {
      key: 'country',
      label: 'Country',
      ok: Boolean(destination.country),
      category: 'destination',
    },
    {
      key: 'items',
      label: 'Order has at least one item',
      ok: itemCount > 0,
      category: 'parcel',
      hint: 'This order has no line items to ship.',
    },
  ];

  const ready = !isPickup && checks.every((c) => c.ok);

  return { isPickup, ready, checks, destination };
}
