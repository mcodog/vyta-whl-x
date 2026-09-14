import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeAnalyticsSummary, isAdminOrAssistant } from "@/lib/admin/analytics-data";
import {
  reportShell,
  statsGrid,
  table,
  pill,
  escapeHtml,
  formatDate,
  readableDateTime,
  type Stat,
} from "@/lib/admin/report-html";
import { INVOICE_STATUS_META } from "@/lib/admin/invoice-status";
import type { InvoiceCurrency, InvoiceStatus } from "@/lib/supabase";

/** Report sections, in display order. Absent param = show everything. */
const ALL_SECTIONS = ["overview", "revenue", "shipping", "invoices", "operations"] as const;
type SectionKey = (typeof ALL_SECTIONS)[number];

function parseSections(raw: string | null): Set<SectionKey> {
  if (raw === null) return new Set(ALL_SECTIONS);
  const allowed = new Set<string>(ALL_SECTIONS);
  const chosen = new Set(
    raw.split(",").map((s) => s.trim()).filter((k): k is SectionKey => allowed.has(k)),
  );
  return chosen.size > 0 ? chosen : new Set(ALL_SECTIONS);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Money helpers — analytics amounts are nominal (CAD + USD combined) except in
// the currency split and the invoice list, which name their own currency.
const money = (n: number): string => `$${Number(n ?? 0).toFixed(2)}`;
const moneyCur = (n: number, cur: InvoiceCurrency): string => `${money(n)} ${cur}`;

// Map an invoice status to a report pill tone (green/amber/blue/red/grey).
const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "",
  sent: "blue",
  partial: "amber",
  paid: "green",
  overdue: "red",
  cancelled: "red",
};

