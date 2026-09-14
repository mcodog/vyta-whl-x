import type { Metadata } from 'next';
import PayClient from './PayClient';

export const metadata: Metadata = {
  title: 'Pay your invoice',
  // A payment link should never end up in a search index.
  robots: { index: false, follow: false },
};

/**
 * /pay/[token] — the page a customer lands on from a payment-request email.
 * Shows their order and asks them to pick a payment method: crypto (an
 * instructions page on this site) or Visa/Mastercard (the PuraMass hosted
 * checkout). The token in the URL is the only credential.
 */
export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PayClient token={token} />;
}
