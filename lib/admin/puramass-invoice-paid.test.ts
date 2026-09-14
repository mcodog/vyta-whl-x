import { describe, expect, it } from "vitest";
import { markPuramassInvoicePaid } from "./invoices";

/**
 * Flipping a hosted-checkout invoice to paid.
 *
 * The invoice is now raised at checkout in `pending_payment` and settled by the
 * payment webhook. Webhook delivery is at-least-once, so this has to be safe to
 * run twice — and it must not stomp on an invoice a human has moved since,
 * because the payment event says nothing about what an admin did in between.
 */

/** A minimal `from('invoices')` stub recording whatever update is applied. */
function makeDb(invoice: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table !== "invoices") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: invoice, error: null }) }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { db: db as any, updates };
}

const PENDING = {
  id: "inv-1",
  status: "pending_payment",
  order_id: null,
  notes: "Stealth Health order — transaction abc.",
};

describe("markPuramassInvoicePaid", () => {
  it("flips a pending invoice to paid", async () => {
    const { db, updates } = makeDb(PENDING);
    const result = await markPuramassInvoicePaid(db, "inv-1");

    expect(result.updated).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("paid");
  });

  it("links the order row carrying the shipment", async () => {
    const { db, updates } = makeDb(PENDING);
    await markPuramassInvoicePaid(db, "inv-1", { orderId: "ord-9" });
    expect(updates[0].order_id).toBe("ord-9");
  });

  it("does not steal an order the invoice is already linked to", async () => {
    const { db, updates } = makeDb({ ...PENDING, order_id: "ord-existing" });
    await markPuramassInvoicePaid(db, "inv-1", { orderId: "ord-9" });
    expect(updates[0]).not.toHaveProperty("order_id");
  });

  it("names the courier in the notes", async () => {
    const { db, updates } = makeDb(PENDING);
    await markPuramassInvoicePaid(db, "inv-1", { courier: "UPS Standard" });
    expect(String(updates[0].notes)).toContain("UPS Standard");
  });

  it("does not repeat a courier already named in the notes", async () => {
    const { db, updates } = makeDb({
      ...PENDING,
      notes: "Stealth Health order. Shipping by UPS Standard.",
    });
    await markPuramassInvoicePaid(db, "inv-1", { courier: "UPS Standard" });
    expect(String(updates[0].notes).match(/UPS Standard/g)).toHaveLength(1);
  });

  // At-least-once delivery: the same payment event can arrive twice.
  it("leaves an already-paid invoice alone", async () => {
    const { db, updates } = makeDb({ ...PENDING, status: "paid" });
    const result = await markPuramassInvoicePaid(db, "inv-1");

    expect(result.updated).toBe(false);
    expect(result.reason).toBe("Already paid");
    expect(updates).toHaveLength(0);
  });

  // A human moved it since the hand-off — the payment event is not authority to
  // undo that, so it is reported rather than overwritten.
  it("refuses to overwrite an invoice in any other state", async () => {
    for (const status of ["cancelled", "partial", "draft", "sent"]) {
      const { db, updates } = makeDb({ ...PENDING, status });
      const result = await markPuramassInvoicePaid(db, "inv-1");

      expect(result.updated).toBe(false);
      expect(result.reason).toBe(`Invoice is ${status}`);
      expect(updates).toHaveLength(0);
    }
  });

  it("reports a missing invoice rather than throwing", async () => {
    const { db, updates } = makeDb(null);
    const result = await markPuramassInvoicePaid(db, "inv-gone");

    expect(result.updated).toBe(false);
    expect(result.reason).toBe("Invoice not found");
    expect(updates).toHaveLength(0);
  });
});
