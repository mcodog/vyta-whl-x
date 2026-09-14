import { redirect } from 'next/navigation';

// The standalone order-tracking page has been retired for now (it surfaced
// "order not found" errors). Any link to /order/track — including ones already
// sent out in past emails — now sends the customer to their account dashboard,
// where their orders and tracking live.
export default function OrderTrackRedirect() {
  redirect('/account/dashboard');
}
