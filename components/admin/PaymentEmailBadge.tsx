import React from 'react';
import { MailCheck, MailWarning, MailX, Mail } from 'lucide-react';
import { paymentEmailStatus, type PaymentEmailFields } from '@/lib/admin/paymentEmail';

/**
 * Small chip showing whether a recorded payment sent the customer a
 * confirmation email. Legacy payments (recorded before email tracking shipped)
 * render as a muted "Not tracked" rather than a misleading "Not sent" — we
 * genuinely don't know whether they were emailed.
 *
 * Pass `hideUntracked` to omit the chip entirely for untracked payments when a
 * cleaner list is preferred.
 */
export default function PaymentEmailBadge({
  payment,
  hideUntracked = false,
  className = '',
}: {
  payment: PaymentEmailFields;
  hideUntracked?: boolean;
  className?: string;
}) {
  const status = paymentEmailStatus(payment);

  if (status.kind === 'untracked' && hideUntracked) return null;

  const base =
    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium';

  switch (status.kind) {
    case 'sent': {
      let title = 'Payment confirmation emailed to the customer';
      try {
        title = `Payment confirmation emailed ${new Date(status.at).toLocaleString()}`;
      } catch {
        /* keep default title if the timestamp can't be parsed */
      }
      if (status.by) title += ` by ${status.by}`;
      return (
        <span className={`${base} bg-emerald-500/10 text-emerald-600 ${className}`} title={title}>
          <MailCheck className="w-3 h-3" /> Emailed{status.by ? <span className="font-normal opacity-80"> · {status.by}</span> : null}
        </span>
      );
    }
    case 'failed':
      return (
        <span
          className={`${base} bg-amber-500/10 text-amber-600 ${className}`}
          title={[
            status.error ? `Email failed: ${status.error}` : 'The confirmation email failed to send',
            status.by ? `Attempted by ${status.by}` : '',
          ].filter(Boolean).join(' — ')}
        >
          <MailWarning className="w-3 h-3" /> Email failed
        </span>
      );
    case 'skipped':
      return (
        <span
          className={`${base} bg-ink/5 text-ink-muted ${className}`}
          title="The admin chose not to email the customer for this payment"
        >
          <MailX className="w-3 h-3" /> Not emailed
        </span>
      );
    case 'untracked':
    default:
      return (
        <span
          className={`${base} bg-ink/5 text-ink-muted/80 ${className}`}
          title="This payment predates email tracking — whether the customer was notified isn't recorded"
        >
          <Mail className="w-3 h-3" /> Not tracked
        </span>
      );
  }
}
