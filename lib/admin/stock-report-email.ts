/**
 * Builds the Stock Report email — a short HTML summary in the body with the
 * full report attached as a PDF — and sends it.
 *
 * The figures come from the same `computeStockReport` used by the printable
 * report, and the attached PDF is produced by `renderStockReportPdf`, so the
 * emailed report can never drift from the on-screen one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { computeStockReport, type StockReportData } from '@/lib/admin/stock-report';
import { renderStockReportPdf } from '@/lib/admin/stock-report-pdf';
import { renderStockReportCsv } from '@/lib/admin/stock-report-csv';
import { escapeHtml } from '@/lib/admin/report-html';

function statTile(label: string, value: string, meta: string, danger = false): string {
  return `
    <td style="padding:6px;" valign="top">
      <div style="border:1px solid #DCE7EB; border-radius:10px; padding:14px;">
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:#4E6E85; margin-bottom:6px;">${escapeHtml(label)}</div>
        <div style="font-size:18px; font-weight:700; color:${danger ? '#B91C1C' : '#07203A'};">${escapeHtml(value)}</div>
        <div style="font-size:11px; color:#4E6E85; margin-top:2px;">${escapeHtml(meta)}</div>
      </div>
    </td>`;
}

/**
 * A short HTML summary for the email body. The full per-product breakdown lives
 * in the attached PDF, so the body only carries the headline figures.
 */
export function renderStockReportEmailHtml(
  data: StockReportData,
  opts: { generatedAt?: Date; siteUrl?: string; pdfFilename?: string; csvFilename?: string } = {},
): string {
  const { totals } = data;
  const generated = (opts.generatedAt ?? new Date()).toLocaleString();
  const baseUrl = opts.siteUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://puramass.com';
  const filename = opts.pdfFilename || 'stock-report.pdf';
  const csvName = opts.csvFilename || 'stock-report.csv';

  return `
  <div style="max-width:640px; margin:0 auto; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#FFFFFF; color:#07203A;">
    <div style="padding:28px 24px; text-align:center; border-bottom:2px solid #07203A;">
      <h1 style="font-size:24px; font-weight:700; letter-spacing:5px; margin:0;">VYTA</h1>
      <p style="font-size:10px; letter-spacing:4px; margin:6px 0 0;">BIOSCIENCES</p>
      <p style="font-size:11px; letter-spacing:0.15em; color:#438B9E; margin:4px 0 0; text-transform:uppercase;">Stock Report</p>
    </div>

    <div style="padding:24px;">
      <p style="font-size:13px; color:#4E6E85; margin:0 0 18px;">Generated ${escapeHtml(generated)}</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate; margin-bottom:18px;">
        <tr>
          ${statTile('Products', String(totals.products), `${totals.active} active`)}
          ${statTile('Stock On Hand', `${totals.units} units`, `${totals.lowStock} low · ${totals.outOfStock} out`)}
          ${statTile('On Order', `${totals.onOrder} units`, 'open purchase orders')}
          ${statTile('Need To Order', `${totals.needToOrder} units`, `${totals.needCount} product${totals.needCount === 1 ? '' : 's'}`, totals.needToOrder > 0)}
        </tr>
      </table>

      <div style="background:#F7FAFB; border:1px solid #DCE7EB; border-radius:10px; padding:16px; text-align:center;">
        <p style="font-size:14px; color:#07203A; margin:0; font-weight:600;">📎 Full Stock Report attached</p>
        <p style="font-size:12px; color:#4E6E85; margin:6px 0 0;">
          The complete per-product breakdown (stock, min quantity, on order, need to order) is
          attached as a PDF (<strong>${escapeHtml(filename)}</strong>) and a spreadsheet
          (<strong>${escapeHtml(csvName)}</strong>).
        </p>
      </div>

      <div style="text-align:center; margin-top:22px;">
        <a href="${baseUrl}/admin/products" style="display:inline-block; padding:12px 24px; background:#07203A; color:#FFFFFF; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">
          Open Products in Admin
        </a>
      </div>
    </div>

    <div style="padding:20px 24px; text-align:center; background:#F7FAFB; border-top:1px solid #DCE7EB;">
      <p style="font-size:11px; color:#8FA9B6; margin:0;">Automated Stock Report from VYTA Admin</p>
    </div>
  </div>`;
}

/** Build a `stock-report-YYYY-MM-DD.<ext>` filename. */
function reportFilename(now: Date, ext: string): string {
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `stock-report-${iso}.${ext}`;
}

/**
 * Compute the full (unfiltered) Stock Report and email it (summary in the body,
 * the full report attached as both a PDF and a CSV) to the given recipients.
 * Returns the send result plus the report totals. Does NOT stamp any "last
 * sent" marker — the caller owns scheduling.
 */
export async function sendStockReportEmail(
  db: SupabaseClient,
  recipients: string[],
  opts: { siteUrl?: string } = {},
): Promise<{ success: boolean; error?: string; totals?: StockReportData['totals'] }> {
  const to = recipients.map((r) => r.trim()).filter(Boolean);
  if (to.length === 0) return { success: false, error: 'No recipients configured' };

  const now = new Date();
  const data = await computeStockReport(db, {});
  const pdfName = reportFilename(now, 'pdf');
  const csvName = reportFilename(now, 'csv');

  let pdf: Buffer;
  try {
    pdf = await renderStockReportPdf(data, { generatedAt: now });
  } catch (e) {
    console.error('sendStockReportEmail: PDF render failed:', e);
    return { success: false, error: 'Failed to generate report PDF' };
  }
  const csv = Buffer.from(renderStockReportCsv(data), 'utf-8');

  const html = renderStockReportEmailHtml(data, {
    generatedAt: now,
    siteUrl: opts.siteUrl,
    pdfFilename: pdfName,
    csvFilename: csvName,
  });
  const needLine =
    data.totals.needToOrder > 0
      ? ` — ${data.totals.needToOrder} unit${data.totals.needToOrder === 1 ? '' : 's'} to order`
      : '';
  const subject = `VYTA Stock Report (${data.totals.products} products${needLine})`;

  const res = await sendEmail({
    to,
    subject,
    html,
    attachments: [
      { filename: pdfName, content: pdf, contentType: 'application/pdf' },
      { filename: csvName, content: csv, contentType: 'text/csv' },
    ],
  });
  return { success: res.success, error: res.error, totals: data.totals };
}
