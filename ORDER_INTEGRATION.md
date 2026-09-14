# Order Processing Integration Guide

Quick reference for integrating affiliate commission tracking into your order system.

## When to Create Commissions

Create a commission record immediately after a successful order is placed if a referral code was used.

## Integration Code

### Step 1: Store Referral Code During Checkout

In your checkout form, store the validated referral code when customer enters it:

```typescript
// In checkout page or component
import { validateReferralCode } from '@/lib/affiliate/api';
import type { ReferralCode } from '@/lib/supabase';

// State for referral code
const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);

// Validate and store code
const handleReferralCodeChange = async (code: string) => {
  const validated = await validateReferralCode(code);
  if (validated) {
    setReferralCode(validated);
  }
};
```

### Step 2: Create Commission After Successful Order

```typescript
// In your order processing function
import { createCommission } from '@/lib/affiliate/api';

async function processOrder(orderData: any, referralCode: ReferralCode | null) {
  try {
    // 1. Process payment
    const payment = await processPayment(orderData);

    // 2. Create order in your system
    const order = await createOrder({
      ...orderData,
      paymentId: payment.id,
      total: calculateTotal(orderData.items),
    });

    // 3. Create commission if referral code was used
    if (referralCode && order.id) {
      const commissionResult = await createCommission({
        affiliateId: referralCode.affiliate_id,
        orderId: order.id,
        orderTotal: order.total,
        referralCodeId: referralCode.id,
        commissionRate: 10, // 10% commission
      });

      if (!commissionResult.success) {
        console.error('Failed to create commission:', commissionResult.error);
        // Note: Don't fail the order if commission fails
        // Just log the error and investigate later
      }
    }

    return { success: true, order };
  } catch (error) {
    console.error('Order processing error:', error);
    return { success: false, error };
  }
}
```

### Step 3: Store Referral Code with Order (Optional)

You may want to store the referral code in your orders table:

```sql
-- Add to your orders table
ALTER TABLE orders ADD COLUMN referral_code VARCHAR(8);
ALTER TABLE orders ADD COLUMN affiliate_id UUID;
```

Then update your order creation:

```typescript
const order = await createOrder({
  ...orderData,
  referralCode: referralCode?.code || null,
  affiliateId: referralCode?.affiliate_id || null,
});
```

## URL Tracking Example

If you want to track referrals from the homepage to checkout:

```typescript
// In your main layout or a tracking context
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export function ReferralTracker() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) {
      // Store in session/local storage
      sessionStorage.setItem('referralCode', refCode.toUpperCase());
    }
  }, [searchParams]);

  return null;
}

// Then in checkout, retrieve it:
const storedCode = sessionStorage.getItem('referralCode');
if (storedCode) {
  await validateReferralCode(storedCode);
}
```

## Testing the Integration

### Test Flow:
1. Create test affiliate account at `/affiliate/signup`
2. Get referral code from `/affiliate/code`
3. Visit checkout with `?ref=YOUR_CODE`
4. Complete a test order
5. Check affiliate dashboard - commission should appear as "pending"
6. Query Supabase commissions table to verify

### SQL to Verify:
```sql
-- Check if commission was created
SELECT * FROM commissions
WHERE order_id = 'your-test-order-id';

-- Check affiliate stats updated
SELECT
  a.first_name,
  a.last_name,
  rc.code,
  rc.uses_count,
  COUNT(c.id) as commission_count,
  SUM(c.amount) as total_commissions
FROM affiliates a
JOIN referral_codes rc ON rc.affiliate_id = a.id
LEFT JOIN commissions c ON c.affiliate_id = a.id
WHERE a.email = 'test@example.com'
GROUP BY a.id, rc.id;
```

## Commission Calculation

The commission is automatically calculated as 10% of order total:

```typescript
// In lib/affiliate/utils.ts
export function calculateCommission(orderTotal: number, commissionRate: number = 10): number {
  return Number((orderTotal * (commissionRate / 100)).toFixed(2));
}
```

Example:
- Order Total: $500.00
- Commission Rate: 10%
- Commission Amount: $50.00

## Error Handling

Always wrap commission creation in try-catch:

```typescript
try {
  if (referralCode) {
    await createCommission({
      affiliateId: referralCode.affiliate_id,
      orderId: order.id,
      orderTotal: order.total,
      referralCodeId: referralCode.id,
    });
  }
} catch (error) {
  // Log error but don't fail the order
  console.error('Commission creation failed:', error);
  // Optionally: Send alert to admin
  // await sendAdminAlert('Commission creation failed', { orderId: order.id, error });
}
```

## Payment Processing

### Mark Commission as Paid

When you pay an affiliate:

```typescript
// Update commission status
const { error } = await supabase
  .from('commissions')
  .update({
    status: 'paid',
    paid_at: new Date().toISOString(),
  })
  .eq('id', commissionId);

// This triggers the database function that updates affiliate.total_earnings
```

### Cancel a Commission

If an order is refunded or cancelled:

```typescript
const { error } = await supabase
  .from('commissions')
  .update({ status: 'cancelled' })
  .eq('order_id', orderId);
```

## Webhook Integration (Optional)

If you use webhooks for order processing:

```typescript
// Example webhook handler
export async function POST(request: Request) {
  const payload = await request.json();

  if (payload.event === 'order.completed') {
    const order = payload.order;
    const referralCode = order.metadata?.referralCode;

    if (referralCode) {
      const validated = await validateReferralCode(referralCode);
      if (validated) {
        await createCommission({
          affiliateId: validated.affiliate_id,
          orderId: order.id,
          orderTotal: order.total,
          referralCodeId: validated.id,
        });
      }
    }
  }

  return Response.json({ received: true });
}
```

## Admin Dashboard (Future Enhancement)

You may want to create an admin page to:
- View all pending commissions
- Approve/reject commissions
- Process bulk payments
- View top affiliates

Example query for admin dashboard:

```sql
-- Top affiliates by earnings
SELECT
  a.email,
  a.first_name,
  a.last_name,
  COUNT(c.id) as total_commissions,
  SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END) as paid_earnings,
  SUM(CASE WHEN c.status = 'pending' THEN c.amount ELSE 0 END) as pending_earnings,
  SUM(rc.uses_count) as total_referrals
FROM affiliates a
LEFT JOIN referral_codes rc ON rc.affiliate_id = a.id
LEFT JOIN commissions c ON c.affiliate_id = a.id
GROUP BY a.id
ORDER BY paid_earnings DESC
LIMIT 10;
```

## Quick Checklist

- [ ] Import createCommission function
- [ ] Validate referral code on checkout
- [ ] Store validated code in state/session
- [ ] Call createCommission after successful order
- [ ] Handle errors gracefully
- [ ] Test with real order flow
- [ ] Verify commission appears in affiliate dashboard
- [ ] Set up commission payment process

---

**Need help?** Check AFFILIATE_SETUP.md for full documentation.
