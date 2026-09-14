/**
 * Attachable PDF rendering for a per-entity price sheet.
 *
 * Turns the render-agnostic {@link PriceSheetData} into a clean, branded PDF
 * (PURAMASS header, bronze accents) using pdfkit — the same toolkit and visual
 * language as the invoice PDF, so an emailed price list matches the rest of the
 * document set. The data is identical to the print-ready HTML view; only the
 * presentation differs.
 */

import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '@/lib/pdf-footer';
import type { PriceSheetData } from '@/lib/admin/price-sheet';

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

const COLORS = {
  ink: '#1A1A1A',
  muted: '#6B7280',
  faint: '#9CA3AF',
  rule: '#C9CCD1',
  rowRule: '#F2F2F2',
  surface: '#F7F7F7',
  bronze: '#9C8B5A',
};

type PDFDoc = InstanceType<typeof PDFDocument>;

const MARGIN = 50;

interface Ctx {
  doc: PDFDoc;
  data: PriceSheetData;
  marginLeft: number;
  marginRight: number;
  contentWidth: number;
}

function drawHeader(ctx: Ctx): void {
  const { doc, data, marginLeft, marginRight } = ctx;
  const top = doc.y;

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('PURAMASS', marginLeft, top, { lineBreak: false });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text('puramass.com  ·  info@aminocan.com', marginLeft, doc.y + 2);

  // Right-aligned document title.
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Price List', marginLeft, top, {
      align: 'right',
      width: marginRight - marginLeft,
    });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(10)
    .text(`${data.kindLabel}: ${data.name}`, marginLeft, doc.y + 2, {
      align: 'right',
      width: marginRight - marginLeft,
    });

  doc.y = Math.max(doc.y, top + 46) + 6;

  // Meta strip (generated / product count / currency).
  doc
    .fillColor(COLORS.faint)
    .font('Helvetica')
    .fontSize(8.5)
    .text(data.meta.join('   ·   '), marginLeft, doc.y, {
      width: marginRight - marginLeft,
    });
  doc.y += 6;

  doc
    .moveTo(marginLeft, doc.y)
    .lineTo(marginRight, doc.y)
    .lineWidth(0.75)
    .strokeColor(COLORS.rule)
    .stroke();
  doc.y += 14;
}

/**
 * Column geometry. SKU · Description · Case price · Vial price, plus Inventory
 * when it was asked for. The two money columns and Inventory are right-aligned.
 */
function columns(ctx: Ctx) {
  const { data, marginLeft, contentWidth } = ctx;
  const ratios = data.includeInventory
    ? [0.14, 0.32, 0.18, 0.18, 0.18]
    : [0.16, 0.42, 0.21, 0.21];
  const headers = [
    'SKU',
    'DESCRIPTION',
    `CASE PRICE (${data.currency})`,
    `VIAL PRICE (${data.currency})`,
  ];
  if (data.includeInventory) headers.push('INVENTORY');
  const widths = ratios.map((r) => r * contentWidth);
  const xs: number[] = [];
  let acc = marginLeft;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }
  const rightAlign = data.includeInventory ? [2, 3, 4] : [2, 3];
  return { widths, xs, headers, rightAlign };
}

function drawTableHead(ctx: Ctx): void {
  const { doc, marginLeft, marginRight } = ctx;
  const { widths, xs, headers, rightAlign } = columns(ctx);
  const y = doc.y;
  doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8);
  headers.forEach((h, i) => {
    doc.text(h, xs[i], y, {
      width: widths[i] - (i === headers.length - 1 ? 0 : 8),
      align: rightAlign.includes(i) ? 'right' : 'left',
      characterSpacing: 1,
    });
  });
  const bottom = y + 16;
  doc
    .moveTo(marginLeft, bottom)
    .lineTo(marginRight, bottom)
    .lineWidth(0.5)
    .strokeColor(COLORS.rule)
    .stroke();
  doc.y = bottom + 6;
}

function drawRows(ctx: Ctx): void {
  const { doc, data, marginLeft, marginRight } = ctx;
  const { widths, xs } = columns(ctx);
  // Break well above the per-page footer (drawn at height - 55) so a tall,
  // wrapped row can't overlap it.
  const pageBottom = doc.page.height - 95;

  if (data.rows.length === 0) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text('No products to price.', marginLeft, doc.y + 4);
    doc.y += 24;
    return;
  }

  for (const r of data.rows) {
    // Page break: start a fresh page and repeat the header row.
    if (doc.y > pageBottom) {
      doc.addPage();
      doc.y = MARGIN;
      drawTableHead(ctx);
    }

    const rowY = doc.y;
    // SKU (monospace, muted).
    doc.font('Courier').fontSize(9).fillColor(COLORS.muted);
    doc.text(r.sku || '—', xs[0], rowY, { width: widths[0] - 8 });
    const skuBottom = doc.y;

    // Description (wraps).
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    doc.text(r.description || '—', xs[1], rowY, { width: widths[1] - 8 });
    const descBottom = doc.y;

    // Case price (right-aligned, the headline number).
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(money(r.price), xs[2], rowY, { width: widths[2] - 8, align: 'right' });

    // Vial price (right-aligned, one step quieter than the case price).
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(money(r.vialPrice), xs[3], rowY, {
        width: widths[3] - (data.includeInventory ? 8 : 0),
        align: 'right',
      });

    // Inventory (right-aligned, muted).
    if (data.includeInventory) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(r.inventory ?? '—', xs[4], rowY, { width: widths[4], align: 'right' });
    }

    const rowBottom = Math.max(skuBottom, descBottom, doc.y) + 6;
    doc
      .moveTo(marginLeft, rowBottom)
      .lineTo(marginRight, rowBottom)
      .lineWidth(0.5)
      .strokeColor(COLORS.rowRule)
      .stroke();
    doc.y = rowBottom + 4;
  }
}

function drawFooter(ctx: Ctx): void {
  const { doc, data, marginLeft, marginRight } = ctx;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 55;
    // The footer sits below the bottom margin, which pdfkit would otherwise
    // treat as overflow and answer with a blank page per footer.
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
        .text(`Price list · ${data.name}`, marginLeft, footerY + 10, {
          lineBreak: false,
        });
      doc.text(
        `Page ${i - range.start + 1} of ${range.count}`,
        marginLeft,
        footerY + 10,
        { align: 'right', width: marginRight - marginLeft, lineBreak: false },
      );
    });
  }
}

/** Render the price-sheet data as a branded, attachable PDF buffer. */
export async function renderPriceSheetPdf(data: PriceSheetData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: `Price List — ${data.name}`, Author: 'PuraMass' },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width;
  const marginLeft = MARGIN;
  const marginRight = pageWidth - MARGIN;
  const ctx: Ctx = {
    doc,
    data,
    marginLeft,
    marginRight,
    contentWidth: marginRight - marginLeft,
  };

  doc.y = MARGIN;
  drawHeader(ctx);
  drawTableHead(ctx);
  drawRows(ctx);
  drawFooter(ctx);

  doc.end();
  return done;
}

/** A safe file name for the emailed/downloaded price list. */
export function priceSheetFileName(data: Pick<PriceSheetData, 'name'>): string {
  const slug = data.name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return `price-list-${slug || 'entity'}.pdf`;
}
