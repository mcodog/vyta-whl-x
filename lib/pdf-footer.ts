/**
 * Shared pdfkit footer helper.
 *
 * Every branded document draws its footer *below* the text area — on the strip
 * between the bottom margin and the page edge. pdfkit treats that strip as
 * overflow: writing there pushes the text onto a fresh page, so each finished
 * page grew a blank twin (a 3-row price list came out as two pages; a 60-row
 * one as six).
 *
 * Lifting the page's bottom margin for the duration of the footer tells pdfkit
 * the strip is fair game, and restoring it afterwards leaves the document's
 * flow untouched. Call it once per page, after `switchToPage` when the renderer
 * paginates buffered pages.
 */

/** Minimal shape of the pdfkit document this helper touches. */
interface PdfLike {
  page: { margins: { bottom: number } };
}

/** Run `draw` with the current page's bottom margin lifted. */
export function drawInFooterStrip(doc: PdfLike, draw: () => void): void {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  try {
    draw();
  } finally {
    doc.page.margins.bottom = bottom;
  }
}
