# Northern Peptides Affiliate System - Deployment Checklist

## Pre-Deployment Setup (Do This Now)

### 1. Database Setup
- [ ] Open Supabase dashboard: https://swpcvpkcfxihxmjpjqow.supabase.co
- [ ] Go to SQL Editor
- [ ] Copy entire contents of `supabase-schema.sql`
- [ ] Paste and execute in SQL Editor
- [ ] Verify 3 tables created: `affiliates`, `referral_codes`, `commissions`
- [ ] Check that triggers and functions were created successfully

### 2. Environment Configuration
- [ ] Open `.env.local` file
- [ ] Go to Supabase Dashboard > Project Settings > API
- [ ] Copy **anon/public key** → Replace `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Copy **service_role key** → Replace `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Verify URL is correct: `https://swpcvpkcfxihxmjpjqow.supabase.co`
- [ ] Save `.env.local` file
- [ ] **IMPORTANT**: Add `.env.local` to `.gitignore` (it should already be there)

### 3. Dependencies Installation
```bash
npm install
```

This installs the new dependency: `@supabase/supabase-js`

### 4. Test the Application
```bash
npm run dev
```

Visit http://localhost:3000 and verify:
- [ ] Homepage loads without errors
- [ ] Navigation shows "Affiliates" link
- [ ] Can access `/affiliate/signup`
- [ ] Can access `/affiliate/login`
- [ ] Can access `/checkout`

## Testing the Complete Flow

### Test Affiliate Signup
1. [ ] Go to http://localhost:3000/affiliate/signup
2. [ ] Create test account:
   - Email: test@example.com
   - First Name: Test
   - Last Name: User
   - Password: testpass123
   - Wallet: (optional) 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
3. [ ] Should redirect to dashboard
4. [ ] Verify dashboard shows:
   - Welcome message with first name
   - All stats show $0.00 / 0
   - "My Referral Code" button visible

### Test Referral Code
1. [ ] Click "My Referral Code" button
2. [ ] Verify 8-character code displays
3. [ ] Click "Copy Code" - should show "Copied!"
4. [ ] Click "Copy Referral URL" - should show "URL Copied!"
5. [ ] Copy the code for next test

### Test Checkout with Referral
1. [ ] Go to http://localhost:3000/checkout
2. [ ] Paste referral code in "Referral Code" field
3. [ ] Should show green checkmark when code validates
4. [ ] Should see success message about supporting affiliate

### Verify Database
Open Supabase dashboard > Table Editor:
- [ ] Check `affiliates` table - should have 1 row (your test account)
- [ ] Check `referral_codes` table - should have 1 row with your code
- [ ] Check `commissions` table - should be empty (no orders yet)

## Integration Required

### Connect to Your Order System
You need to integrate commission tracking into your order processing.

See `ORDER_INTEGRATION.md` for detailed instructions.

Quick summary:
1. Store referral code during checkout
2. After successful order, call `createCommission()`
3. Commission automatically calculates 10% of order total

## Production Deployment

### Before Going Live
- [ ] Review all RLS policies in Supabase
- [ ] Set up production environment variables
- [ ] Test complete flow end-to-end
- [ ] Set up commission payment process
- [ ] Create admin process for reviewing commissions

### Environment Variables for Production
Create `.env.production` or configure in your hosting platform:
```env
NEXT_PUBLIC_SUPABASE_URL=https://swpcvpkcfxihxmjpjqow.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<production-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<production-service-key>
```

### Security Review
- [ ] Passwords are hashed (SHA-256)
- [ ] RLS policies are enabled
- [ ] Service role key is never exposed to client
- [ ] Input validation on all forms
- [ ] SQL injection protection via Supabase client

## Features Delivered

### ✅ Affiliate Portal
- Signup page with validation
- Login page with authentication
- Dashboard with real-time stats
- Referral code display with copy functionality

### ✅ Database Schema
- Affiliates table with wallet addresses
- Referral codes with usage tracking
- Commissions with status management
- Automated triggers for earnings updates

