import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '@/lib/pdf-footer';

// The Packing List is the ONLY document a customer's client receives. It lists
// what's in the parcel — SKU, description, quantity — with the tracking link,
// and deliberately carries NO pricing of any kind. It's modeled on
// lib/invoice-pdf.ts (same pdfkit → Buffer streaming, same palette) minus every
// money column/section.

const COLORS = {
  ink: '#07203A',
  muted: '#5B7A8C',
  faint: '#8FA9B6',
  rule: '#D5E2E7',
  rowRule: '#EFF5F7',
  surface: '#F7FAFB',
  vital: '#438B9E',
};

export interface PackingListData {
  invoice_number: string;
  order_number?: string | null;
  issue_date?: string | null;
  /** Name the parcel is addressed under (the customer's name). */
  recipient_name: string;
  /** The client's shipping address. */
  ship_to: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };
  /** Tracking details for the shipment, when available. */
  tracking?: {
    carrier?: string | null;
    number?: string | null;
    url?: string | null;
  } | null;
  line_items: Array<{ sku?: string | null; description: string; qty: number }>;
  notes?: string | null;
}

type PDFDoc = InstanceType<typeof PDFDocument>;

interface DrawContext {
  doc: PDFDoc;
  data: PackingListData;
  pageWidth: number;
  contentWidth: number;
  marginLeft: number;
  marginRight: number;
}

function drawHeader(ctx: DrawContext): void {
  const { doc, data, marginLeft, marginRight } = ctx;
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
    .text('puramass.com  ·  info@aminocan.com', marginLeft, doc.y + 2);

  // Right-aligned doc title + reference.
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Packing List', marginLeft, top, {
      align: 'right',
      width: marginRight - marginLeft,
    });
  doc
    .fillColor(COLORS.muted)
    .font('Courier')
    .fontSize(11)
    .text(data.order_number || data.invoice_number, marginLeft, doc.y + 2, {
      align: 'right',
      width: marginRight - marginLeft,
    });

  const ruleY = doc.y + 14;
  doc
    .moveTo(marginLeft, ruleY)
    .lineTo(marginRight, ruleY)
    .lineWidth(1.5)
    .strokeColor(COLORS.ink)
    .stroke();
  doc.y = ruleY + 14;
}

function drawShipTo(ctx: DrawContext): void {
  const { doc, data, marginLeft, marginRight, contentWidth } = ctx;
  const colWidth = contentWidth / 2 - 12;
  const startY = doc.y;
  const s = data.ship_to;

  // Ship To — addressed under the customer's name, at the client's address.
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('SHIP TO', marginLeft, startY, { width: colWidth, characterSpacing: 1 });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(data.recipient_name || '—', marginLeft, doc.y + 4, { width: colWidth });
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted);
  if (s.address) doc.text(s.address, marginLeft, doc.y + 2, { width: colWidth });
  const cityLine = [s.city, s.state, s.postal_code].filter(Boolean).join(' ');
  if (cityLine) doc.text(cityLine, marginLeft, doc.y + 2, { width: colWidth });
  if (s.country) doc.text(s.country, marginLeft, doc.y + 2, { width: colWidth });
  const leftBottom = doc.y;

  // Shipment / tracking (right column).
  const rightX = marginLeft + colWidth + 24;
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('SHIPMENT', rightX, startY, { width: colWidth, characterSpacing: 1 });
  const t = data.tracking ?? {};
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  if (data.issue_date) {
    doc.text(
      `Date: ${new Date(data.issue_date).toLocaleDateString()}`,
      rightX,
      doc.y + 4,
      { width: colWidth },
    );
  }
  if (t.carrier) doc.text(`Carrier: ${t.carrier}`, rightX, doc.y + 2, { width: colWidth });
  if (t.number) {
    doc.font('Courier').fontSize(10).fillColor(COLORS.ink);
    doc.text(`Tracking: ${t.number}`, rightX, doc.y + 2, { width: colWidth });
    doc.font('Helvetica').fontSize(10);
  }
  if (t.url) {
    doc.fillColor(COLORS.vital).fontSize(9);
    doc.text(t.url, rightX, doc.y + 2, {
      width: colWidth,
      link: t.url,
      underline: true,
    });
    doc.fillColor(COLORS.ink);
  }

  doc.y = Math.max(leftBottom, doc.y) + 18;
}

function drawItemsTable(ctx: DrawContext): void {
  const { doc, data, marginLeft, marginRight, contentWidth } = ctx;
  // Column ratios: sku, description, qty — no pricing.
  const ratios = [0.22, 0.63, 0.15];
  const widths = ratios.map((r) => r * contentWidth);
  const xs = widths.reduce<number[]>(
    (acc, w, i) => [...acc, (acc[i - 1] ?? marginLeft) + (i === 0 ? 0 : widths[i - 1])],
    [],
  );

  const headerY = doc.y;
  doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8);
  const headers = ['SKU', 'DESCRIPTION', 'QTY'];
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

  for (const li of data.line_items ?? []) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const rowY = doc.y;
    doc.font('Courier').fontSize(9).fillColor(COLORS.muted);
    doc.text(li.sku || '—', xs[0], rowY, { width: widths[0] - 8 });
    const skuBottom = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    doc.text(li.description, xs[1], rowY, { width: widths[1] - 8 });
    const descBottom = doc.y;
    doc.text(String(li.qty), xs[2], rowY, { width: widths[2], align: 'right' });
    const rowBottom = Math.max(skuBottom, descBottom, doc.y) + 6;

    doc
      .moveTo(marginLeft, rowBottom)
      .lineTo(marginRight, rowBottom)
      .lineWidth(0.5)
      .strokeColor(COLORS.rowRule)
      .stroke();
    doc.y = rowBottom + 4;
  }

  // Total unit count (no monetary total).
  const totalQty = (data.line_items ?? []).reduce((s, li) => s + Number(li.qty || 0), 0);
  doc.y += 6;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text(`Total items: ${totalQty}`, marginLeft, doc.y, {
      width: contentWidth,
      align: 'right',
    });
  doc.y += 16;
}

function drawNotes(ctx: DrawContext): void {
  const { doc, data, marginLeft, contentWidth } = ctx;
  if (!data.notes) return;
  const padding = 12;
  const startY = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  const noteHeight = doc.heightOfString(data.notes, { width: contentWidth - padding * 2 });
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
    .text(data.notes, marginLeft + padding, startY + padding + 14, {
      width: contentWidth - padding * 2,
    });
  doc.y = startY + noteHeight + padding * 2 + 22;
}

function drawFooter(ctx: DrawContext): void {
  const { doc, marginLeft, marginRight } = ctx;
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
      .text('Thank you.', marginLeft, footerY + 10, { lineBreak: false });
    doc.text(
      `Generated ${new Date().toLocaleString()}`,
      marginLeft,
      footerY + 10,
      { align: 'right', width: marginRight - marginLeft, lineBreak: false },
    );
  });
}

export async function renderPackingListPdf(data: PackingListData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title: `Packing List ${data.order_number || data.invoice_number}`,
      Author: 'VYTA Biosciences',
    },
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
  const ctx: DrawContext = { doc, data, pageWidth, contentWidth, marginLeft, marginRight };

  doc.y = 50;
  drawHeader(ctx);
  drawShipTo(ctx);
  drawItemsTable(ctx);
  drawNotes(ctx);
  drawFooter(ctx);

  doc.end();
  return done;
}
