# Module 12 — Sales People

A back-office CRM-lite module for managing **sales people** (internal reps, distinct from affiliates) and surfacing the **sales commissions** they have earned on invoices. The admin page `/admin/sales-people` lists every sales person with their commission rate plus rolled-up commission stats (invoice count, paid earnings, pending earnings) and supports create / edit / activate-toggle / delete via modals. A sales person can be attached to an invoice (`invoices.sales_person_id` + a snapshotted rate/amount), and a `sales_commissions` ledger records each earned commission with a `pending`/`paid`/`cancelled` status. This module is for **internal salespeople only** — it is NOT the affiliate program.

> **Affiliate note (STRIP):** This module is intentionally separate from the affiliate commission system (`affiliates`, `referral_codes`, `commissions` tables, `/admin/affiliates`). Do **not** port any affiliate commission logic. Everything documented here uses the `sales_persons` / `sales_commissions` tables and the `invoices.sales_person_*` columns only.

---

## Data model

From `invoice-sales-features-migration.sql`.

### `sales_persons`

```sql
CREATE TABLE IF NOT EXISTS sales_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  commission_rate numeric(5,2) NOT NULL DEFAULT 5.00,
  notes text,
  active boolean NOT NULL DEFAULT true,
  total_earnings numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
- Indexes: `idx_sales_persons_active (active)`, `idx_sales_persons_name (lower(last_name), lower(first_name))`.
- Trigger: `sales_persons_updated_at BEFORE UPDATE … EXECUTE FUNCTION set_updated_at()` (shared `set_updated_at` function must exist).
- `commission_rate` is a **percentage** (e.g. `5.00` = 5%). `total_earnings` exists on the row but the admin UI computes earnings live from `sales_commissions` rather than reading this column.

### `invoices` — sales-person columns (added by same migration)

```sql
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS sales_person_id uuid REFERENCES sales_persons (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_person_commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_person_commission_amount numeric(10,2) NOT NULL DEFAULT 0;
```
- Index: `idx_invoices_sales_person_id (sales_person_id)`.
- On sales-person delete, the invoice keeps its totals but `sales_person_id` becomes `NULL` (`ON DELETE SET NULL`). The rate/amount are **snapshots** taken at invoice time.

### `sales_commissions`

```sql
CREATE TABLE IF NOT EXISTS sales_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id uuid NOT NULL REFERENCES sales_persons (id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL,
  invoice_total numeric(10,2) NOT NULL,
  commission_rate numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```
- Indexes: `idx_sales_commissions_sales_person_id`, `idx_sales_commissions_invoice_id`, `idx_sales_commissions_status`.
- **Deleting a sales person CASCADE-deletes their commission rows** (the delete dialog warns about this). Deleting an invoice sets `invoice_id` NULL on the commission.
- Commission rows are written automatically when an invoice has a `sales_person_id` and a non-zero commission amount (logic lives in the Invoices module, not in this module's files).

### RLS (both tables `ENABLE ROW LEVEL SECURITY`)
- `sales_persons_admin_read` / `sales_commissions_admin_read` — `FOR SELECT TO authenticated USING (… c.role IN ('admin','assistant'))`.
- `sales_persons_admin_write` / `sales_commissions_admin_write` — `FOR ALL TO authenticated USING (… c.role = 'admin') WITH CHECK (… c.role = 'admin')`.

### TypeScript shapes (`lib/supabase.ts`)
```ts
interface SalesPerson {
  id; first_name; last_name; email: string|null; phone: string|null;
  commission_rate: number; notes: string|null; active: boolean;
  total_earnings: number; created_at; updated_at;
}
type SalesCommissionStatus = "pending" | "paid" | "cancelled";
interface SalesCommission {
  id; sales_person_id; invoice_id: string|null; amount; invoice_total;
  commission_rate; status: SalesCommissionStatus; paid_at: string|null; created_at;
}
```
Plus the page-level derived type in `lib/admin/sales-persons.ts`:
```ts
type SalesPersonWithStats = SalesPerson & {
  paid_earnings: number; pending_earnings: number; invoice_count: number;
};
```

---

## API endpoints

### `app/api/admin/sales-persons/route.ts`
Both use the **service-role** client; `getRole(request)` reads the Bearer token → `getUser` → `customers.role`.

#### `GET /api/admin/sales-persons`
- **Auth:** `role` must be `admin` or `assistant` else `403 {error:'Unauthorized'}`.
- **Logic:** `select('*').order('last_name')`.
- **Response:** `200 { sales_persons: SalesPerson[] }`; `500 {error}` on DB error.

#### `POST /api/admin/sales-persons`
- **Auth:** `canCreate(role)` (admin only) else `403 {error:'Unauthorized - Admin role required'}`.
- **Request:** `{ first_name, last_name, email?, phone?, commission_rate?, notes?, active? }`. `first_name` and `last_name` required (trimmed) else `400 {error:'First and last name are required'}`.
- **Insert defaults:** `email/phone/notes → null`, `commission_rate ?? 5`, `active ?? true`.
- **Response:** `201 { sales_person: SalesPerson }`; `500 {error}`.

### `app/api/admin/sales-persons/[id]/route.ts`

#### `PATCH /api/admin/sales-persons/[id]`
- **Auth:** `canCreate(role)` (admin only) else `403`.
- **Request:** any subset of `first_name, last_name, email, phone, commission_rate, notes, active`. Only provided keys are applied. Empty patch → `400 {error:'No fields to update'}`.
- **Response:** `200 { sales_person }`; `500 {error}`.

#### `DELETE /api/admin/sales-persons/[id]`
- **Auth:** `canDelete(role)` (admin only) else `403`.
- **Logic:** `delete().eq('id', id)` — CASCADE removes the person's `sales_commissions`.
- **Response:** `200 { ok: true }`; `500 {error}`.

### Client data layer — `lib/admin/sales-persons.ts`
- `authHeaders()` — attaches `Authorization: Bearer <session.access_token>`.
- `getAllSalesPersons()` — **reads `sales_persons` directly via the Supabase client** (relies on RLS), `order('last_name')`; returns `[]` on error.
- `getSalesPersonsWithStats()` — fetches all sales persons, then `sales_commissions.select('sales_person_id, amount, status, invoice_id')`, and for each person computes: `paid_earnings` = Σ amount where `status==='paid'`; `pending_earnings` = Σ amount where `status==='pending'`; `invoice_count` = count of distinct non-null `invoice_id`s. On commission-fetch error returns people with zeroed stats.
- `searchSalesPersons(term)` — active only, `or(first_name.ilike, last_name.ilike, email.ilike)`, ordered by `last_name`, limit 8 (used by invoice "attach sales person" pickers elsewhere).
- `createSalesPerson(input)` → POST; `updateSalesPerson(id, patch)` → PATCH; `deleteSalesPerson(id)` → DELETE. Each throws `Error(err.error || 'Failed to …')` on non-OK. `SalesPersonInput = Omit<SalesPerson, 'id'|'created_at'|'updated_at'|'total_earnings'>`.

---

## Frontend

- **Route/page:** `/admin/sales-people` → `app/(admin)/admin/sales-people/page.tsx` (`'use client'`, default `AdminSalesPeople`).
- **Components** (in `app/(admin)/admin/sales-people/_components/`): `CreateSalesPersonModal.tsx`, `EditSalesPersonModal.tsx`, `DeleteSalesPersonDialog.tsx`.
- **State:** `people: SalesPersonWithStats[]`, `filtered`, `search`, `statusFilter ('all'|'active'|'inactive')`, `toggling` (id being toggled), plus modal flags `showCreate`, `editPerson`, `deleteTarget`.
- **Data flow:** `load()` = `getSalesPersonsWithStats().then(setPeople)`, run on mount and after every create/edit/delete/toggle. A `useEffect` recomputes `filtered` from `search` (matches email/first/last/phone, case-insensitive) and `statusFilter`. `handleToggleActive(person)` calls `updateSalesPerson(id, {active: !active})` then reloads.
- **Role gating:** `useUserRole()` + `canCreate/canEdit/canDelete` (all admin-only). The "Add Sales Person" button only renders for `canCreate`; the Actions column only renders if `canEdit || canDelete`.

---

## UI/UX specification

### Page `/admin/sales-people`

**Stats row** (3 pills, wrap on mobile):
- `Briefcase` icon + **{total}** "total".
- emerald dot + emerald **{active}** "active" (`active !== false`).
- red dot + red **{inactive}** "inactive" (`active === false`).

**Filter bar** (flex, stacks on mobile):
- Search input (`Search` icon, placeholder "Search by name, email, or phone...").
- Status `<select>`: options **All Statuses** / **Active** / **Inactive**.
- **Add Sales Person** button (dark, `Plus` icon) — only if `canCreate`.

**Table card** (white rounded, `overflow-x-auto`, `min-w-[820px]`):
- Card header: "All Sales People" + right-aligned "{filtered.length} shown".
- Columns (all uppercase muted th): **Sales Person**, **Phone**, **Rate**, **Invoices**, **Paid**, **Pending**, **Status**, **Actions** (Actions only when `canEdit || canDelete`).
- Row cells:
  - **Sales Person:** `{first_name} {last_name}` (medium) with `{email || '—'}` muted beneath.
  - **Phone:** `{phone || '—'}`.
  - **Rate:** `{commission_rate}%` (tabular-nums).
  - **Invoices:** `{invoice_count}` (tabular-nums).
  - **Paid:** `${paid_earnings.toFixed(2)}` in **emerald**, bold tabular-nums.
  - **Pending:** `${pending_earnings.toFixed(2)}` in **vital**, bold tabular-nums.
  - **Status badge:** "Active" = `bg-emerald-500/10 text-emerald-400`; "Inactive" = `bg-red-500/10 text-red-400`.
  - **Actions** (icon buttons): **Edit** (`Pencil`, opens edit modal) and **Activate/Deactivate** (`Power` — amber when active→"Deactivate sales person", emerald when inactive→"Activate sales person"; disabled while toggling) shown if `canEdit`; **Delete** (`Trash2`, red) shown if `canDelete`.
- **Empty state row** (`colSpan` 8 or 7): "No sales people match your filters" when filtered, else "No sales people yet".

### Create / Edit modals (`max-w-md`, centered over `bg-black/50`)
Header "Add Sales Person" / "Edit Sales Person" + close `X`. Form fields:
- **First Name \*** (placeholder "Jane" on create) / **Last Name \*** (placeholder "Doe") in a 2-col grid.
- **Email** (`type=email`, placeholder "sales@example.com" on create).
- **Phone** (placeholder "555-123-4567") / **Commission Rate (%)** (`type=number`, `step=0.01`, `min=0`, `max=100`) in a 2-col grid.
- **Notes** (textarea, `rows=2`, placeholder "Optional notes" on create).
- **Active** checkbox (vital accent), default checked on create / current value on edit.
- Footer: **Cancel** (surface) + submit button — create: "Create Sales Person" / "Creating..."; edit: "Save Changes" / "Saving...".
- **Validation** (client, shown in a red `AlertCircle` banner at top of form): "First and last name are required." and "Commission rate must be between 0 and 100." (`rate < 0 || rate > 100 || NaN`). Server errors surface in the same banner.

### Delete dialog (`max-w-sm`)
- Header "Delete Sales Person" + `X`.
- Red warning block (`AlertTriangle`): bold "This action is irreversible" then: "Permanently deletes **{first} {last}** ({email}) and all of their commission history. Linked invoices will keep their totals but lose the sales person reference."
- Footer: **Cancel** + red **"Delete Permanently"** / "Deleting...". Errors in a red banner above.

**Responsive:** stats pills and filter bar wrap/stack on mobile; the table scrolls horizontally (`min-w-[820px]`); modal form grids collapse to 1-col under `sm`.

---

## Dependencies

- **npm:** `@supabase/supabase-js` (service-role API client + browser client in `lib/admin/sales-persons.ts`), `lucide-react` (`Search, Plus, Pencil, Power, Trash2, Briefcase, X, AlertCircle, AlertTriangle`), `next`/React.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (API auth), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client reads via RLS).
- **Other modules / files:**
  - `lib/permissions` → `canCreate, canEdit, canDelete`.
  - Admin layout's `useUserRole()`.
  - Invoices module — owns the `invoices.sales_person_*` columns and the logic that writes `sales_commissions` rows when an invoice with a sales person is created. The stats on this page only render correctly once invoices populate commissions.
  - `set_updated_at()` SQL function (shared trigger fn) must already exist before running the migration.

---

## Porting notes

- **Do NOT port the affiliate commission system.** This module is the parallel internal-rep system and is self-contained: `sales_persons`, `sales_commissions`, `invoices.sales_person_*`. Keep it cleanly separate from any `affiliates`/`referral_codes`/`commissions` tables (which you are not porting at all).
- **Commission rows are created elsewhere.** Nothing in this module's files inserts into `sales_commissions` — that happens in the Invoices module when an invoice gets a `sales_person_id` + non-zero amount. Port the Invoices module's sales-person attach + commission-write logic for the Paid/Pending/Invoices columns to be non-zero. Until then this page works but shows zeros.
- **`total_earnings` column is vestigial in the UI** — the page computes earnings from the ledger. You can keep the column for compatibility or drop it; the page never reads it.
- **`getAllSalesPersons()` reads via the client (RLS)** while mutations go through the service-role API. Ensure the RLS read policies are in place or the list will come back empty for authenticated admins.
- **Rate is a percent** stored as `numeric(5,2)`; the snapshot onto invoices (`sales_person_commission_rate`) is taken at invoice time, so editing a person's rate later does not retroactively change past invoices.
- **Migration prerequisite:** `set_updated_at()` and the `invoices` table must exist before running `invoice-sales-features-migration.sql`.
- **Order of implementation:** (1) ensure `invoices` + `set_updated_at()` exist; (2) run `invoice-sales-features-migration.sql`; (3) port the `SalesPerson`/`SalesCommission`/`SalesPersonWithStats` types; (4) port `lib/admin/sales-persons.ts`; (5) port the two API routes; (6) port the page + three modal components; (7) (later) port the Invoices-side attach/commission-write logic.
