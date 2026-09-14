# Invoice Customer — New vs. Existing Account Detection

Date: 2026-06-26

When creating an invoice, the customer field lets you type a bare name that is
saved as a guest customer. Previously the only hint was a static line ("…will
be saved as the customer name"). Now the form detects, as you type, whether
that name already belongs to an account and nudges you accordingly.

## Behaviour

Below the customer search box (only when a name is typed and no customer is
linked yet):

- **Existing account found** — if an account whose full name exactly matches
  the typed name already exists, an emerald hint appears:
  _"An account for **Jane Doe** already exists (jane@…). **Use existing
  record**"_. Clicking **Use existing record** links that customer to the
  invoice (and prefills the shipping destination from their saved address),
  avoiding a duplicate.

- **Multiple accounts found** — if several people share the exact typed name
  (e.g. three different "Mark C"), an amber hint lists each match (name, email,
  phone) so the admin links the correct one instead of the form guessing.

- **New account** — if no match is found, a bronze hint appears:
  _"**"Jane Doe"** looks like a new account — it'll be saved as a guest
  customer. **Add phone & address (optional)**"_. Clicking the link opens the
  New Customer dialog so the phone and address can be captured up front.

The match is computed locally from the candidates fetched for the search
dropdown. An email-style query matches on exact email instead of name.

## Customer search fix (full-name / multi-word queries)

The customer search previously ran a single `ilike '%<query>%'` against each of
`first_name`, `last_name`, and `email` independently. A multi-word query like
**"Mark C"** therefore matched **nothing** — no single column holds the full
name (it lives across `first_name="Mark"` + `last_name="C"`), so the row was
filtered out at the database before the client-side ranker (which *does*
understand full names) ever saw it. This also broke the new/existing detection
above, since it reads from those (empty) results — every name looked "new".

The query now splits the input into words and requires **each** word to match
somewhere (first name, last name, or email), combined with AND:
`(first|last|email ~ word₁) AND (first|last|email ~ word₂) …`. So "Mark C"
matches a `Mark` / `C` record, while a single word still matches broadly.

## New Customer dialog — optional address

The New Customer dialog now also collects an **optional address** (street via
the existing address autocomplete, plus city / prov-state / postal / country)
alongside the existing phone field. When opened from the "new account" hint it
shows a short note that phone and address are optional and can be completed
later.

## Persistence

The admin customers API (`POST /api/admin/customers`) now accepts and stores
the optional `shipping_address`, `shipping_city`, `shipping_state`,
`shipping_postal_code`, and `shipping_country` fields on both the guest and
auth-backed create paths. No schema change is required — these columns already
exist on the `customers` table.

## Files

- `components/admin/InvoiceForm.tsx` — exact-name match detection, the new/
  existing hint UI, and the optional address fields in the New Customer dialog.
- `lib/admin/api.ts` — `createCustomer` accepts the optional address fields.
- `app/api/admin/customers/route.ts` — reads and inserts the optional address
  fields.
