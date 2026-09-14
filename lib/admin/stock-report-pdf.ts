import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '@/lib/pdf-footer';
import { PO_STATUS_LABEL, type StockReportData, type StockReportRow } from '@/lib/admin/stock-report';

/**
 * Renders the Stock Report as a real (vector) PDF via pdfkit — no headless
 * browser. Text and rules are resolution-independent, so it stays crisp at any
 * zoom. Tuned for legibility: generous type, stock pills, zebra rows, and
 * multi-page tables with repeating headers + page numbers.
 */

const COLORS = {
  ink: '#161616',
  muted: '#5B7A8C',
  faint: '#8FA9B6',
  rule: '#D2D5DA',
  zebra: '#F7FAFB',
  surface: '#EFF5F7',
  vital: '#438B9E',
  greenBg: '#D1FAE5',
  greenFg: '#065F46',
  amberBg: '#FEF3C7',
  amberFg: '#92400E',
  redBg: '#FEE2E2',
  redFg: '#991B1B',
};

const PAGE_MARGIN = 46;
const FOOTER_SPACE = 64;

type PDFDoc = InstanceType<typeof PDFDocument>;

interface Ctx {
  doc: PDFDoc;
  left: number;
  right: number;
  width: number;
}

// Column ratios: Product, Category, Stock, Min Qty, On Order, Need To Order.
const RATIOS = [0.29, 0.19, 0.15, 0.12, 0.12, 0.13];
const HEADERS = ['Product', 'Category', 'Stock', 'Min Qty', 'On Order', 'Need to Order'];

function bottomLimit(doc: PDFDoc): number {
  return doc.page.height - FOOTER_SPACE;
}

function drawTitle(ctx: Ctx, generatedAt: Date): void {
  const { doc, left, right } = ctx;
  const top = doc.y;

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(26).text('VYTA', left, top, { lineBreak: false, characterSpacing: 4 });
  doc
    .fillColor(COLORS.vital)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('STOCK REPORT', left, doc.y + 4, { characterSpacing: 2 });

  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(10)
    .text(`Generated ${generatedAt.toLocaleString()}`, left, top + 8, {
      align: 'right',
      width: right - left,
    });

  const ruleY = doc.y + 12;
  doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(2).strokeColor(COLORS.vital).stroke();
  doc.y = ruleY + 18;
}

function drawStats(ctx: Ctx, data: StockReportData): void {
  const { doc, left, width } = ctx;
  const t = data.totals;
  const cells: Array<[string, string, string, boolean]> = [
    ['PRODUCTS', String(t.products), `${t.active} active`, false],
    ['STOCK ON HAND', `${t.units}`, `units · ${t.lowStock} low · ${t.outOfStock} out`, false],
    ['ON ORDER', `${t.onOrder}`, 'units · open POs', false],
    ['NEED TO ORDER', `${t.needToOrder}`, `units · ${t.needCount} product${t.needCount === 1 ? '' : 's'}`, t.needToOrder > 0],
  ];
  const y = doc.y;
  const boxH = 66;
  const gap = 10;
  const cellW = (width - gap * 3) / 4;
  cells.forEach(([label, value, meta, danger], i) => {
    const x = left + (cellW + gap) * i;
    doc.roundedRect(x, y, cellW, boxH, 8).lineWidth(1).fillAndStroke('#FFFFFF', COLORS.rule);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7.5).text(label, x + 12, y + 12, { characterSpacing: 0.8, width: cellW - 20 });
    doc.fillColor(danger ? COLORS.redFg : COLORS.ink).font('Helvetica-Bold').fontSize(20).text(value, x + 12, y + 24, { width: cellW - 20, lineBreak: false });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(meta, x + 12, y + 49, { width: cellW - 18 });
  });
  doc.y = y + boxH + 22;
}

function columnGeometry(ctx: Ctx): { xs: number[]; widths: number[] } {
  const widths = RATIOS.map((r) => r * ctx.width);
  const xs = widths.reduce<number[]>(
    (acc, _w, i) => [...acc, (acc[i - 1] ?? ctx.left) + (i === 0 ? 0 : widths[i - 1])],
    [],
  );
  return { xs, widths };
}

function drawTableHeader(ctx: Ctx, xs: number[], widths: number[]): void {
  const { doc, left, right } = ctx;
  const y = doc.y;
  doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8.5);
  HEADERS.forEach((h, i) => {
    const align = i <= 1 ? 'left' : i === 2 ? 'left' : 'right';
    doc.text(h.toUpperCase(), xs[i], y, {
      width: widths[i] - (i === HEADERS.length - 1 ? 0 : 8),
      align,
      characterSpacing: 0.6,
    });
  });
  const hb = y + 16;
  doc.moveTo(left, hb).lineTo(right, hb).lineWidth(1).strokeColor(COLORS.rule).stroke();
  doc.y = hb + 8;
}

function drawPill(doc: PDFDoc, x: number, y: number, text: string, bg: string, fg: string): void {
  doc.font('Helvetica-Bold').fontSize(9.5);
  const tw = doc.widthOfString(text);
  const padX = 7;
  const w = tw + padX * 2;
  const h = 16;
  doc.roundedRect(x, y - 2, w, h, 8).fill(bg);
  doc.fillColor(fg).text(text, x + padX, y + 1.5, { lineBreak: false });
}

function stockPill(r: StockReportRow): { text: string; bg: string; fg: string } {
  if (r.stock <= 0) return { text: 'Out of stock', bg: COLORS.redBg, fg: COLORS.redFg };
  if (r.minQty > 0 && r.stock <= r.minQty) return { text: `Low · ${r.stock}`, bg: COLORS.amberBg, fg: COLORS.amberFg };
  return { text: String(r.stock), bg: COLORS.greenBg, fg: COLORS.greenFg };
}

