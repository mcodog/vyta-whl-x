import { INVOICE_STATUS_META, effectiveStatus } from '@/lib/admin/invoice-status';
import type { InvoiceStatus } from '@/lib/supabase';

const escape = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;

/**
 * Resolve the SKU for an invoice line item. Falls back from a stored `sku` to
 * the joined product's SKU, so it works whether or not the query nested the
 * product relation.
 */
export function lineItemSku(li: {
  sku?: string | null;
  product?: { sku?: string | null } | null;
}): string {
  return (li.sku ?? li.product?.sku ?? '').toString();
}

/**
 * Vials-per-box rate for a line item, resolved from the joined product with a
 * default of 10. Only meaningful for box-priced lines.
 */
export function lineItemVialsPerBox(li: {
  vials_per_box?: number | null;
  product?: { vials_per_box?: number | null } | null;
}): number {
  const per = li.vials_per_box ?? li.product?.vials_per_box;
  return per && per > 0 ? per : 10;
}

/**
 * Total vials a line item represents. Box lines multiply their quantity by the
 * vials-per-box rate; vial lines are already counted in vials. This is the
 * amount that moves on/off `products.stock_quantity` when the invoice is
 * paid/cancelled.
 */
export function lineItemVialCount(li: {
  qty: number;
  price_type?: 'box' | 'vial' | null;
  vials_per_box?: number | null;
  product?: { vials_per_box?: number | null } | null;
}): number {
  const qty = Number(li.qty) || 0;
  return li.price_type === 'vial' ? qty : qty * lineItemVialsPerBox(li);
}

export interface InvoiceForHtml {
  invoice_number: string;
  status: InvoiceStatus;
  due_date: string;
  issue_date: string;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  /** Items ship to the customer's client (Packing List flow). */
  ships_to_client?: boolean | null;
  /** The end-recipient this invoice ships to, when ships_to_client. */
  client?: {
    first_name?: string | null;
    last_name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  sales_person?: {
    first_name: string;
    last_name: string;
    email?: string | null;
  } | null;
  /**
   * Every sales person credited on the invoice (up to five), primary first.
   * Falls back to the single `sales_person` above for rows written before an
   * invoice could carry more than one.
   */
  sales_people?: Array<{
    position?: number;
    sales_person?: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
    } | null;
  }> | null;
  line_items?: Array<{
    id?: string;
    product_id?: string | null;
    description: string;
    sku?: string | null;
    product?: { sku?: string | null } | null;
    price_type?: 'box' | 'vial' | null;
    qty: number;
    unit_price: number;
    discount_pct: number;
    line_total: number;
  }>;
  payments?: Array<{
    id?: string;
    paid_at: string;
    method: string;
    reference_note?: string | null;
    amount: number;
  }>;
  subtotal: number;
  tax_rate: number;
  tax_total: number;
  shipping_cost: number;
  processing_fee?: number | null;
  show_processing_fee?: boolean | null;
  total: number;
  currency?: string | null;
  with_labels?: boolean | null;
  notes?: string | null;
}

