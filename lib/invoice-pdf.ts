import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '@/lib/pdf-footer';
import { INVOICE_STATUS_META, effectiveStatus } from '@/lib/admin/invoice-status';
import { lineItemSku, type InvoiceForHtml } from '@/lib/admin/invoice-html';

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

const COLORS = {
  ink: '#07203A',
  muted: '#5B7A8C',
  faint: '#8FA9B6',
  rule: '#D5E2E7',
  rowRule: '#EFF5F7',
  surface: '#F7FAFB',
  vital: '#438B9E',
  indigo: '#4B4FC4',
};

type PDFDoc = InstanceType<typeof PDFDocument>;

interface DrawContext {
  doc: PDFDoc;
  inv: InvoiceForHtml;
  pageWidth: number;
  contentWidth: number;
  marginLeft: number;
  marginRight: number;
}

function drawHeader(ctx: DrawContext): void {
  const { doc, inv, marginLeft, marginRight } = ctx;
  const status = effectiveStatus(inv.status, inv.due_date);
  const meta = INVOICE_STATUS_META[status];
  const top = doc.y;

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('VYTA', marginLeft, top, { lineBreak: false, characterSpacing: 4 });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text('BIOSCIENCES  ·  puramass.com  ·  info@aminocan.com', marginLeft, doc.y + 2, {
      characterSpacing: 0.4,
    });

  // Right-aligned doc info
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Invoice', marginLeft, top, {
      align: 'right',
      width: marginRight - marginLeft,
    });
  doc
    .fillColor(COLORS.muted)
    .font('Courier')
    .fontSize(11)
    .text(inv.invoice_number, marginLeft, doc.y + 2, {
      align: 'right',
      width: marginRight - marginLeft,
    });

  // Status pill (right-aligned)
  const label = meta.label;
  const pillFontSize = 9;
  doc.font('Helvetica-Bold').fontSize(pillFontSize);
  const pillTextWidth = doc.widthOfString(label);
  const pillPadX = 8;
  const pillW = pillTextWidth + pillPadX * 2;
  const pillH = 16;
  const pillY = doc.y + 4;
  const pillX = marginRight - pillW;
  doc
    .roundedRect(pillX, pillY, pillW, pillH, 8)
    .fill(meta.pdfBg);
  doc
    .fillColor(meta.pdfFg)
    .text(label, pillX + pillPadX, pillY + 3, { lineBreak: false });

  // Rule
  const ruleY = pillY + pillH + 10;
  doc
    .moveTo(marginLeft, ruleY)
    .lineTo(marginRight, ruleY)
    .lineWidth(1.5)
    .strokeColor(COLORS.ink)
    .stroke();
  doc.y = ruleY + 14;
}