function drawTable(ctx: Ctx, data: StockReportData): void {
  const { doc, left, right, width } = ctx;
  const { xs, widths } = columnGeometry(ctx);

  drawTableHeader(ctx, xs, widths);

  if (data.rows.length === 0) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(11).text('No products found.', left, doc.y + 10, {
      width,
      align: 'center',
    });
    doc.y += 30;
    return;
  }

  data.rows.forEach((r, i) => {
    // Measure the wrapping cells to size the row, then page-break if needed.
    doc.font('Helvetica').fontSize(10.5);
    const nameH = doc.heightOfString(r.name, { width: widths[0] - 8 });
    doc.fontSize(8.5);
    const strengthH = r.strength ? doc.heightOfString(r.strength, { width: widths[0] - 8 }) : 0;
    doc.fontSize(9.5);
    const catH = doc.heightOfString(r.category || '—', { width: widths[1] - 8 });
    const rowH = Math.max(nameH + strengthH, catH, 16) + 12;

    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      drawTableHeader(ctx, xs, widths);
    }

    const rowTop = doc.y;
    // Zebra background for alternating rows.
    if (i % 2 === 1) {
      doc.rect(left - 4, rowTop - 3, width + 8, rowH).fill(COLORS.zebra);
    }

    const textY = rowTop + 2;
    doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.ink).text(r.name, xs[0], textY, { width: widths[0] - 8 });
    const nameBottom = doc.y;
    if (r.strength) {
      doc.fillColor(COLORS.faint).fontSize(8.5).text(r.strength, xs[0], doc.y, { width: widths[0] - 8 });
    }
    const col0Bottom = doc.y;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9.5).text(r.category || '—', xs[1], textY, { width: widths[1] - 8 });

    // Stock pill (left-aligned in its column).
    const sp = stockPill(r);
    drawPill(doc, xs[2], textY, sp.text, sp.bg, sp.fg);

    doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.ink).text(String(r.minQty), xs[3], textY, { width: widths[3] - 8, align: 'right' });
    doc.text(String(r.onOrder), xs[4], textY, { width: widths[4] - 8, align: 'right' });
    doc
      .font(r.needToOrder > 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(r.needToOrder > 0 ? COLORS.amberFg : COLORS.ink)
      .text(String(r.needToOrder), xs[5], textY, { width: widths[5], align: 'right' });

    doc.y = rowTop + rowH;
    doc.moveTo(left, doc.y - 4).lineTo(right, doc.y - 4).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
  });
  doc.y += 10;
}

function drawNote(ctx: Ctx, data: StockReportData): void {
  const { doc, left, width } = ctx;
  const pad = 14;

  const intro =
    'On Order counts the units still to be received (ordered − already received) from purchase orders that are Pending or Partially Fulfilled. Fulfilled, paid, and cancelled orders are excluded. Need To Order = Min Quantity − (Stock + On Order), and is never below 0.';
  const poLines =
    data.contributingPos.length > 0
      ? data.contributingPos
          .map((po) => `•  ${po.poNumber} — ${PO_STATUS_LABEL[po.status] ?? po.status} · ${po.units} unit${po.units === 1 ? '' : 's'}`)
          .join('\n')
      : '•  No open purchase orders are currently contributing to On Order.';

  doc.font('Helvetica').fontSize(9.5);
  const introH = doc.heightOfString(intro, { width: width - pad * 2 });
  const poH = doc.heightOfString(poLines, { width: width - pad * 2 });
  const boxH = introH + poH + pad * 2 + 40;

  if (doc.y + boxH > bottomLimit(doc)) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
  }
  const startY = doc.y;

  doc.roundedRect(left, startY, width, boxH, 8).fill(COLORS.surface);
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('HOW “ON ORDER” IS CALCULATED', left + pad, startY + pad, { characterSpacing: 0.8 });
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9.5).text(intro, left + pad, startY + pad + 16, {
    width: width - pad * 2,
  });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`PURCHASE ORDERS CONSIDERED (${data.contributingPos.length})`, left + pad, doc.y + 8, { characterSpacing: 0.8 });
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9.5).text(poLines, left + pad, doc.y + 5, {
    width: width - pad * 2,
  });
  doc.y = startY + boxH + 12;
}

/** Draw "Page N of M" + brand on every page once the document is complete. */
function paginateFooters(doc: PDFDoc, left: number, right: number): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 40;
    // The footer sits below the bottom margin, which pdfkit would otherwise
    // treat as overflow and answer with a blank page per footer.
    drawInFooterStrip(doc, () => {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
      doc.fillColor(COLORS.faint).font('Helvetica').fontSize(8.5);
      doc.text('VYTA BIOSCIENCES · Stock Report', left, y + 8, { lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, y + 8, {
        align: 'right',
        width: right - left,
        lineBreak: false,
      });
    });
  }
}

export async function renderStockReportPdf(
  data: StockReportData,
  opts: { generatedAt?: Date } = {},
): Promise<Buffer> {
  const generatedAt = opts.generatedAt ?? new Date();
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: { Title: 'VYTA Stock Report', Author: 'VYTA Biosciences', Creator: 'VYTA Admin' },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const ctx: Ctx = { doc, left, right, width: right - left };

  doc.y = PAGE_MARGIN;
  drawTitle(ctx, generatedAt);
  drawStats(ctx, data);
  drawTable(ctx, data);
  drawNote(ctx, data);
  paginateFooters(doc, left, right);

  doc.end();
  return done;
}
