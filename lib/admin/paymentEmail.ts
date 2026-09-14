import type { Payment } from "@/lib/supabase";

/**
 * The confirmation-email state of a recorded payment, derived from the tracking
 * columns set at record time. Distinguishes payments recorded before the email
 * toggle shipped ("untracked") from ones the admin deliberately did not send
 * ("skipped"), so the UI never claims a legacy payment "wasn't emailed" when we
 * simply don't know.
 */
export type PaymentEmailStatus =
  | { kind: "untracked" }
  | { kind: "sent"; at: string; by: string | null }
  | { kind: "failed"; error: string | null; by: string | null }
  | { kind: "skipped" };

/** The subset of Payment fields this helper reads. */
export type PaymentEmailFields = Pick<
  Payment,
  "email_requested" | "email_sent_at" | "email_error" | "email_sent_by_email"
>;

/**
 * Reduce a payment's email tracking columns to a single display status.
 *
 * Precedence:
 *  - a successful send wins (`email_sent_at` present) → "sent";
 *  - a requested-but-unsent payment → "failed" (carries the error, if any);
 *  - an explicit no-send (`email_requested === false`) → "skipped";
 *  - anything else (both null/undefined — a pre-feature row) → "untracked".
 */
export function paymentEmailStatus(p: PaymentEmailFields): PaymentEmailStatus {
  const by = p.email_sent_by_email ?? null;
  if (p.email_sent_at) return { kind: "sent", at: p.email_sent_at, by };
  if (p.email_requested === true) return { kind: "failed", error: p.email_error ?? null, by };
  if (p.email_requested === false) return { kind: "skipped" };
  return { kind: "untracked" };
}
