import { supabase } from '@/lib/supabase';
import type { Customer, Order, OrderItem } from '@/lib/supabase';

/**
 * Sign up a new customer using Supabase Auth
 */
export async function signUpCustomer(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  referralCode?: string;
}): Promise<{ success: boolean; error?: string }> {
  // Phone is required at registration.
  if (!data.phone?.trim()) {
    return { success: false, error: 'Phone number is required' };
  }

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
      },
    },
  });

  if (authError) {
    console.error('Auth signup error:', authError);
    return { success: false, error: authError.message };
  }

  if (!authData.user) {
    return { success: false, error: 'Failed to create account' };
  }

  // Resolve a referral code to its affiliate (first-touch binding).
  let affiliateId: string | null = null;
  if (data.referralCode) {
    const { data: refCode } = await supabase
      .from('referral_codes')
      .select('affiliate_id')
      .eq('code', data.referralCode.toUpperCase())
      .eq('active', true)
      .maybeSingle();
    // Guard against self-referral (an affiliate can't refer their own account).
    if (refCode && refCode.affiliate_id !== authData.user.id) {
      affiliateId = refCode.affiliate_id;
    }
  }

  // Create customer profile linked to auth user
  const { error: profileError } = await supabase.from('customers').insert({
    id: authData.user.id,
    email: data.email.toLowerCase(),
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone.trim(),
    affiliate_id: affiliateId,
  });

  if (profileError) {
    console.error('Profile creation error:', profileError);
    // Auth user created but profile failed - still return success
    // Profile can be created on first login
  }

  // Notify admins that a new customer registered (best-effort; never blocks
  // signup). The server route verifies the account before emailing.
  try {
    await fetch('/api/customers/notify-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: authData.user.id,
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      }),
    });
  } catch (notifyError) {
    console.error('Failed to trigger new-customer admin notification:', notifyError);
  }

  return { success: true };
}

/**
 * Sign in customer using Supabase Auth
 */
export async function signInCustomer(
  email: string,
  password: string
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Auth signin error:', error);
    return { success: false, error: error.message };
  }

  if (!data.user) {
    return { success: false, error: 'Login failed' };
  }

  // Get customer profile
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', data.user.id)
    .single();

  // Block deactivated accounts
  if (customer && customer.active === false) {
    await supabase.auth.signOut();
    return { success: false, error: 'This account has been deactivated. Please contact support.' };
  }

  // If no profile exists, create one from auth metadata
  if (!customer) {
    const { data: newCustomer } = await supabase
      .from('customers')
      .insert({
        id: data.user.id,
        email: data.user.email?.toLowerCase(),
        first_name: data.user.user_metadata?.first_name || '',
        last_name: data.user.user_metadata?.last_name || '',
      })
      .select()
      .single();

    return { success: true, customer: newCustomer || undefined };
  }

  return { success: true, customer };
}

/**
 * Sign out customer
 */
export async function signOutCustomer(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Get current session
 */
export async function getCurrentSession(): Promise<Customer | null> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.user) return null;

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return customer;
}

/**
 * Get customer by ID
 */
export async function getCustomer(customerId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error) {
    console.error('Error fetching customer:', error);
    return null;
  }

  return data;
}

/**
 * Update customer profile
 */
export async function updateCustomer(
  customerId: string,
  updates: Partial<Omit<Customer, 'id' | 'created_at' | 'password_hash'>>
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('customers')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      console.error('Error updating customer:', error);
      return { success: false, error: 'Failed to update profile' };
    }

    return { success: true, customer: data };
  } catch (error) {
    console.error('Error in updateCustomer:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get all orders for a customer
 */
export async function getCustomerOrders(customerId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching orders:', error);
    return [];
  }

  return data || [];
}

/**
 * Get order with its items
 */
export async function getOrderWithItems(
  orderId: string
): Promise<{ order: Order; items: (OrderItem & { product_name?: string; product_strength?: string })[] } | null> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error('Error fetching order:', orderError);
    return null;
  }

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('Error fetching order items:', itemsError);
    return { order, items: [] };
  }

  return { order, items: items || [] };
}

/**
 * Generate a unique order number
 */
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `NP-${timestamp}-${random}`;
}

/**
 * Create a new order from cart
 */
export async function createOrder(data: {
  customerId: string;
  items: Array<{ id: string; name: string; price: number; quantity: number; strength: string }>;
  totalAmount: number;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
  referralCode?: string;
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    const orderNumber = generateOrderNumber();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: data.customerId,
        order_number: orderNumber,
        status: 'pending',
        total: data.totalAmount,
        items: data.items.map(i => ({ name: i.name || '', quantity: i.quantity, price: i.price })),
        crypto: 'btc' as const,
        shipping_address: { firstName: '', lastName: '', address: data.shippingAddress, city: data.shippingCity, state: data.shippingState, postalCode: data.shippingPostalCode, country: data.shippingCountry },
        referral_code: data.referralCode || null,
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error('Error creating order:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    const orderItems = data.items.map((item) => ({
      order_id: order.id,
      product_name: item.name || 'Product',
      product_id: item.id,
      quantity: item.quantity,
      price_at_time: item.price,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    if (itemsError) {
      console.error('Error creating order items:', itemsError);
    }

    // Create commission if referral code
    if (data.referralCode) {
      const { data: refCode } = await supabase
        .from('referral_codes')
        .select('id, affiliate_id')
        .eq('code', data.referralCode.toUpperCase())
        .eq('active', true)
        .single();

      if (refCode) {
        const commissionAmount = data.totalAmount * 0.1;
        await supabase.from('commissions').insert({
          affiliate_id: refCode.affiliate_id,
          order_id: order.id,
          referral_code_id: refCode.id,
          amount: commissionAmount,
          order_total: data.totalAmount,
          commission_rate: 10,
          status: 'pending',
        });
      }
    }

    return { success: true, order };
  } catch (error) {
    console.error('Error in createOrder:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
