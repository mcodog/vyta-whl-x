# Easyship Records Use the Client's Info on Client Shipments

Date: 2026-08-05

When an admin creates or edits an invoice with **Ships to a Client** turned on
and also opts into an **Easyship** shipment, the Easyship record now carries the
**client's** own name, address, and contact — the person actually receiving the
parcel — instead of the customer's. Email and phone stay optional on the client
and fall back to the customer's, then a house default, so a missing client
contact never blocks the label.

The customer **Ship to** box in _Invoice Details_ also collapses once a client
shipment is in play, since those fields no longer describe the destination.

## What changed

- **Easyship recipient = the client.** For a client shipment the order (and the
  Easyship shipment built from it) is now addressed under the client's own
  first/last name, not the customer's. The client's name falls back to the
  customer's only when the client record has no name on file, so the courier
  label always has a recipient.
- **Client email reaches the label.** The Easyship destination email now prefers
  the shipping address's own email (the client's) over the account email, then
  the sender contact, then the house default. Phone already followed the
  client → customer → default chain.
- **Readiness prices the real destination.** The live Easyship readiness /
  courier-rate check on the invoice form now quotes against the **client's**
  address when shipping to a client, instead of the (usually empty) customer
  Ship-to fields. Previously a client shipment could read as "Not ready" — and
  silently create no shipment — because the check looked at the wrong address.
- **Collapsed customer Ship-to box.** With **Ships to a Client** on, the _Ship
  to_ section inside _Invoice Details_ auto-collapses to a header with a
  "Customer details only" chip. Hovering it explains the fields are just for
  viewing/editing the customer's own contact details on file — not the shipment.
  The admin can still expand it.
- **Confirmation dialog note.** The "Create Easyship shipment?" dialog now shows
  which client the parcel ships to and that the client's address/contact are
  used (with a house-default fallback for a blank phone/email).

## Implementation notes

- `buildClientShipAddress` (`lib/admin/order-sync.ts`) now seeds `firstName` /
  `lastName` from the client, falling back to the customer's name only when the
  client has none. It backs both the create path
  (`app/api/admin/invoices/route.ts`) and the edit-time order sync
  (`syncOrderFromInvoice`), so both keep the order's shipping address pointed at
  the client.
- `createEasyshipShipment` (`lib/shipping/easyship.ts`) swaps its destination
  `contact_email` precedence to `ship.email || order.email || …`. Store-checkout
  orders set `order.email` to the shipping address's own email, so this is a
  no-op for them and only corrects the client-shipment case.
- In `components/admin/InvoiceForm.tsx`, `clientScenarioActive` is hoisted above
  the readiness effect and a new `activeClient` (the selected saved client or the
  in-progress new-client form) drives the readiness destination. A
  `shipToCollapsed` state, synced to `clientScenarioActive`, collapses the
  customer Ship-to box while letting a manual expand stick.
