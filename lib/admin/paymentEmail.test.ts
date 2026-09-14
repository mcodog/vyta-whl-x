import { describe, it, expect } from "vitest";
import { paymentEmailStatus } from "./paymentEmail";

describe("paymentEmailStatus", () => {
  it("treats a payment with neither field set as untracked (pre-feature)", () => {
    expect(paymentEmailStatus({})).toEqual({ kind: "untracked" });
    expect(
      paymentEmailStatus({ email_requested: null, email_sent_at: null, email_error: null }),
    ).toEqual({ kind: "untracked" });
  });

  it("reports a successful send as sent, carrying the timestamp and sender", () => {
    expect(
      paymentEmailStatus({
        email_requested: true,
        email_sent_at: "2026-08-02T10:00:00Z",
        email_sent_by_email: "admin@aminocan.com",
      }),
    ).toEqual({ kind: "sent", at: "2026-08-02T10:00:00Z", by: "admin@aminocan.com" });
  });

  it("defaults the sender to null when it wasn't recorded", () => {
    expect(
      paymentEmailStatus({ email_requested: true, email_sent_at: "2026-08-02T10:00:00Z" }),
    ).toEqual({ kind: "sent", at: "2026-08-02T10:00:00Z", by: null });
  });

  it("prefers sent over any error when both somehow present", () => {
    expect(
      paymentEmailStatus({
        email_requested: true,
        email_sent_at: "2026-08-02T10:00:00Z",
        email_error: "stale error",
      }),
    ).toEqual({ kind: "sent", at: "2026-08-02T10:00:00Z", by: null });
  });

  it("reports a requested-but-unsent payment as failed, with the error and sender", () => {
    expect(
      paymentEmailStatus({
        email_requested: true,
        email_sent_at: null,
        email_error: "SMTP down",
        email_sent_by_email: "admin@aminocan.com",
      }),
    ).toEqual({ kind: "failed", error: "SMTP down", by: "admin@aminocan.com" });
  });

  it("reports a requested-but-unsent payment as failed even without an error string", () => {
    expect(paymentEmailStatus({ email_requested: true })).toEqual({
      kind: "failed",
      error: null,
      by: null,
    });
  });

  it("reports an explicit no-send as skipped", () => {
    expect(paymentEmailStatus({ email_requested: false })).toEqual({ kind: "skipped" });
  });
});