export async function GET(request: NextRequest) {
  if (!(await isAdminOrAssistant(supabase, request.headers.get("authorization")))) {
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const sections = parseSections(sp.get("sections"));
  const includeDrafts = sp.get("drafts") !== "0";

  let summary;
  try {
    summary = await computeAnalyticsSummary(supabase, { from, to });
  } catch (e) {
    console.error("analytics report error:", e);
    return new NextResponse("Could not generate report", { status: 500 });
  }

  const { inventory, incoming, revenue, shipping, performance } = summary;
  const unpaidInvoiceCount = revenue.invoice_count - revenue.paid_invoice_count;

  const parts: string[] = [];

  // -------- Overview KPIs ----------------------------------------------------
  if (sections.has("overview")) {
    const cards: Stat[] = [
      { label: "Inventory On Hand", value: money(inventory.value), meta: `${inventory.units.toLocaleString()} units · ${inventory.sku_count} SKUs` },
      { label: "Incoming (Open POs)", value: money(incoming.value), meta: `${incoming.units.toLocaleString()} units · ${incoming.po_count} POs` },
      { label: "Revenue Paid", value: money(revenue.paid), tone: "paid", meta: `${revenue.paid_invoice_count} paid invoice${revenue.paid_invoice_count === 1 ? "" : "s"}` },
      { label: "Outstanding", value: money(revenue.outstanding), tone: revenue.outstanding > 0 ? "pending" : "default", meta: `${unpaidInvoiceCount} unpaid` },
    ];
    parts.push(`<h2>Overview</h2>${statsGrid(cards)}`);
  }

  // -------- Revenue breakdown ------------------------------------------------
  if (sections.has("revenue")) {
    const pct = revenue.invoiced > 0 ? Math.round((revenue.paid / revenue.invoiced) * 100) : 0;
    const revCards: Stat[] = [
      { label: "Invoiced", value: money(revenue.invoiced), meta: `${revenue.invoice_count} invoice${revenue.invoice_count === 1 ? "" : "s"}` },
      { label: "Paid", value: money(revenue.paid), tone: "paid", meta: `${pct}% collected` },
      { label: "Outstanding", value: money(revenue.outstanding), tone: revenue.outstanding > 0 ? "pending" : "default" },
    ];
    // Currency split (CAD / USD tracked separately, never converted).
    const curRows = (["CAD", "USD"] as InvoiceCurrency[]).map((cur) => {
      const c = revenue.by_currency[cur];
      return [
        `<strong>${cur}</strong>`,
        moneyCur(c.invoiced, cur),
        moneyCur(c.paid, cur),
        moneyCur(c.outstanding, cur),
        `${c.paid_invoice_count} / ${c.invoice_count}`,
      ];
    });
    parts.push(
      `<h2>Revenue</h2>${statsGrid(revCards)}` +
      `<h2>By currency</h2>` +
      table(
        [
          { header: "Currency" },
          { header: "Invoiced", num: true },
          { header: "Paid", num: true },
          { header: "Outstanding", num: true },
          { header: "Paid / total", num: true },
        ],
        curRows,
      ),
    );
  }

  // -------- Shipping earnings ------------------------------------------------
  // Gross shipping revenue (carrier cost is never persisted) — see
  // lib/admin/shipping-earnings.ts.
  if (sections.has("shipping")) {
    const collectedPct =
      shipping.charged > 0 ? Math.round((shipping.collected / shipping.charged) * 100) : 0;
    const shipCards: Stat[] = [
      {
        label: "Shipping Billed",
        value: money(shipping.charged),
        meta: `${shipping.invoice_count} of ${revenue.invoice_count} invoice${revenue.invoice_count === 1 ? "" : "s"}`,
      },
      { label: "Collected", value: money(shipping.collected), tone: "paid", meta: `${collectedPct}% collected` },
      {
        label: "Uncollected",
        value: money(shipping.uncollected),
        tone: shipping.uncollected > 0 ? "pending" : "default",
      },
      {
        label: "Avg per Invoice",
        value: money(shipping.avg_per_invoice),
        meta: `${shipping.share_of_invoiced.toFixed(1)}% of invoiced revenue`,
      },
    ];

    const shipCurRows = (["CAD", "USD"] as InvoiceCurrency[]).map((cur) => {
      const c = shipping.by_currency[cur];
      return [
        `<strong>${cur}</strong>`,
        moneyCur(c.charged, cur),
        moneyCur(c.collected, cur),
        moneyCur(c.uncollected, cur),
        String(c.invoice_count),
      ];
    });

    const shipMonthRows = shipping.monthly.map((m) => [
      m.month,
      money(m.charged),
      money(m.collected),
      money(Math.max(0, Number((m.charged - m.collected).toFixed(2)))),
    ]);

    parts.push(
      `<h2>Shipping earnings</h2>${statsGrid(shipCards)}` +
      `<p class="muted">Shipping billed on invoices — the live carrier rate plus the handling fee. ` +
      `Carrier cost is not stored against the order, so these are gross figures. Collected is pro-rated ` +
      `by how much of each invoice has been paid.</p>` +
      `<h2>Shipping by currency</h2>` +
      table(
        [
          { header: "Currency" },
          { header: "Billed", num: true },
          { header: "Collected", num: true },
          { header: "Uncollected", num: true },
          { header: "Invoices", num: true },
        ],
        shipCurRows,
      ) +
      `<h2>Shipping by month</h2>` +
      table(
        [
          { header: "Month" },
          { header: "Billed", num: true },
          { header: "Collected", num: true },
          { header: "Uncollected", num: true },
        ],
        shipMonthRows,
        "No shipping was billed in this range.",
      ),
    );
  }

  // -------- Invoice audit list -----------------------------------------------
  if (sections.has("invoices")) {
    const list = includeDrafts
      ? revenue.invoices
      : revenue.invoices.filter((inv) => inv.status !== "draft");

    const rows = list.map((inv) => [
      `<span class="mono">${escapeHtml(inv.invoice_number)}</span>`,
      formatDate(inv.issue_date),
      escapeHtml(inv.customer_name ?? "Guest"),
      pill(INVOICE_STATUS_META[inv.status].label, STATUS_TONE[inv.status]),
      inv.currency,
      moneyCur(inv.total, inv.currency),
      moneyCur(inv.paid, inv.currency),
    ]);

    // Per-currency totals appended as bold trailing rows (amounts never mix).
    for (const cur of ["CAD", "USD"] as InvoiceCurrency[]) {
      const inCur = list.filter((inv) => inv.currency === cur);
      if (inCur.length === 0) continue;
      const total = inCur.reduce((s, inv) => s + inv.total, 0);
      const paid = inCur.reduce((s, inv) => s + inv.paid, 0);
      rows.push([
        "",
        "",
        `<strong>Total · ${cur}</strong>`,
        `${inCur.length} inv.`,
        cur,
        `<strong>${moneyCur(total, cur)}</strong>`,
        `<strong>${moneyCur(paid, cur)}</strong>`,
      ]);
    }

    parts.push(
      `<h2>Invoices in computation (${list.length})</h2>` +
      table(
        [
          { header: "Invoice #" },
          { header: "Date" },
          { header: "Customer" },
          { header: "Status" },
          { header: "Currency" },
          { header: "Total", num: true },
          { header: "Paid", num: true },
        ],
        rows,
        "No invoices contribute to revenue for this range.",
      ),
    );
  }

  // -------- Inventory & Performance ------------------------------------------
  if (sections.has("operations")) {
    const invCards: Stat[] = [
      { label: "Total units", value: inventory.units.toLocaleString() },
      { label: "Total value", value: money(inventory.value) },
      { label: "SKUs tracked", value: String(inventory.sku_count) },
      { label: "Low stock SKUs", value: String(inventory.low_stock_count), tone: inventory.low_stock_count > 0 ? "danger" : "default" },
    ];
    parts.push(`<h2>Inventory snapshot</h2>${statsGrid(invCards)}`);

    // Open purchase orders.
    const poRows = incoming.pos.map((po) => [
      `<span class="mono">${escapeHtml(po.po_number)}</span>`,
      escapeHtml(po.supplier_name ?? "—"),
      escapeHtml(po.status.replace(/_/g, " ")),
      formatDate(po.expected_date),
      money(po.total),
    ]);
    parts.push(
      `<h2>Open purchase orders (${incoming.po_count})</h2>` +
      table(
        [
          { header: "PO #" },
          { header: "Supplier" },
          { header: "Status" },
          { header: "Expected" },
          { header: "Total", num: true },
        ],
        poRows,
        "No open purchase orders.",
      ),
    );

    // Leaderboards. Revenue is nominal (CAD + USD combined).
    const lb = (
      title: string,
      entries: { name: string; revenue: number; invoice_count: number }[],
      empty: string,
    ) =>
      `<h2>${escapeHtml(title)}</h2>` +
      table(
        [{ header: "#" }, { header: "Name" }, { header: "Invoices", num: true }, { header: "Revenue", num: true }],
        entries.map((e, i) => [
          String(i + 1),
          escapeHtml(e.name),
          String(e.invoice_count),
          money(e.revenue),
        ]),
        empty,
      );

    parts.push(
      `<h2>Top-selling products</h2>` +
      table(
        [{ header: "#" }, { header: "Product" }, { header: "Units", num: true }, { header: "Revenue", num: true }],
        performance.top_products.map((p, i) => [
          String(i + 1),
          escapeHtml(p.name),
          p.units.toLocaleString(),
          money(p.revenue),
        ]),
        "No products sold in this range yet.",
      ),
    );
    parts.push(lb("Top customers", performance.top_customers, "No customer revenue yet."));
    parts.push(lb("Top sales people", performance.top_sales_persons, "No sales attributed yet."));
    parts.push(lb("Top affiliates", performance.top_affiliates, "No affiliate revenue yet."));
  }

  const filters: string[] = [];
  filters.push(from || to ? `Range: ${from ?? "…"} → ${to ?? "…"}` : "Range: All time");
  if (sections.has("invoices")) filters.push(includeDrafts ? "Drafts included" : "Drafts excluded");

  const meta = [
    `Generated ${readableDateTime()}`,
    from || to ? `${from ?? "start"} → ${to ?? "today"}` : "All time",
    "Amounts nominal; CAD & USD split shown separately",
  ];

  const html = reportShell({
    title: "Analytics Report",
    branded: true,
    meta,
    filters,
    body: parts.join("\n"),
    footRight: `${revenue.invoice_count} revenue invoice${revenue.invoice_count === 1 ? "" : "s"}`,
    autoPrint: sp.get("print") !== "0",
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