export function buildInvoiceHtml(
  inv: InvoiceForHtml,
  opts: { autoPrint?: boolean } = {},
): string {
  const status = effectiveStatus(inv.status, inv.due_date);
  const meta = INVOICE_STATUS_META[status];

  const amount_paid = (inv.payments ?? []).reduce(
    (s, p) => s + Number(p.amount),
    0,
  );
  const amount_due = Math.max(0, Number(inv.total) - amount_paid);

  const customerName =
    inv.customer_name ||
    (inv.customer
      ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(' ')
      : 'Customer');
  const customerEmail = inv.customer_email ?? inv.customer?.email ?? '';
  const customerPhone = inv.customer_phone ?? inv.customer?.phone ?? '';
  const currencyCode = inv.currency === 'USD' ? 'USD' : 'CAD';
  const labelsText = inv.with_labels === false ? 'Without labels' : 'With labels';
  const showProcessingFee =
    inv.show_processing_fee !== false && Number(inv.processing_fee ?? 0) > 0;

  // Client shipment (Packing List flow): the invoice bills the customer, but the
  // parcel ships to the customer's client. Show the client's ship-to address.
  const client = inv.ships_to_client ? inv.client : null;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ')
    : '';
  const clientCityLine = client
    ? [client.city, client.state, client.postal_code].filter(Boolean).join(', ')
    : '';
  // Sales people on the document: the full roster when the invoice carries one,
  // otherwise the single primary (invoices raised before rosters existed). Only
  // names and emails are printed — commission is internal and never shown to
  // the customer.
  type DocumentSalesPerson = {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  const rosterPeople: DocumentSalesPerson[] = [...(inv.sales_people ?? [])]
    .sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0))
    .map((r) => r.sales_person)
    .filter((sp): sp is DocumentSalesPerson => Boolean(sp));
  const salesPeople: DocumentSalesPerson[] =
    rosterPeople.length > 0 ? rosterPeople : inv.sales_person ? [inv.sales_person] : [];
  const salesPeopleBlock = salesPeople.length > 0
    ? `<div>
      <h3>Sales ${salesPeople.length > 1 ? 'People' : 'Person'}</h3>
      ${salesPeople
        .map(
          (sp) =>
            `<p><strong>${escape([sp.first_name, sp.last_name].filter(Boolean).join(' '))}</strong></p>` +
            (sp.email ? `<p>${escape(sp.email)}</p>` : ''),
        )
        .join('')}
    </div>`
    : '<div></div>';

  const shipToBlock = client
    ? `<div class="parties" style="margin-top: 16px;">
    <div>
      <h3>Ship To (Client)</h3>
      ${clientName ? `<p><strong>${escape(clientName)}</strong></p>` : ''}
      ${client.address ? `<p>${escape(client.address)}</p>` : ''}
      ${clientCityLine ? `<p>${escape(clientCityLine)}</p>` : ''}
      ${client.country ? `<p>${escape(client.country)}</p>` : ''}
      ${client.phone ? `<p>${escape(client.phone)}</p>` : ''}
      ${client.email ? `<p>${escape(client.email)}</p>` : ''}
    </div>
    <div></div>
  </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(inv.invoice_number)} — Invoice</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #07203A; margin: 0; padding: 32px; background: #fff; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #07203A; padding-bottom: 16px; }
  .brand h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.28em; color: #07203A; }
  .brand .brandsub { margin: 4px 0 6px; font-size: 9px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; }
  .brand p { margin: 0; font-size: 11px; color: #4E6E85; }
  .doc { text-align: right; }
  .doc h2 { margin: 0 0 4px; font-size: 18px; }
  .doc .num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #4E6E85; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px;
          font-size: 11px; font-weight: 600; margin-top: 8px;
          background: ${meta.pdfBg}; color: ${meta.pdfFg}; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 20px; }
  .parties h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
                letter-spacing: 0.1em; color: #4E6E85; }
  .parties p { margin: 0; font-size: 13px; line-height: 1.55; }
  .dates { margin-top: 20px; background: #F7FAFB; border-radius: 8px;
           display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 0; padding: 12px 16px; }
  .dates .cell { font-size: 12px; }
  .dates .cell strong { display: block; font-size: 10px; text-transform: uppercase;
                        letter-spacing: 0.08em; color: #4E6E85; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase;
       letter-spacing: 0.08em; color: #4E6E85; padding: 10px 8px;
       border-bottom: 1px solid #D5E2E7; }
  td { padding: 10px 8px; border-bottom: 1px solid #EFF5F7; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.sku { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px;
           color: #4E6E85; white-space: nowrap; }
  .unit-tag { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 4px;
              font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
              vertical-align: middle; }
  .unit-tag.vial { background: #EEF0FF; color: #4B4FC4; }
  .unit-tag.box { background: #F3EFE3; color: #438B9E; }
  .totals { margin-top: 12px; margin-left: auto; width: 300px; font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .row.total { border-top: 1px solid #07203A; margin-top: 6px;
                       padding-top: 10px; font-weight: 700; font-size: 15px; }
  .totals .row.due { color: #438B9E; font-weight: 600; }
  .payments { margin-top: 24px; }
  .payments h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
                 letter-spacing: 0.1em; color: #4E6E85; }
  .payments li { font-size: 12px; padding: 4px 0; list-style: none; display: flex;
                 justify-content: space-between; border-bottom: 1px dashed #D5E2E7; }
  .notes { margin-top: 24px; padding: 14px 16px; background: #F7FAFB;
           border-radius: 8px; font-size: 12px; line-height: 1.5; }
  .notes h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase;
              letter-spacing: 0.1em; color: #4E6E85; }
  .foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid #D5E2E7;
          display: flex; justify-content: space-between; font-size: 11px; color: #4E6E85; }
  @media print { body { padding: 0; } }
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
      <h2>Invoice</h2>
      <div class="num">${escape(inv.invoice_number)}</div>
      <div class="pill">${escape(meta.label)}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <h3>Bill To</h3>
      <p><strong>${escape(customerName)}</strong></p>
      ${customerEmail ? `<p>${escape(customerEmail)}</p>` : ''}
      ${customerPhone ? `<p>${escape(customerPhone)}</p>` : ''}
    </div>
    ${salesPeopleBlock}
  </div>
  ${shipToBlock}

  <div class="dates">
    <div class="cell"><strong>Issue Date</strong>${escape(new Date(inv.issue_date).toLocaleDateString())}</div>
    <div class="cell"><strong>Due Date</strong>${escape(new Date(inv.due_date).toLocaleDateString())}</div>
    <div class="cell"><strong>Invoice #</strong>${escape(inv.invoice_number)}</div>
    <div class="cell"><strong>Currency</strong>${escape(currencyCode)}</div>
    <div class="cell"><strong>Labels</strong>${escape(labelsText)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Disc %</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${(inv.line_items ?? []).map((li) => `
        <tr>
          <td class="sku">${escape(lineItemSku(li) || '—')}</td>
          <td>${escape(li.description)}<span class="unit-tag ${li.price_type === 'vial' ? 'vial' : 'box'}">${li.price_type === 'vial' ? 'Vial' : 'Box'}</span></td>
          <td class="num">${li.qty}</td>
          <td class="num">${money(li.unit_price)}</td>
          <td class="num">${Number(li.discount_pct) || 0}%</td>
          <td class="num">${money(li.line_total)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
    <div class="row"><span>Tax (${Number(inv.tax_rate) || 0}%)</span><span>${money(inv.tax_total)}</span></div>
    <div class="row"><span>Shipping</span><span>${money(inv.shipping_cost)}</span></div>
    ${showProcessingFee ? `<div class="row"><span>Processing Fee</span><span>${money(Number(inv.processing_fee ?? 0))}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${money(inv.total)} ${escape(currencyCode)}</span></div>
    ${amount_paid > 0 ? `<div class="row"><span>Paid</span><span>− ${money(amount_paid)}</span></div>` : ''}
    <div class="row due"><span>Amount Due</span><span>${money(amount_due)} ${escape(currencyCode)}</span></div>
  </div>

  ${(inv.payments ?? []).length > 0 ? `<div class="payments">
    <h3>Payment History</h3>
    <ul>
      ${(inv.payments ?? []).map((p) => `<li>
        <span>${escape(new Date(p.paid_at).toLocaleDateString())} · ${escape(p.method)}${p.reference_note ? ` (${escape(p.reference_note)})` : ''}</span>
        <span>${money(p.amount)}</span>
      </li>`).join('')}
    </ul>
  </div>` : ''}

  ${inv.notes ? `<div class="notes"><h3>Notes</h3>${escape(inv.notes).replace(/\n/g, '<br/>')}</div>` : ''}

  <div class="foot">
    <span>Thank you for your business.</span>
    <span>Generated ${escape(new Date().toLocaleString())}</span>
  </div>
</div>
${opts.autoPrint ? `<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 300); });</script>` : ''}
</body>
</html>`;
}
