# `import-invoice` Edge Function (receiving side)

Deploy this on the **website that receives invoices**. The sending site
(aminocan admin → Invoices → *Send to site*) POSTs invoice payloads here; the
function validates them and writes the invoice, its line items, and payments
into the receiving project's database.

## What it does

Every request runs two checks and reports them back:

1. **Schema check** — confirms the receiving `invoices`, `invoice_line_items`,
   `payments`, `customers`, and `products` tables have the columns it wants to
   write. It separates:
   - `missing_required` / `missing_tables` — columns/tables that MUST exist. If
     any are missing, `columns_ok` is `false` and a commit is refused.
   - `missing_columns` — optional columns the sender includes but you don't have
     (e.g. `tax_rate`, `processing_fee`, `show_processing_fee`, `with_labels`).
     These values are simply dropped and reported, never fatal — so a *similar*
     schema works without being identical.
   `payments` is optional entirely: if you have no `payments` table, payments are
   skipped (`payments_skipped: true`) and the rest still imports.
2. **Existence check** — reports whether the invoice (by `invoice_number`), the
   customer (by `email`), and each product (by `sku`) already exist here.

- `mode: "preview"` → runs both checks and returns the report. **Writes
  nothing.** This is what the sender shows the admin before firing.
- `mode: "commit"` → matches the customer by email and each product by SKU,
  **creating them if missing**, then inserts the invoice + line items +
  payments. If the invoice number already exists it is **skipped** unless
  `overwrite: true` is sent, in which case the existing invoice is replaced.

## Auth

The sender puts the destination's shared secret in `Authorization: Bearer
<secret>`. This function compares it against the `IMPORT_INVOICE_SECRET`
secret. They must match.

## Deploy

```bash
# from the receiving project
supabase functions deploy import-invoice --no-verify-jwt

# set the shared secret (use the SAME value in the sender's destination config)
supabase secrets set IMPORT_INVOICE_SECRET="<a-long-random-string>"
```

> `--no-verify-jwt` is required because the sender authenticates with the
> shared secret, not a Supabase user JWT. The function does its own auth.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Edge runtime — you do not set them.

The function URL is then:

```
https://<your-project-ref>.supabase.co/functions/v1/import-invoice
```

## Configure the sender

On the sending site: **Admin → Settings → Invoice Export Destinations → Add
destination**, and enter:

- **Label** — any name (e.g. "EU store")
- **Edge Function URL** — the URL above
- **Shared secret** — the same value you passed to `supabase secrets set`

## Notes / assumptions

- Customers are created with a placeholder `password_hash` (`imported-no-login`)
  and `role = customer`; imported customers can't sign in until they reset their
  password. Adjust if your `customers` table has different NOT NULL columns.
- Products created from a SKU get `name`, `sku`, `price` (from the line's unit
  price), `strength`, and `active = true`. Fill in the rest on the receiving
  side afterwards if needed.
- Invoice `status` is passed through verbatim. If your `invoices.status` CHECK
  constraint is stricter than the sender's, a value like `draft`/`overdue` could
  be rejected — the failure is reported back to the sender.
