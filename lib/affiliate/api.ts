/**
 * Affiliate API Functions
 * Handles all database operations for the affiliate system
 */

import { supabase } from '@/lib/supabase';
import type { Affiliate, ReferralCode, Commission } from '@/lib/supabase';
import { generateReferralCode, hashPassword, calculateCommission } from './utils';

/**
 * Create a new affiliate account
 */
export async function createAffiliate(data: {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  walletAddress?: string;
}): Promise<{ success: boolean; affiliate?: Affiliate; error?: string }> {
  try {
    // Hash password
    const passwordHash = await hashPassword(data.password);

    // Insert affiliate
    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .insert({
        email: data.email.toLowerCase(),
        first_name: data.firstName,
        last_name: data.lastName,
        wallet_address: data.walletAddress || null,
        password_hash: passwordHash,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating affiliate:', error);
      return { success: false, error: error.message };
    }

    // Generate referral code for the new affiliate
    const codeResult = await createReferralCode(affiliate.id);
    if (!codeResult.success) {
      console.error('Error creating referral code:', codeResult.error);
    }

    return { success: true, affiliate };
  } catch (error) {
    console.error('Error in createAffiliate:', error);
    return { success: false, error: 'Failed to create affiliate account' };
  }
}

/**
 * Login affiliate
 */
export async function loginAffiliate(
  email: string,
  password: string
): Promise<{ success: boolean; affiliate?: Affiliate; error?: string }> {
  try {
    const passwordHash = await hashPassword(password);

    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('password_hash', passwordHash)
      .eq('active', true)
      .single();

    if (error || !affiliate) {
      return { success: false, error: 'Invalid email or password' };
    }

    return { success: true, affiliate };
  } catch (error) {
    console.error('Error in loginAffiliate:', error);
    return { success: false, error: 'Login failed' };
  }
}

/**
 * Get affiliate by ID
 */
export async function getAffiliate(affiliateId: string): Promise<Affiliate | null> {
  try {
    const { data, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('id', affiliateId)
      .single();

    if (error) {
      console.error('Error fetching affiliate:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getAffiliate:', error);
    return null;
  }
}

/**
 * Update affiliate profile
 */
export async function updateAffiliate(
  affiliateId: string,
  updates: Partial<Pick<Affiliate, 'first_name' | 'last_name' | 'wallet_address'>>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('affiliates')
      .update(updates)
      .eq('id', affiliateId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in updateAffiliate:', error);
    return { success: false, error: 'Failed to update profile' };
  }
}

/**
 * Create a referral code for an affiliate
 */
export async function createReferralCode(
  affiliateId: string
): Promise<{ success: boolean; code?: ReferralCode; error?: string }> {
  try {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = generateReferralCode();

      const { data, error } = await supabase
        .from('referral_codes')
        .insert({
          affiliate_id: affiliateId,
          code,
          active: true,
        })
        .select()
        .single();

      if (!error) {
        return { success: true, code: data };
      }

      // If duplicate code, try again
      if (error.code === '23505') {
        attempts++;
        continue;
      }

      // Other error
      return { success: false, error: error.message };
    }

    return { success: false, error: 'Failed to generate unique code' };
  } catch (error) {
    console.error('Error in createReferralCode:', error);
    return { success: false, error: 'Failed to create referral code' };
  }
}

/**
 * Get referral codes for an affiliate
 */
export async function getReferralCodes(affiliateId: string): Promise<ReferralCode[]> {
  try {
    const { data, error } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching referral codes:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getReferralCodes:', error);
    return [];
  }
}

/**
 * Validate and get referral code
 */
export async function validateReferralCode(code: string): Promise<ReferralCode | null> {
  try {
    const { data, error } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('active', true)
      .single();

    if (error) {
      console.error('Error validating referral code:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in validateReferralCode:', error);
    return null;
  }
}

/**
 * Create a commission record
 */
export async function createCommission(data: {
  affiliateId: string;
  orderId: string;
  orderTotal: number;
  referralCodeId?: string;
  commissionRate?: number;
}): Promise<{ success: boolean; commission?: Commission; error?: string }> {
  try {
    const rate = data.commissionRate || 10;
    const amount = calculateCommission(data.orderTotal, rate);

    const { data: commission, error } = await supabase
      .from('commissions')
      .insert({
        affiliate_id: data.affiliateId,
        order_id: data.orderId,
        referral_code_id: data.referralCodeId || null,
        order_total: data.orderTotal,
        amount,
        commission_rate: rate,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating commission:', error);
      return { success: false, error: error.message };
    }

    return { success: true, commission };
  } catch (error) {
    console.error('Error in createCommission:', error);
    return { success: false, error: 'Failed to create commission' };
  }
}

/**
 * Get commissions for an affiliate
 */
export async function getAffiliateCommissions(
  affiliateId: string,
  status?: 'pending' | 'paid' | 'cancelled'
): Promise<Commission[]> {
  try {
    let query = supabase
      .from('commissions')
      .select('*')
      .eq('affiliate_id', affiliateId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching commissions:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAffiliateCommissions:', error);
    return [];
  }
}

/**
 * Get affiliate statistics
 */
export async function getAffiliateStats(affiliateId: string): Promise<{
  totalEarnings: number;
  pendingEarnings: number;
  totalReferrals: number;
  totalCommissions: number;
}> {
  try {
    // Get affiliate total earnings
    const affiliate = await getAffiliate(affiliateId);
    const totalEarnings = affiliate?.total_earnings || 0;

    // Get pending commissions
    const pendingCommissions = await getAffiliateCommissions(affiliateId, 'pending');
    const pendingEarnings = pendingCommissions.reduce((sum, c) => sum + Number(c.amount), 0);

    // Get all commissions
    const allCommissions = await getAffiliateCommissions(affiliateId);
    const totalCommissions = allCommissions.length;

    // Get referral codes
    const codes = await getReferralCodes(affiliateId);
    const totalReferrals = codes.reduce((sum, code) => sum + code.uses_count, 0);

    return {
      totalEarnings,
      pendingEarnings,
      totalReferrals,
      totalCommissions,
    };
  } catch (error) {
    console.error('Error in getAffiliateStats:', error);
    return {
      totalEarnings: 0,
      pendingEarnings: 0,
      totalReferrals: 0,
      totalCommissions: 0,
    };
  }
}
