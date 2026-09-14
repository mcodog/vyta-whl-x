/**
 * Branded PDF rendering for a downloadable price list.
 *
 * Uses pdfkit and the same visual language as the invoice and price-sheet PDFs
 * (PURAMASS header, bronze accents, ruled rows) so a downloaded price list
 * matches the rest of the document set.
 *
 * Which columns the table carries, and whether the name / description / details
 * strip print at all, come from the Customize menu via {@link
 * PricelistExportOptions}; the defaults are the shareable set (SKU, description
 * and price). Column widths are laid out from the selected columns' relative
 * weights, so any selection fills the page — and a wide selection turns the page
 * landscape rather than squeezing prices until they wrap.
 */

import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '@/lib/pdf-footer';
import {
  columnText,
  defaultExportOptions,
  pricelistColumn,
  type PricelistColumnKey,
  type PricelistExportOptions,
} from '@/lib/admin/pricelist-columns';
import type { PricelistExportData } from '@/lib/admin/pricelist-export';

const COLORS = {
  ink: '#1A1A1A',
  muted: '#6B7280',
  faint: '#9CA3AF',
  rule: '#C9CCD1',
  rowRule: '#F2F2F2',
  bronze: '#9C8B5A',
};

type PDFDoc = InstanceType<typeof PDFDocument>;

const MARGIN = 50;

/** Gap between columns, so a wide cell can't run into its neighbour. */
const GUTTER = 8;

/** From this many columns on, portrait leaves prices too narrow to print. */
const LANDSCAPE_FROM = 7;

/** From this many columns on, the type is stepped down to keep cells on one line. */
const SMALL_TYPE_FROM = 9;

/** Page orientation for a column selection. */
const layoutFor = (columns: readonly PricelistColumnKey[]): 'portrait' | 'landscape' =>
  columns.length >= LANDSCAPE_FROM ? 'landscape' : 'portrait';

/** Type scale for a column selection — tighter as the table widens. */
const typeScale = (columns: readonly PricelistColumnKey[]): number =>
  columns.length >= SMALL_TYPE_FROM ? 0.9 : 1;

/** How each column prints: font, size, colour. Alignment comes from the spec. */
const CELL_STYLE: Record<PricelistColumnKey, { font: string; size: number; color: string }> = {
  productId: { font: 'Courier', size: 7, color: COLORS.faint },
  sku: { font: 'Courier', size: 9, color: COLORS.muted },
  product: { font: 'Helvetica', size: 10, color: COLORS.ink },
  strength: { font: 'Helvetica', size: 9, color: COLORS.muted },
  price: { font: 'Helvetica-Bold', size: 10, color: COLORS.ink },
  unlabeled: { font: 'Helvetica', size: 10, color: COLORS.muted },
  catalog: { font: 'Helvetica', size: 9.5, color: COLORS.muted },
  change: { font: 'Helvetica', size: 9.5, color: COLORS.muted },
  inventory: { font: 'Helvetica', size: 9, color: COLORS.muted },
  source: { font: 'Helvetica', size: 8.5, color: COLORS.faint },
};

interface Ctx {
  doc: PDFDoc;
  data: PricelistExportData;
  options: PricelistExportOptions;
  marginLeft: number;
  marginRight: number;
  contentWidth: number;
  /** Column geometry, computed once per document. */
  layout: ColumnLayout;
  /** Font-size multiplier for the table, from the column count. */
  scale: number;
}

interface ColumnLayout {
  keys: PricelistColumnKey[];
  xs: number[];
  widths: number[];
  headers: string[];
  aligns: ('left' | 'right')[];
  /** Numeric columns print on one line — a wrapped price is unreadable. */
  numeric: boolean[];
}

