import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/stock-notifications?product_id=&email=
 * Customer-facing: report whether an email is already on a product's waitlist.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const productId = params.get('product_id');
    const rawEmail = params.get('email');

    if (!productId || !rawEmail) {
      return NextResponse.json({ error: 'product_id and email are required' }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ subscribed: false });
    }

    const { data } = await supabase
      .from('stock_notifications')
      .select('id')
      .eq('product_id', productId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    return NextResponse.json({ subscribed: !!data });
  } catch (error) {
    console.error('Unexpected error in stock-notifications GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/stock-notifications
 * Customer-facing: remove an email from a product's waitlist.
 * Body: { product_id: string, email: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const productId: string | undefined = body.product_id;
    const rawEmail: string | undefined = body.email;

    if (!productId || !rawEmail) {
      return NextResponse.json({ error: 'product_id and email are required' }, { status: 400 });
    }

    const email = String(rawEmail).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    const { error } = await supabase
      .from('stock_notifications')
      .update({ status: 'cancelled' })
      .eq('product_id', productId)
      .eq('email', email)
      .eq('status', 'pending');

    if (error) {
      console.error('Error cancelling stock notification:', error);
      return NextResponse.json({ error: 'Could not remove your alert' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in stock-notifications DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/stock-notifications
 * Customer-facing: subscribe an email to be notified when a product is restocked.
 * Body: { product_id: string, email: string, customer_id?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const productId: string | undefined = body.product_id;
    const rawEmail: string | undefined = body.email;
    const customerId: string | null = body.customer_id || null;

    if (!productId || !rawEmail) {
      return NextResponse.json({ error: 'product_id and email are required' }, { status: 400 });
    }

    const email = String(rawEmail).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    // Confirm the product exists.
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Idempotent: a pending request for this product/email already counts.
    const { data: existing } = await supabase
      .from('stock_notifications')
      .select('id')
      .eq('product_id', productId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, alreadySubscribed: true });
    }

    const { error: insertError } = await supabase.from('stock_notifications').insert({
      product_id: productId,
      customer_id: customerId,
      email,
      status: 'pending',
    });

    if (insertError) {
      // Unique index race -> treat as already subscribed.
      if (insertError.code === '23505') {
        return NextResponse.json({ success: true, alreadySubscribed: true });
      }
      console.error('Error creating stock notification:', insertError);
      return NextResponse.json({ error: 'Could not save your request' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in stock-notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