function drawParties(ctx: DrawContext): void {
  const { doc, inv, marginLeft, marginRight, contentWidth } = ctx;
  const colWidth = contentWidth / 2 - 12;
  const startY = doc.y;

  const customerName =
    inv.customer_name ||
    (inv.customer
      ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(' ')
      : 'Customer');
  const customerEmail = inv.customer_email ?? inv.customer?.email ?? '';
  const customerPhone = inv.customer_phone ?? inv.customer?.phone ?? '';

  // Bill To
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('BILL TO', marginLeft, startY, { width: colWidth, characterSpacing: 1 });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(customerName, marginLeft, doc.y + 4, { width: colWidth });
  if (customerEmail) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(customerEmail, marginLeft, doc.y + 2, { width: colWidth });
  }
  if (customerPhone) {
    doc.text(customerPhone, marginLeft, doc.y + 2, { width: colWidth });
  }
  const leftBottom = doc.y;

  // Sales people (right column). The full roster when the invoice carries one,
  // otherwise the single primary — invoices raised before a roster existed keep
  // printing exactly as they did. Commission never appears: it's internal.
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
  if (salesPeople.length > 0) {
    const rightX = marginLeft + colWidth + 24;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(salesPeople.length > 1 ? 'SALES PEOPLE' : 'SALES PERSON', rightX, startY, {
        width: colWidth,
        characterSpacing: 1,
      });
    for (const sp of salesPeople) {
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text([sp.first_name, sp.last_name].filter(Boolean).join(' '), rightX, doc.y + 4, {
          width: colWidth,
        });
      if (sp.email) {
        doc
          .fillColor(COLORS.muted)
          .font('Helvetica')
          .fontSize(10)
          .text(sp.email, rightX, doc.y + 2, { width: colWidth });
      }
    }
  }

  // Ship To (client) — the Packing List flow: the invoice bills the customer,
  // but the parcel ships to the customer's client. Drawn as a full-width row
  // beneath Bill To / Sales Person so the destination is clear on the document.
  const client = inv.ships_to_client ? inv.client : null;
  let partiesBottom = Math.max(leftBottom, doc.y);
  if (client) {
    const clientName =
      [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client';
    const cityLine = [client.city, client.state, client.postal_code]
      .filter(Boolean)
      .join(', ');
    const lines = [
      client.address,
      cityLine,
      client.country,
      client.phone,
      client.email,
    ].filter((v): v is string => Boolean(v));
    const shipY = partiesBottom + 14;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('SHIP TO (CLIENT)', marginLeft, shipY, { width: contentWidth, characterSpacing: 1 });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(clientName, marginLeft, doc.y + 4, { width: contentWidth });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10);
    for (const line of lines) {
      doc.text(line, marginLeft, doc.y + 2, { width: contentWidth });
    }
    partiesBottom = doc.y;
  }

  doc.y = partiesBottom + 18;
}

function drawDates(ctx: DrawContext): void {
  const { doc, inv, marginLeft, contentWidth } = ctx;
  const pad = 14;
  const rowH = 44;
  const y = doc.y;

  // Six markings laid out as a 3-column, 2-row grid: dates/number on top,
  // currency + label marking beneath.
  const cells: Array<[string, string]> = [
    ['ISSUE DATE', new Date(inv.issue_date).toLocaleDateString()],
    ['DUE DATE', new Date(inv.due_date).toLocaleDateString()],
    ['INVOICE #', inv.invoice_number],
    ['CURRENCY', inv.currency === 'USD' ? 'USD' : 'CAD'],
    ['LABELS', inv.with_labels === false ? 'Without labels' : 'With labels'],
    ['', ''],
  ];
  const rows = Math.ceil(cells.length / 3);
  const boxH = rowH * rows + 6;

  doc
    .roundedRect(marginLeft, y, contentWidth, boxH, 6)
    .fill(COLORS.surface);

  const cellWidth = contentWidth / 3;
  cells.forEach(([label, value], i) => {
    if (!label) return;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = marginLeft + cellWidth * col + pad;
    const cellY = y + row * rowH + 10;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(label, x, cellY, { characterSpacing: 1, width: cellWidth - pad });
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica')
      .fontSize(11)
      .text(value, x, cellY + 14, { width: cellWidth - pad });
  });

  doc.y = y + boxH + 18;
}

