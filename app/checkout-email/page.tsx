import { redirect } from 'next/navigation';

export default function CheckoutEmailRedirect() {
  redirect('/checkout');
}
