import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { verifyWarehouse } from "../../route";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Packed-product photos live in a public bucket under a `packing/<invoice>/`
// prefix. Defaults to the dedicated `packages` bucket (create it via
// warehouse-packages-bucket-migration.sql); override with
// WAREHOUSE_PHOTOS_BUCKET to point at a different bucket.
const BUCKET = process.env.WAREHOUSE_PHOTOS_BUCKET || "packages";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

interface PackedPhoto {
  url: string;
  path: string;
  uploaded_at: string;
}

// POST /api/warehouse/queue/:id/photo — upload a photo of the packed products.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Images only." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size exceeds 20MB limit" }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `packing/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });
    if (upErr) {
      console.error("packed photo upload failed:", upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const photo: PackedPhoto = { url: publicUrl, path, uploaded_at: new Date().toISOString() };

    // Append to the invoice's packed_photos array.
    const { data: inv } = await supabase
      .from("invoices")
      .select("packed_photos")
      .eq("id", id)
      .single();
    const current: PackedPhoto[] = Array.isArray(inv?.packed_photos) ? inv!.packed_photos : [];
    const next = [...current, photo];
    const { error: saveErr } = await supabase
      .from("invoices")
      .update({ packed_photos: next })
      .eq("id", id);
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "invoice.packed_photo_add",
      entity_type: "invoice",
      entity_id: id,
      payload: { path },
    });

    return NextResponse.json({ photo, packed_photos: next });
  } catch (e: any) {
    console.error("packed photo error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/warehouse/queue/:id/photo — remove a packed photo by path.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const path = body?.path as string | undefined;
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  await supabase.storage.from(BUCKET).remove([path]).then(undefined, () => {});

  const { data: inv } = await supabase
    .from("invoices")
    .select("packed_photos")
    .eq("id", id)
    .single();
  const current: PackedPhoto[] = Array.isArray(inv?.packed_photos) ? inv!.packed_photos : [];
  const next = current.filter((p) => p.path !== path);
  const { error } = await supabase
    .from("invoices")
    .update({ packed_photos: next })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.packed_photo_remove",
    entity_type: "invoice",
    entity_id: id,
    payload: { path },
  });

  return NextResponse.json({ ok: true, packed_photos: next });
}