### ✅ API Functions
- `createAffiliate()` - Sign up new affiliates
- `loginAffiliate()` - Authenticate users
- `getReferralCodes()` - Get affiliate codes
- `validateReferralCode()` - Verify codes
- `createCommission()` - Track earnings
- `getAffiliateStats()` - Dashboard data

### ✅ UI Components
- Luxury glass-morphism design
- Responsive layouts
- Real-time validation
- Copy-to-clipboard functionality
- Loading states
- Error handling

### ✅ Navigation Integration
- "Affiliates" link in main navigation
- Mobile menu support
- Direct access to signup

### ✅ Checkout Integration
- Referral code input field
- Real-time code validation
- Visual feedback (green/red states)
- URL parameter support (?ref=CODE)

## Commission Payment Process

### When to Pay Commissions
You decide the payment schedule:
- Weekly
- Bi-weekly
- Monthly
- Per order (immediate)

### How to Pay
1. Query pending commissions:
```sql
SELECT
  a.email,
  a.wallet_address,
  SUM(c.amount) as total_due
FROM commissions c
JOIN affiliates a ON a.id = c.affiliate_id
WHERE c.status = 'pending'
GROUP BY a.id;
```

2. Process payments to wallet addresses

3. Mark as paid:
```sql
UPDATE commissions
SET status = 'paid', paid_at = NOW()
WHERE affiliate_id = '<affiliate-id>' AND status = 'pending';
```

## Monitoring & Analytics

### Key Metrics to Track
- Total affiliates signed up
- Active vs inactive affiliates
- Total commissions pending
- Total commissions paid
- Top performing affiliates
- Average commission per order
- Conversion rate (clicks → orders)

### Supabase Queries
See `AFFILIATE_SETUP.md` for useful SQL queries.

## Support & Troubleshooting

### Common Issues

**Signup fails:**
- Check Supabase connection
- Verify `.env.local` has correct keys
- Check browser console for errors

**Referral code not validating:**
- Ensure code is 8 characters
- Check `referral_codes` table in Supabase
- Verify code is marked as active

**Dashboard shows 0 for everything:**
- Normal for new accounts
- Create test commission to verify

**Commission not created:**
- Check order integration code
- Verify `createCommission()` is called
- Check Supabase logs for errors

## Files Reference

### Documentation
- `AFFILIATE_SETUP.md` - Complete setup guide
- `ORDER_INTEGRATION.md` - Integration instructions
- `DEPLOYMENT_CHECKLIST.md` - This file

### Database
- `supabase-schema.sql` - All tables, triggers, functions

### Core Files
- `lib/supabase.ts` - Database client
- `lib/affiliate/api.ts` - All API functions
- `lib/affiliate/utils.ts` - Helper functions
- `contexts/AffiliateContext.tsx` - Session management

### Pages
- `app/(affiliate)/affiliate/signup/page.tsx`
- `app/(affiliate)/affiliate/login/page.tsx`
- `app/(affiliate)/affiliate/dashboard/page.tsx`
- `app/(affiliate)/affiliate/code/page.tsx`
- `app/checkout/page.tsx`

### Configuration
- `.env.local` - Environment variables
- `app/layout.tsx` - Provider setup

## Next Steps After Deployment

1. **Marketing:**
   - Create affiliate program landing page
   - Email existing customers about program
   - Add affiliate info to footer

2. **Features:**
   - Email notifications for new commissions
   - Admin dashboard for managing affiliates
   - Tiered commission rates (5%, 10%, 15%)
   - Referral leaderboard

3. **Automation:**
   - Automated weekly commission reports
   - Automated payment processing
   - Fraud detection for suspicious referrals

## Quick Start Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Success Criteria

Your affiliate system is ready when:
- ✅ Affiliates can sign up and get unique codes
- ✅ Codes validate on checkout page
- ✅ Commissions are created after orders
- ✅ Dashboard shows accurate stats
- ✅ All pages use luxury design theme
- ✅ Mobile responsive
- ✅ Database properly secured with RLS

---

**System Status:** ✅ Ready for Testing
**Production Ready:** After order integration complete
**Commission Rate:** 10%
**Built for:** Northern Peptides