function drawItemsTable(ctx: DrawContext): void {
  const { doc, inv, marginLeft, marginRight, contentWidth } = ctx;
  // Column ratios: sku, description, qty, unit price, disc %, total
  const ratios = [0.16, 0.34, 0.09, 0.15, 0.09, 0.17];
  const widths = ratios.map((r) => r * contentWidth);
  const xs = widths.reduce<number[]>(
    (acc, w, i) => [...acc, (acc[i - 1] ?? marginLeft) + (i === 0 ? 0 : widths[i - 1])],
    [],
  );

  // Header row
  const headerY = doc.y;
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8);
  const headers = ['SKU', 'DESCRIPTION', 'QTY', 'UNIT PRICE', 'DISC %', 'TOTAL'];
  headers.forEach((h, i) => {
    const align = i <= 1 ? 'left' : 'right';
    doc.text(h, xs[i], headerY, {
      width: widths[i] - (i === headers.length - 1 ? 0 : 8),
      align,
      characterSpacing: 1,
    });
  });
  const headerBottom = headerY + 16;
  doc
    .moveTo(marginLeft, headerBottom)
    .lineTo(marginRight, headerBottom)
    .lineWidth(0.5)
    .strokeColor(COLORS.rule)
    .stroke();

  doc.y = headerBottom + 6;

  // Rows
  for (const li of inv.line_items ?? []) {
    const rowY = doc.y;
    // SKU (monospace, muted) and Description (allow wrap)
    doc.font('Courier').fontSize(9).fillColor(COLORS.muted);
    doc.text(lineItemSku(li) || '—', xs[0], rowY, { width: widths[0] - 8 });
    const skuBottom = doc.y;
    const isVial = li.price_type === 'vial';
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    doc.text(li.description, xs[1], rowY, {
      width: widths[1] - 8,
      continued: true,
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(isVial ? COLORS.indigo : COLORS.vital)
      .text(`  ${isVial ? 'VIAL' : 'BOX'}`, { characterSpacing: 0.5 });
    const descBottom = doc.y;
    // Numeric cells on the row's top line
    doc.text(String(li.qty), xs[2], rowY, { width: widths[2] - 8, align: 'right' });
    doc.text(money(li.unit_price), xs[3], rowY, { width: widths[3] - 8, align: 'right' });
    doc.text(`${Number(li.discount_pct) || 0}%`, xs[4], rowY, {
      width: widths[4] - 8,
      align: 'right',
    });
    doc.text(money(li.line_total), xs[5], rowY, { width: widths[5], align: 'right' });
    const rowBottom = Math.max(skuBottom, descBottom, doc.y) + 6;

    doc
      .moveTo(marginLeft, rowBottom)
      .lineTo(marginRight, rowBottom)
      .lineWidth(0.5)
      .strokeColor(COLORS.rowRule)
      .stroke();
    doc.y = rowBottom + 4;
  }
  doc.y += 6;
}

function drawTotals(ctx: DrawContext): void {
  const { doc, inv, marginRight } = ctx;
  const colWidth = 240;
  const left = marginRight - colWidth;

  const amount_paid = (inv.payments ?? []).reduce(
    (s, p) => s + Number(p.amount),
    0,
  );
  const amount_due = Math.max(0, Number(inv.total) - amount_paid);
  const cur = inv.currency === 'USD' ? 'USD' : 'CAD';

  const showProcessingFee =
    inv.show_processing_fee !== false && Number(inv.processing_fee ?? 0) > 0;

  const rows: Array<{ label: string; value: string; emphasis?: 'total' | 'due' }> = [
    { label: 'Subtotal', value: money(inv.subtotal) },
    { label: `Tax (${Number(inv.tax_rate) || 0}%)`, value: money(inv.tax_total) },
    { label: 'Shipping', value: money(inv.shipping_cost) },
    ...(showProcessingFee
      ? [{ label: 'Processing Fee', value: money(inv.processing_fee) }]
      : []),
    { label: 'Total', value: `${money(inv.total)} ${cur}`, emphasis: 'total' as const },
  ];
  if (amount_paid > 0) {
    rows.push({ label: 'Paid', value: `− ${money(amount_paid)}` });
  }
  rows.push({ label: 'Amount Due', value: `${money(amount_due)} ${cur}`, emphasis: 'due' });

  for (const r of rows) {
    const isTotal = r.emphasis === 'total';
    const isDue = r.emphasis === 'due';
    if (isTotal) {
      doc
        .moveTo(left, doc.y)
        .lineTo(marginRight, doc.y)
        .lineWidth(1)
        .strokeColor(COLORS.ink)
        .stroke();
      doc.y += 6;
    }
    const y = doc.y;
    doc
      .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(isTotal ? 12 : 10)
      .fillColor(isDue ? COLORS.vital : COLORS.ink)
      .text(r.label, left, y, { width: colWidth / 2 });
    doc.text(r.value, left + colWidth / 2, y, {
      width: colWidth / 2,
      align: 'right',
    });
    doc.y = y + (isTotal ? 16 : 14);
  }
  doc.y += 10;
}

function drawPayments(ctx: DrawContext): void {
  const { doc, inv, marginLeft, marginRight, contentWidth } = ctx;
  if (!inv.payments || inv.payments.length === 0) return;

  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('PAYMENT HISTORY', marginLeft, doc.y, { characterSpacing: 1 });
  doc.y += 8;

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
  for (const p of inv.payments) {
    const y = doc.y;
    const label = `${new Date(p.paid_at).toLocaleDateString()}  ·  ${p.method}${
      p.reference_note ? ` (${p.reference_note})` : ''
    }`;
    doc.text(label, marginLeft, y, { width: contentWidth - 80 });
    doc.text(money(p.amount), marginLeft + contentWidth - 80, y, {
      width: 80,
      align: 'right',
    });
    const rowBottom = doc.y + 4;
    doc
      .moveTo(marginLeft, rowBottom)
      .lineTo(marginRight, rowBottom)
      .dash(1, { space: 2 })
      .lineWidth(0.5)
      .strokeColor(COLORS.rule)
      .stroke()
      .undash();
    doc.y = rowBottom + 4;
  }
  doc.y += 8;
}

function drawNotes(ctx: DrawContext): void {
  const { doc, inv, marginLeft, contentWidth } = ctx;
  if (!inv.notes) return;
  const padding = 12;
  const startY = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  const noteHeight = doc.heightOfString(inv.notes, {
    width: contentWidth - padding * 2,
  });
  doc
    .roundedRect(marginLeft, startY, contentWidth, noteHeight + padding * 2 + 14, 6)
    .fill(COLORS.surface);

  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('NOTES', marginLeft + padding, startY + padding, { characterSpacing: 1 });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica')
    .fontSize(10)
    .text(inv.notes, marginLeft + padding, startY + padding + 14, {
      width: contentWidth - padding * 2,
    });
  doc.y = startY + noteHeight + padding * 2 + 22;
}

function drawFooter(ctx: DrawContext): void {
  const { doc, marginLeft, marginRight, pageWidth } = ctx;
  const footerY = doc.page.height - 60;
  // The footer sits below the bottom margin, which pdfkit would otherwise treat
  // as overflow and answer with a trailing blank page.
  drawInFooterStrip(doc, () => {
    doc
      .moveTo(marginLeft, footerY)
      .lineTo(marginRight, footerY)
      .lineWidth(0.5)
      .strokeColor(COLORS.rule)
      .stroke();
    doc
      .fillColor(COLORS.faint)
      .font('Helvetica')
      .fontSize(9)
      .text('Thank you for your business.', marginLeft, footerY + 10, {
        lineBreak: false,
      });
    doc.text(
      `Generated ${new Date().toLocaleString()}`,
      marginLeft,
      footerY + 10,
      { align: 'right', width: marginRight - marginLeft, lineBreak: false },
    );
  });
}

export async function renderInvoicePdf(inv: InvoiceForHtml): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `Invoice ${inv.invoice_number}`, Author: 'VYTA Biosciences' },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width;
  const marginLeft = 50;
  const marginRight = pageWidth - 50;
  const contentWidth = marginRight - marginLeft;
  const ctx: DrawContext = {
    doc,
    inv,
    pageWidth,
    contentWidth,
    marginLeft,
    marginRight,
  };

  doc.y = 50;
  drawHeader(ctx);
  drawParties(ctx);
  drawDates(ctx);
  drawItemsTable(ctx);
  drawTotals(ctx);
  drawPayments(ctx);
  drawNotes(ctx);
  drawFooter(ctx);

  doc.end();
  return done;
}
