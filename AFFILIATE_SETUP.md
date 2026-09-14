# Northern Peptides Affiliate System Setup Guide

Complete affiliate system with 10% commission tracking for Northern Peptides.

## Features

- **Affiliate Portal**: Signup, login, and dashboard
- **Referral Code System**: Unique 8-character codes for each affiliate
- **Commission Tracking**: 10% commission on all referred orders
- **Real-time Stats**: Track earnings, referrals, and pending commissions
- **Luxury Design**: Glass-morphism UI matching your brand

## Files Created

### Database
- `supabase-schema.sql` - Complete database schema with tables, indexes, and triggers

### API & Utilities
- `lib/supabase.ts` - Supabase client configuration
- `lib/affiliate/api.ts` - All affiliate API functions
- `lib/affiliate/utils.ts` - Utility functions (code generation, validation, etc.)

### Context
- `contexts/AffiliateContext.tsx` - Session management for affiliates

### Pages
- `app/(affiliate)/affiliate/signup/page.tsx` - Affiliate signup form
- `app/(affiliate)/affiliate/login/page.tsx` - Affiliate login
- `app/(affiliate)/affiliate/dashboard/page.tsx` - Dashboard with stats
- `app/(affiliate)/affiliate/code/page.tsx` - Referral code display & sharing
- `app/checkout/page.tsx` - Checkout with referral code input

### Configuration
- `.env.local` - Environment variables (needs your Supabase keys)

## Setup Instructions

### 1. Set Up Supabase Database

1. Go to your Supabase project: https://swpcvpkcfxihxmjpjqow.supabase.co
2. Navigate to the SQL Editor
3. Open `supabase-schema.sql` and copy the entire contents
4. Paste and run the SQL in the Supabase SQL Editor
5. Verify tables were created: `affiliates`, `referral_codes`, `commissions`

### 2. Configure Environment Variables

1. Open `.env.local` in the project root
2. Get your Supabase keys from: **Supabase Dashboard > Project Settings > API**
3. Replace these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://swpcvpkcfxihxmjpjqow.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

### 3. Install Dependencies

```bash
npm install
```

The system uses `@supabase/supabase-js` which has been added to your dependencies.

### 4. Run the Development Server

```bash
npm run dev
```

Visit: http://localhost:3000

## How It Works

### For Affiliates

1. **Signup**: Visit `/affiliate/signup` to create an account
   - Email, name, password required
   - Optional wallet address for crypto payouts
   - Automatically generates unique referral code

2. **Login**: Visit `/affiliate/login` to access dashboard

3. **Dashboard**: View stats at `/affiliate/dashboard`
   - Total earnings (paid commissions)
   - Pending earnings
   - Total referrals
   - Recent commission history

4. **Share Code**: Visit `/affiliate/code`
   - Copy referral code
   - Copy full referral URL
   - Share with customers

### For Customers

1. **Checkout**: Visit `/checkout`
2. Enter referral code in the "Referral Code" section
3. Code validates in real-time
4. Complete purchase (affiliate earns 10% commission)

### Commission Tracking

When an order is placed with a referral code:

```typescript
import { createCommission } from '@/lib/affiliate/api';

// In your order processing logic:
await createCommission({
  affiliateId: referralCode.affiliate_id,
  orderId: order.id,
  orderTotal: order.total,
  referralCodeId: referralCode.id,
});
```

This will:
- Create a commission record with 10% of order total
- Set status to "pending"
- Increment referral code usage count

### Paying Commissions

To mark a commission as paid:

```sql
-- In Supabase SQL Editor
UPDATE commissions
SET status = 'paid', paid_at = NOW()
WHERE id = '<commission-id>';
```

This automatically:
- Updates affiliate's `total_earnings`
- Triggers the database function to add amount to affiliate balance

## Database Schema

### Affiliates Table
- Stores affiliate information
- Tracks total earnings
- Wallet address for crypto payouts

### Referral Codes Table
- Unique 8-character codes
- Linked to affiliate
- Tracks usage count

