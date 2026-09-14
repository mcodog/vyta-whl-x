import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PO_STATUS_META } from "@/lib/admin/po-status";
import { computeLandedCosts } from "@/lib/admin/po-landed-cost";
import type { PurchaseOrderStatus } from "@/lib/supabase";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdminRead(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = customer?.role || "customer";
  return role === "admin" || role === "assistant";
}

const escape = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRead(request))) {
    return new NextResponse("Unauthorized", { status: 403 });
  }
  const { id } = await ctx.params;
  // Prepaid supplier POs are sent to the supplier without our costs: hide every
  // price column and the totals block, leaving only SKU / description / qty.
  const hidePrices = request.nextUrl.searchParams.get("prices") === "hidden";

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(`*, supplier:suppliers (*), items:purchase_order_items (*)`)
    .eq("id", id)
    .single();
  if (error || !po) return new NextResponse("Not found", { status: 404 });

  const meta = PO_STATUS_META[po.status as PurchaseOrderStatus];
  const issueDate = new Date(po.created_at).toLocaleDateString();
  const orderDate = po.order_date
    ? new Date(po.order_date).toLocaleDateString()
    : "—";
  const expected = po.expected_date
    ? new Date(po.expected_date).toLocaleDateString()
    : "—";
  const taxLabel =
    po.tax_type === "percentage" ? `Tax (${Number(po.tax_value)}%)` : "Tax";
  const discountLabel =
    po.discount_type === "percentage"
      ? `Discount (${Number(po.discount_value)}%)`
      : "Discount";

  // Landed unit cost per line — computed live from the stored PO totals so it's
  // correct even for POs created before landed cost was recorded. `po.discount`
  // is already the resolved dollar amount.
  const items = (po.items ?? []) as any[];
  const landed = computeLandedCosts({
    lines: items.map((it) => ({ qty: Number(it.qty), unit_price: Number(it.unit_price) })),
    shippingFee: Number(po.shipping_fee ?? 0),
    discountAmount: Number(po.discount ?? 0),
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(po.po_number)} — Purchase Order</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #07203A; margin: 0; padding: 32px; background: #fff; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #07203A; padding-bottom: 16px; }
  .brand h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: 0.04em; }
  .brand p { margin: 0; font-size: 11px; color: #4E6E85; }
  .doc { text-align: right; }
  .doc h2 { margin: 0 0 4px; font-size: 18px; }
  .doc .num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #4E6E85; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px;
          font-size: 11px; font-weight: 600; margin-top: 8px;
          background: ${meta.pdfBg}; color: ${meta.pdfFg}; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
          margin-top: 20px; padding: 16px 0; border-bottom: 1px solid #D5E2E7; }
  .meta h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
             letter-spacing: 0.1em; color: #4E6E85; }
  .meta p { margin: 0; font-size: 13px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase;
       letter-spacing: 0.08em; color: #4E6E85; padding: 10px 8px;
       border-bottom: 1px solid #D5E2E7; }
  td { padding: 10px 8px; border-bottom: 1px solid #EFF5F7; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 12px; margin-left: auto; width: 280px; font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .row.total { border-top: 1px solid #07203A; margin-top: 6px;
                       padding-top: 10px; font-weight: 700; font-size: 15px; }
  .notes { margin-top: 24px; padding: 14px 16px; background: #F7FAFB;
           border-radius: 8px; font-size: 12px; line-height: 1.5; }
  .notes h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
              letter-spacing: 0.1em; color: #4E6E85; }
  .foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid #D5E2E7;
          display: flex; justify-content: space-between; font-size: 11px; color: #4E6E85; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div class="brand">
      <h1>VYTA</h1>
      <p class="brandsub">BIOSCIENCES</p>
      <p>puramass.com · info@aminocan.com</p>
    </div>
    <div class="doc">
      <h2>Purchase Order</h2>
      <div class="num">${escape(po.po_number)}</div>
      <div class="pill">${escape(meta.label)}</div>
    </div>
  </div>

  <div class="meta">
    <div>
      <h3>Supplier</h3>
      <p><strong>${escape(po.supplier?.name)}</strong></p>
      ${po.supplier?.contact_person ? `<p>${escape(po.supplier.contact_person)}</p>` : ""}
      ${po.supplier?.email ? `<p>${escape(po.supplier.email)}</p>` : ""}
      ${po.supplier?.phone ? `<p>${escape(po.supplier.phone)}</p>` : ""}
    </div>
    <div>
      <h3>Dates</h3>
      <p>Order date: ${escape(orderDate)}</p>
      <p>Issued: ${escape(issueDate)}</p>
      <p>Expected: ${escape(expected)}</p>
    </div>
    <div>
      <h3>Issued By</h3>
      <p>VYTA Biosciences Procurement</p>
      <p class="num">PO #${escape(po.po_number)}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>SKU</th>
        <th class="num">Qty</th>
        ${hidePrices ? "" : `
        <th class="num">Unit Price</th>
        <th class="num">Landed / unit</th>
        <th class="num">Total</th>`}
      </tr>
    </thead>
    <tbody>
      ${items.map((it: any, idx: number) => `
        <tr>
          <td>${escape(it.description)}</td>
          <td>${escape(it.sku_snapshot ?? "—")}</td>
          <td class="num">${it.qty}</td>
          ${hidePrices ? "" : `
          <td class="num">${money(it.unit_price)}</td>
          <td class="num">${money(landed[idx]?.landedUnitCost ?? it.unit_price)}</td>
          <td class="num">${money(it.line_total)}</td>`}
        </tr>`).join("")}
    </tbody>
  </table>
  ${hidePrices ? `
  <p style="margin-top:8px;font-size:10px;color:#4E6E85;">
    Total units: ${items.reduce((s: number, it: any) => s + Number(it.qty || 0), 0)} · Line count: ${items.length}
  </p>` : `
  <p style="margin-top:8px;font-size:10px;color:#4E6E85;">
    Landed / unit includes each line's share of shipping and discount, allocated by value — the true per-unit cost.
  </p>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${money(po.subtotal)}</span></div>
    <div class="row"><span>Shipping fee</span><span>${money(po.shipping_fee)}</span></div>
    <div class="row"><span>${escape(discountLabel)}</span><span>-${money(po.discount)}</span></div>
    <div class="row"><span>${escape(taxLabel)}</span><span>${money(po.tax_total)}</span></div>
    <div class="row total"><span>Total</span><span>${money(po.total)}</span></div>
  </div>`}

  ${po.notes ? `<div class="notes"><h3>Notes</h3>${escape(po.notes).replace(/\n/g, "<br/>")}</div>` : ""}

  <div class="foot">
    <span>VYTA BIOSCIENCES · puramass.com</span>
    <span>Generated ${escape(new Date().toLocaleString())} · ${escape(po.po_number)}</span>
  </div>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
