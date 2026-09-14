// Shared box/vial unit helpers.
//
// Stock is counted in vials (the smallest unit shipped); a product's
// `vials_per_box` converts between boxes and vials. Invoice/order line items
// are quantified in the line's own unit (box or vial) via `price_type`, so any
// comparison against stock — or any stock display in a chosen unit — has to
// normalise through these helpers.

/** vials_per_box with the shared fallback (defaults to 10, guards <= 0). */
export function resolveVialsPerBox(vialsPerBox: number | null | undefined): number {
  return vialsPerBox && vialsPerBox > 0 ? vialsPerBox : 10;
}

/**
 * Vials that a quantity in the line's price unit represents. Box lines multiply
 * by vials_per_box; vial lines are already counted in vials.
 */
export function qtyToVials(
  qty: number,
  vialsPerBox: number | null | undefined,
  priceType: "box" | "vial" | null | undefined,
): number {
  const q = Number(qty) || 0;
  return priceType === "vial" ? q : q * resolveVialsPerBox(vialsPerBox);
}

/**
 * Present a vial stock count in a chosen display unit. Vial mode shows the raw
 * vial count; box mode shows whole boxes plus any leftover vials (e.g.
 * "5 boxes", "5 boxes + 3 vials", "3 vials"), matching the products page.
 */
export function formatStockInUnit(
  vials: number,
  vialsPerBox: number | null | undefined,
  unit: "box" | "vial",
): string {
  const v = Number(vials) || 0;
  if (unit === "vial") return `${v} vial${v === 1 ? "" : "s"}`;
  const per = resolveVialsPerBox(vialsPerBox);
  const boxes = Math.floor(v / per);
  const rem = v % per;
  if (boxes === 0) return `${rem} vial${rem === 1 ? "" : "s"}`;
  const boxLabel = `${boxes} box${boxes === 1 ? "" : "es"}`;
  return rem > 0 ? `${boxLabel} + ${rem} vial${rem === 1 ? "" : "s"}` : boxLabel;
}
