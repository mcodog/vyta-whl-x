import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Affiliate program economics.
 *
 * When an order is attributed to an affiliate the customer receives a discount
 * on the product subtotal, and the affiliate earns a commission calculated on
 * the *discounted* subtotal (i.e. the affiliate takes their cut of what the
 * customer actually paid for product, not the pre-discount list price).
 */
export const AFFILIATE_DISCOUNT_RATE = 0.1; // 10% off for the customer
export const AFFILIATE_COMMISSION_RATE = 0.1; // 10% of the discounted subtotal

export interface AffiliateAttribution {
  affiliateId: string;
  /** The referral code row to credit, when one applies. */
  referralCodeId: string | null;
  /** True when attribution came from a referral code rather than a binding. */
  viaCode: boolean;
}

/**
 * Decide which affiliate (if any) an order should be attributed to.
 *
 * Priority:
 *   1. The customer is already bound to an affiliate (customers.affiliate_id) —
 *      this is the "affiliate added me as their customer" case. Skipped when the
 *      affiliate is flagged `manual_code_only`: those affiliates don't auto-lock
 *      their bound customers, so attribution has to come from the code below.
 *   2. A referral code was supplied at checkout (typed in, or via a ?ref= link).
 *
 * Self-referral (the affiliate ordering through their own account/code) is
 * ignored so affiliates can't pay themselves a commission.
 */
export async function resolveAffiliateAttribution(
  db: SupabaseClient,
  opts: { customerId: string | null; referralCode?: string | null },
): Promise<AffiliateAttribution | null> {
  const { customerId, referralCode } = opts;

  // 1. Bound customer.
  if (customerId) {
    const { data: cust } = await db
      .from('customers')
      .select('affiliate_id')
      .eq('id', customerId)
      .maybeSingle();
    const affiliateId = cust?.affiliate_id as string | null | undefined;
    if (affiliateId && affiliateId !== customerId) {
      // A `manual_code_only` affiliate does not auto-lock its bound customers —
      // fall through to the referral-code path so attribution only happens when
      // the customer actually supplies the code.
      const { data: aff } = await db
        .from('affiliates')
        .select('manual_code_only')
        .eq('id', affiliateId)
        .maybeSingle();
      if (!aff?.manual_code_only) {
        // Best-effort: credit the affiliate's active referral code if they have one.
        const { data: rc } = await db
          .from('referral_codes')
          .select('id')
          .eq('affiliate_id', affiliateId)
          .eq('active', true)
          .limit(1)
          .maybeSingle();
        return { affiliateId, referralCodeId: rc?.id ?? null, viaCode: false };
      }
    }
  }

  // 2. Referral code.
  if (referralCode) {
    const { data: rc } = await db
      .from('referral_codes')
      .select('id, affiliate_id')
      .eq('code', referralCode)
      .eq('active', true)
      .maybeSingle();
    if (rc && rc.affiliate_id !== customerId) {
      return { affiliateId: rc.affiliate_id, referralCodeId: rc.id, viaCode: true };
    }
  }

  return null;
}

/** Round to cents. */
export function round2(n: number): number {
  return Number(n.toFixed(2));
}
