import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canEditProductDescriptors } from '@/lib/permissions';
import { recordAudit } from '@/lib/admin/recordAudit';

// Verify environment variables are set
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Helper function to verify admin role
async function verifyAdminRole(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return { authorized: false, role: 'customer' as const };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, role: 'customer' as const, userId: null };
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = customer?.role || 'customer';

    // Product images are a descriptor, so descriptor editors (admins + analytics
    // accounts) may upload/replace them — not just those who can create products.
    return { authorized: canEditProductDescriptors(role), role, userId: user.id };
  } catch (error) {
    console.error('Error verifying admin role:', error);
    return { authorized: false, role: 'customer' as const, userId: null };
  }
}

// POST: Upload product image to Supabase Storage
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images (JPEG, PNG, WebP, GIF) are allowed' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 20MB limit' },
        { status: 400 }
      );
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    // Convert File to ArrayBuffer then to Buffer for Supabase
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage using service role (bypasses RLS)
    const { data, error } = await supabase.storage
      .from('products')
      .upload(fileName, buffer, {
        // Filenames are content-unique (timestamp + random), so they can be
        // cached aggressively — a year, immutable — for fast repeat loads.
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      });

    if (error) {
      console.error('Error uploading to Supabase Storage:', error);
      console.error('Storage error details:', {
        message: error.message,
        name: error.name,
        cause: error.cause,
      });

      // Provide more helpful error messages
      if (error.message.includes('row-level security') || error.message.includes('RLS')) {
        return NextResponse.json({
          error: 'Storage bucket not configured. Please run storage-products-bucket-setup.sql in Supabase SQL Editor.'
        }, { status: 500 });
      }
      if (error.message.includes('Bucket not found')) {
        return NextResponse.json({
          error: 'Products storage bucket does not exist. Please run storage-products-bucket-setup.sql in Supabase SQL Editor.'
        }, { status: 500 });
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('products')
      .getPublicUrl(data.path);

    await recordAudit({
      supabase,
      actorId: userId,
      action: 'product.image_add',
      entityType: 'product',
      payload: { path: data.path, size: file.size, content_type: file.type },
    });

    return NextResponse.json({
      url: publicUrl,
      path: data.path,
      fileName: fileName,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE: Remove product image from Supabase Storage
export async function DELETE(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (!path) {
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 });
    }

    const { error } = await supabase.storage
      .from('products')
      .remove([path]);

    if (error) {
      console.error('Error deleting from Supabase Storage:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await recordAudit({
      supabase,
      actorId: userId,
      action: 'product.image_remove',
      entityType: 'product',
      payload: { path },
    });

    return NextResponse.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
