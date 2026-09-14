/**
 * PuraMass / Stealth Health hosted-checkout master switch (config file).
 * ---------------------------------------------------------------------------
 * Flip `PURAMASS_CHECKOUT_ENABLED` to `false` to disable the hosted checkout
 * everywhere:
 *   - the storefront falls back to the in-house email/invoice checkout,
 *   - the `/api/checkout/puramass` hand-off refuses new orders, and
 *   - the admin Settings toggle reads as off (and can't be turned on).
 *
 * This is a HARD override above the admin Settings toggle
 * (`site_settings.puramass_checkout_enabled`) and the API credentials — use it
 * to turn the whole integration off from config, without touching the database.
 *
 * The in-flight payment webhook (`/api/webhooks/stealth-health`) is intentionally
 * NOT gated by this switch: orders already handed off before disabling can still
 * be marked paid / fulfilled when their payment lands.
 *
 * Ops escape hatch: the env var `PURAMASS_CHECKOUT_ENABLED=false` also forces it
 * off (takes precedence over the constant below), so it can be disabled without
 * a code change.
 */
export const PURAMASS_CHECKOUT_ENABLED = true;

/** Effective config state = the constant above, unless the env var forces off. */
export function puramassCheckoutEnabledByConfig(): boolean {
  const env = process.env.PURAMASS_CHECKOUT_ENABLED;
  if (typeof env === 'string' && env.trim().toLowerCase() === 'false') return false;
  return PURAMASS_CHECKOUT_ENABLED;
}