/** Lay the selected columns across the content width by their weights. */
function layoutColumns(
  data: PricelistExportData,
  options: PricelistExportOptions,
  marginLeft: number,
  contentWidth: number,
): ColumnLayout {
  const specs = options.columns.map(pricelistColumn);
  const total = specs.reduce((sum, c) => sum + c.weight, 0) || 1;
  const widths = specs.map((c) => (c.weight / total) * contentWidth);
  const xs: number[] = [];
  let acc = marginLeft;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }
  return {
    keys: specs.map((c) => c.key),
    xs,
    widths,
    headers: specs.map((c) => c.label(data.currency).toUpperCase()),
    aligns: specs.map((c) => (c.numeric ? 'right' : 'left')),
    numeric: specs.map((c) => c.numeric),
  };
}

/** Usable width of a cell: full width for the last column, less a gutter before. */
const cellWidth = (layout: ColumnLayout, i: number): number =>
  layout.widths[i] - (i === layout.widths.length - 1 ? 0 : GUTTER);

function drawHeader(ctx: Ctx): void {
  const { doc, data, options, marginLeft, marginRight } = ctx;
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

  // Right-aligned document title, with the list it is when asked for.
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Price List', marginLeft, top, {
      align: 'right',
      width: marginRight - marginLeft,
    });
  if (options.showName) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(data.name, marginLeft, doc.y + 2, {
        align: 'right',
        width: marginRight - marginLeft,
      });
  }

  doc.y = Math.max(doc.y, top + 46) + 6;

  if (options.showDescription && data.description) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(data.description, marginLeft, doc.y, { width: marginRight - marginLeft });
    doc.y += 4;
  }

  if (options.showMeta) {
    doc
      .fillColor(COLORS.faint)
      .font('Helvetica')
      .fontSize(8.5)
      .text(data.meta.join('   ·   '), marginLeft, doc.y, {
        width: marginRight - marginLeft,
      });
    doc.y += 6;
  }

  doc
    .moveTo(marginLeft, doc.y)
    .lineTo(marginRight, doc.y)
    .lineWidth(0.75)
    .strokeColor(COLORS.rule)
    .stroke();
  doc.y += 14;
}

function drawTableHead(ctx: Ctx): void {
  const { doc, marginLeft, marginRight, layout, scale } = ctx;
  const y = doc.y;
  doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8 * scale);
  layout.headers.forEach((h, i) => {
    doc.text(h, layout.xs[i], y, {
      width: cellWidth(layout, i),
      align: layout.aligns[i],
      characterSpacing: 0.6,
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
  const { doc, data, marginLeft, marginRight, layout, scale } = ctx;
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
    let rowBottom = rowY;
    layout.keys.forEach((key, i) => {
      const style = CELL_STYLE[key];
      doc.font(style.font).fontSize(style.size * scale).fillColor(style.color);
      doc.text(columnText(key, r), layout.xs[i], rowY, {
        width: cellWidth(layout, i),
        align: layout.aligns[i],
        lineBreak: !layout.numeric[i],
      });
      rowBottom = Math.max(rowBottom, doc.y);
    });

    rowBottom += 6;
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
  const { doc, data, options, marginLeft, marginRight } = ctx;
  const label = options.showName ? `Price list · ${data.name}` : 'Price list';
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
        .text(label, marginLeft, footerY + 10, { lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, marginLeft, footerY + 10, {
        align: 'right',
        width: marginRight - marginLeft,
        lineBreak: false,
      });
    });
  }
}

/** Render a price list as a branded, downloadable PDF buffer. */
export async function renderPricelistPdf(
  data: PricelistExportData,
  options: PricelistExportOptions = defaultExportOptions('pdf', data),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    // A wide column selection needs the long edge, or the price columns end up
    // narrower than the numbers they hold.
    layout: layoutFor(options.columns),
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

  const marginLeft = MARGIN;
  const marginRight = doc.page.width - MARGIN;
  const contentWidth = marginRight - marginLeft;
  const ctx: Ctx = {
    doc,
    data,
    options,
    marginLeft,
    marginRight,
    contentWidth,
    layout: layoutColumns(data, options, marginLeft, contentWidth),
    scale: typeScale(options.columns),
  };

  doc.y = MARGIN;
  drawHeader(ctx);
  drawTableHead(ctx);
  drawRows(ctx);
  drawFooter(ctx);

  doc.end();
  return done;
}
