import type { Metadata } from 'next';
import CryptoPayClient from './CryptoPayClient';

export const metadata: Metadata = {
  title: 'Pay with crypto',
  robots: { index: false, follow: false },
};

/**
 * /pay/[token]/crypto — the crypto payment instructions. Shows the receiving
 * wallet configured in admin Settings → "Crypto Payments", the exact amount to
 * send, and a form for the customer to hand back their transaction reference so
 * an admin can match the transfer.
 */
export default async function CryptoPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CryptoPayClient token={token} />;
}