### Commissions Table
- Order reference
- Amount (10% of order total)
- Status: pending, paid, or cancelled
- Timestamps for tracking

## API Functions Reference

### Authentication
```typescript
createAffiliate(data) // Sign up new affiliate
loginAffiliate(email, password) // Authenticate affiliate
```

### Referral Codes
```typescript
getReferralCodes(affiliateId) // Get all codes for affiliate
validateReferralCode(code) // Check if code is valid
createReferralCode(affiliateId) // Generate new code
```

### Commissions
```typescript
createCommission(data) // Record new commission
getAffiliateCommissions(affiliateId, status?) // Get commissions
getAffiliateStats(affiliateId) // Get dashboard stats
```

### Profile Management
```typescript
getAffiliate(affiliateId) // Get affiliate details
updateAffiliate(affiliateId, updates) // Update profile
```

## Security Features

- Password hashing (SHA-256)
- Row Level Security (RLS) enabled on all tables
- Session management via localStorage
- Input validation for all forms
- SQL injection protection via Supabase client

## Integration with Your Order System

When processing orders, check for referral codes:

```typescript
// In your checkout/order processing
import { validateReferralCode, createCommission } from '@/lib/affiliate/api';

// 1. Validate the referral code
const referralCode = await validateReferralCode(codeFromCheckout);

if (referralCode) {
  // 2. Create commission after successful order
  await createCommission({
    affiliateId: referralCode.affiliate_id,
    orderId: newOrder.id,
    orderTotal: newOrder.total,
    referralCodeId: referralCode.id,
  });
}
```

## URL Referral Tracking

Referral codes can be passed via URL:
```
https://northernpeptides.com?ref=ABC12345
https://northernpeptides.com/checkout?ref=ABC12345
```

The checkout page automatically detects and validates the `ref` parameter.

## Testing

1. **Create Test Affiliate**:
   - Visit `/affiliate/signup`
   - Create account with test email
   - Note your referral code

2. **Test Referral**:
   - Visit `/checkout?ref=YOUR_CODE`
   - Verify code validates
   - Complete test order

3. **Check Dashboard**:
   - Login at `/affiliate/login`
   - Verify stats update
   - Check commission appears in dashboard

## Production Checklist

- [ ] Run `supabase-schema.sql` in production Supabase
- [ ] Update `.env.local` with production Supabase keys
- [ ] Set up automated commission payments
- [ ] Configure email notifications (optional)
- [ ] Test complete signup → referral → commission flow
- [ ] Enable RLS policies as needed
- [ ] Set up monitoring for commission creation

## Commission Payment Process

### Manual Payment
1. Review pending commissions in Supabase
2. Process payments to affiliate wallet addresses
3. Update commission status to "paid"

### SQL to Get Pending Payments
```sql
SELECT
  a.email,
  a.first_name,
  a.last_name,
  a.wallet_address,
  SUM(c.amount) as total_pending
FROM commissions c
JOIN affiliates a ON a.id = c.affiliate_id
WHERE c.status = 'pending'
GROUP BY a.id, a.email, a.first_name, a.last_name, a.wallet_address;
```

## Support

For issues or questions:
1. Check Supabase logs for database errors
2. Verify environment variables are set correctly
3. Ensure all tables and functions were created successfully
4. Check browser console for client-side errors

## Navigation Links

The affiliate program is accessible via:
- Main navigation: "Affiliates" link (desktop & mobile)
- Direct URLs:
  - `/affiliate/signup` - Join program
  - `/affiliate/login` - Access dashboard
  - `/affiliate/dashboard` - View stats
  - `/affiliate/code` - Get referral code

## Next Steps

1. Integrate commission creation into your order processing
2. Set up automated payment system (optional)
3. Create email templates for affiliate notifications
4. Add analytics tracking for referral conversions
5. Consider adding affiliate tier system for higher earners

---

**Built for Northern Peptides** | 10% Commission Program | Production Ready
