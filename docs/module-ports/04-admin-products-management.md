# Module 4 — Admin Products Management

The admin catalog manager at `/admin/products`: a searchable products table with full CRUD,
**inline-editable** Price / Stock / "Alert at" (low-stock threshold) cells, a create/edit modal,
image upload, multi-file Certificate-of-Analysis (COA) upload, Featured/Active toggles, a
restock-confirmation flow that emails the "Notify me" waitlist, and a two-step CSV import.
It is built for the `admin` (and read-only `assistant`) roles. Stock/threshold mechanics overlap
the **Inventory / low-stock module** (documented separately) — this doc covers the product-editing
surface and cross-references inventory rather than re-specifying alerting internals.

> **Affiliate note (stripped):** In the source app the `affiliate` role can reach `/admin/products`
> as a **read-only** view (it's in `AFFILIATE_PAGES`, and the list API's read check allows
> `affiliate`). Since we are **not** porting the affiliate program, drop `affiliate` from
> `AFFILIATE_PAGES` and from the read-authorization branch in `app/api/admin/products/route.ts`
> (`GET`). Mutations are already admin-only (`canCreate`/`canEdit`/`canDelete` return true only for
> `admin`), so no mutation code changes are needed. See "Porting notes."

---

## Data model

This module reads and writes the **`products`** table and reads **`stock_notifications`** (the
restock waitlist). Both are fully described in **Module 3 — Products (Public)**; only the
admin-relevant aspects are summarized here.

### `products` (admin-relevant columns)

Canonical shape: `lib/supabase.ts` → `export interface Product`. Admin reads `SELECT *`.

| Column | Type | Default | Admin relevance |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | PK; path param for edit/delete |
| `name` | varchar(255) | — | required in form |
| `slug` | varchar(255) | — | UNIQUE; auto-generated from name if blank; conflict → 409 |
| `category` | varchar(100) | — | free-text column |
| `description`, `description_short`, `benefits`, `mechanism` | text | — | textareas |
| `price` | decimal(10,2) | — | required; inline-editable; non-negative |
| `stock_quantity` | integer | `0` | required; inline-editable; non-negative |
| `low_stock_threshold` | integer | **`10`** | `NOT NULL`; inline-editable ("Alert at" column). Owned by Inventory module (`low-stock-alerts-migration.sql`) |
| `low_stock_alerted` | boolean | `false` | dedupe flag; re-evaluated on save (Inventory module) |
| `strength`, `purity`, `form` | varchar | — | form text fields |
| `image_url` | text | — | public URL in `products` storage bucket |
| `coa_url` | `TEXT[]` | `[]` | **array** of COA PDF URLs in the `certificate` storage bucket (replaced single `certificate_url`) |
| `featured` | boolean | `false` | "Featured Product" checkbox + badge |
| `active` | boolean | `true` | "Active" checkbox + status badge |
| `created_at` / `updated_at` | timestamptz | `NOW()` | list ordered by `created_at DESC`; `updated_at` set on every PUT/import |

RLS: public SELECT policy (`Products are viewable by everyone`), but all admin operations go
through service-role API routes that bypass RLS. Authorization is enforced in the route handlers
via Bearer-token role checks (see below), not via RLS.

### `stock_notifications`

Read by the restock-confirmation flow (pending emails per product) and updated to `notified`
when a restock email is sent. Full schema in Module 3.

### Storage buckets

| Bucket | Public | Used for | Setup |
|---|---|---|---|
| `products` | yes | product images | Create via Supabase Dashboard (`storage-products-bucket-setup.sql` is **instructions only — do not run**: create bucket named `products`, toggle Public ON). Service role bypasses RLS, so no storage policies needed. |
| `certificate` | yes | COA PDFs | Same pattern; bucket must be created manually (name `certificate`). |
| `product-imports` | (private) | CSV audit trail | Must exist; the import route uploads the raw CSV here before parsing. |

---

## API endpoints

All under `app/api/admin/products/`. Every route uses a service-role Supabase client and a local
`verifyAdminRole()` helper: it reads the `Authorization: Bearer <access_token>` header, calls
`supabase.auth.getUser(token)`, looks up the user's `role` in `customers`, and authorizes based on
the permission helpers in `lib/permissions.ts` (`canCreate`/`canEdit`/`canDelete` → `admin` only).

### `GET /api/admin/products` — `route.ts`

Read auth: `admin` or `assistant` **(plus `affiliate` in source — strip; see note)**. Optional
query filters `active`, `category`, `featured`. Selects `*`, ordered `created_at DESC`.
Response `{ products }`. Unauthorized → 403 `{ error: 'Unauthorized' }`.

### `POST /api/admin/products` — `route.ts`

Mutation auth: `canCreate` (admin). Body = full product payload (`name, description, price,
stock_quantity, low_stock_threshold, category, image_url, strength, purity, form, featured,
active, slug, description_short, benefits, mechanism, coa_url`). Validates required `name`/`price`/
`stock_quantity` (400 if missing), non-negative price/stock (400). Auto-slug if blank
(`name.toLowerCase().replace(/[^a-z0-9]+/g, '-')`); slug-exists → 409 "A product with this slug
already exists". `low_stock_threshold` defaults to `10` if not a valid non-negative number.
`coa_url` coerced to a filtered `string[]`. Inserts and returns `{ product }` with **201**.

### `GET /api/admin/products/[id]` — `[id]/route.ts`

Read auth: admin/assistant. Returns single `{ product }`; PostgREST `PGRST116` → 404 "Product not found".

### `PUT /api/admin/products/[id]` — `[id]/route.ts`

Mutation auth: `canEdit` (admin). **Partial update** — only keys present in the body are written
(each field guarded by `!== undefined`); always sets `updated_at`. This is what makes inline edits
work (the table PUTs just `{ price }`, `{ stock_quantity }`, or `{ low_stock_threshold }`).
Validations: product exists (404), non-negative price/stock (400), `low_stock_threshold` must be a
non-negative number when provided (400), slug-conflict against other rows → 409. `coa_url`
re-normalized to `string[]`.

Two side effects after a successful update:
1. **Restock → notify waitlist.** If the product was out of stock (`existing.stock_quantity <= 0`)
   and is now `> 0`, `notifyWaitlist()` loads all `pending` `stock_notifications` for the product,
   emails each via `sendBackInStockNotification` (`lib/email-smtp`), and marks the successfully
   emailed rows `status='notified', notified_at=now()`. Best-effort and wrapped in try/catch so
   email failures never fail the product update.
2. **Low-stock re-evaluation.** `checkLowStockForProducts(supabase, [id])` (`lib/admin/low-stock`,
   Inventory module) re-arms / fires the admin low-stock alert. Errors are logged, not thrown.

Response `{ product }`.

### `DELETE /api/admin/products/[id]` — `[id]/route.ts`

Auth: `canEdit` **and** `canDelete` (admin). Confirms existence (404) then deletes. Response
`{ success: true, message: 'Product deleted successfully' }`.

### `POST /api/admin/products/upload` — `upload/route.ts` (product image)

Auth: `canCreate`. `multipart/form-data` field `file`. Allowed MIME: `image/jpeg|png|webp|gif`.
Max **20MB**. Uploads to the **`products`** bucket with a randomized filename
(`${Date.now()}-${rand}.${ext}`, `upsert:false`). Returns `{ url, path, fileName }` (public URL).
Helpful errors if the bucket is missing / RLS-blocked.
`DELETE ...?path=<storagePath>` removes a file from the `products` bucket.

### `POST /api/admin/products/upload-certificate` — `upload-certificate/route.ts` (COA PDF)

Auth: `canCreate`. Same shape as the image upload but MIME restricted to `application/pdf`,
max 20MB, uploads to the **`certificate`** bucket. Returns `{ url, path, fileName }`.
`DELETE ...?path=<storagePath>` removes from the `certificate` bucket. The UI appends each returned
`url` to the product's `coa_url` array.

### CSV import — `import/route.ts`

Uses `xlsx` to parse. **`POST`** (analyze): auth `canCreate`; `multipart` `file`; accepts CSV
(MIME `text/csv|text/plain|application/vnd.ms-excel|application/csv` or `.csv` name), max **5MB**.
Saves the raw file to the `product-imports` bucket (audit trail), parses the first sheet with
expected columns **Code, Product Name, MG, Wholesale Price, CAD Price**. Per row: `slug = slugify(Code)`
(rows without a Code are skipped & counted); `price = CAD ?? Wholesale ?? 0`; `description_short`
becomes a combined "Wholesale: $.. | CAD: $.." string; `strength = MG`. Splits rows into
`newProducts` vs `updateProducts` by checking existing slugs. Returns
`{ csvPath, newProducts, updateProducts, skippedRows }`.

**`PUT`** (commit): auth `canCreate`; body `{ newProducts, updateProducts, csvPath }`. Rejects empty
(400) or `> 500` rows (400 "Too many rows. Maximum 500 products per import."). New records get full
defaults (`stock_quantity:0, featured:false, active: price>0, coa_url:[]`, other fields null);
updates carry only CSV-sourced fields (name, strength, price, description_short, updated_at) to
avoid nulling existing data. Upserts on `onConflict: 'slug'`. Returns `{ inserted, updated }`.

### `GET /api/admin/stock-notifications` — `app/api/admin/stock-notifications/route.ts`

Auth: admin/assistant. With `?product_id=` returns `{ emails, count }` (that product's pending
waitlist, oldest first) — used by the restock confirmation dialog. Without it, returns
`{ products, totalRequests }` aggregated per product (most-requested first) for the admin waitlist
view. (Largely an Inventory/notifications concern; included because the products page calls the
`?product_id=` form via `fetchWaiters()`.)

---

## Frontend

Single client page: **`app/(admin)/admin/products/page.tsx`** (`ProductsManagementPage`). Pure
React `useState` (no React Query/context for data). Auth tokens are pulled per-request from
`supabase.auth.getSession()` and sent as `Authorization: Bearer`.

Permissions: `usePermissions()` (`lib/hooks/usePermissions.ts`) reads the role from the admin
layout context (`useUserRole`) and exposes `canCreate`, `canEdit`, `canDelete`. These gate the
toolbar buttons, inline-edit affordances, edit/delete row actions, and the "view only" fallbacks.

Key state: `products` / `filteredProducts` (client-side search by name/category/slug), `showModal`
+ `editingProduct` + `formData` (create/edit), `showDeleteModal` + `deletingProduct`,
`inlineEdit` (`{ id, field: 'price'|'stock_quantity'|'low_stock_threshold', value }`) +
`inlineSaving`, `restockConfirm` (`{ productName, emails, onConfirm }`) + `restockSaving`,
`uploading`, `error`/`success` banners, and CSV import state (`showImportModal`, `importStep`,
`importFile`, `importPreview`, etc.).

Data flow: `fetchProducts()` → `GET /api/admin/products` on mount and after every successful
mutation. Inline saves call `commitInlineSave()` → `PUT /api/admin/products/[id]` with a single
field, then patch local state. Image/COA uploads call the upload routes and stash the returned URL
into `formData`. Create/Edit submits the full payload to `POST` or `PUT`. Restock-aware saves call
`fetchWaiters()` first and route through the confirmation modal when a waitlist exists.

---

## UI/UX specification

Tokens identical to the storefront (`ink`, `ink-muted`, `vital`/`vital-50`, `surface`, `line`,
status greens/ambers/reds). Modals: `fixed inset-0 bg-black/50`, white `rounded-xl` panels.

### Header

H1 "Products". Subtitle "Manage product catalog" (or **"Product catalog (view only)"** when
`!canEdit`). When `canCreate`, two toolbar buttons: **Import CSV** (`FileUp`, surface style) and
**Add Product** (`Plus`, `bg-ink`).

### Banners

- Error: red (`bg-red-50/border-red-200`), `AlertCircle`, message, dismiss X.
- Success: emerald (`bg-emerald-50`), `Check`, message, dismiss X.

### Search

Full-width input, `Search` icon, placeholder "Search products...". Filters in-memory on name,
category, slug.

### Products table

`bg-white rounded-xl border`, horizontally scrollable (`min-w-[720px]`). Columns:
**Product · Category · Price · Stock · Alert at · Status · Actions.**

- **Product** cell: 48px image thumbnail (or `ImageIcon` placeholder), name + slug (muted).
- **Category**: text or `-`.
- **Price** (inline editable): default shows `$NN.NN` with a dashed underline + faint `Pencil`
  on hover (when `canEdit`); clicking swaps to a `number` input (`step 0.01`, `min 0`, autofocus).
  Enter / blur saves; Escape cancels. While saving, shows a small vital spinner + the value.
- **Stock** (inline editable): same interaction; value colored **emerald (>10) / amber (1–10) /
  red (0)**.
- **Alert at** (inline editable, low-stock threshold): shows `≤ N` (default 10); colored amber
  when `stock_quantity <= threshold`, else muted. `title` = "Click to edit low-stock alert threshold".
- **Status**: `Active` (emerald pill) / `Inactive` (grey pill); plus a vital **Featured** pill
  when featured.
- **Actions**: `Edit2` (edit) and, if `canDelete`, `Trash2` (delete, hover red). When `!canEdit`,
  the cell shows "View only".

Empty/loading: a full-width row "Loading..." or "No products found" (`colSpan=7`).

### Create / Edit modal

Title "Add New Product" / "Edit Product". Scrollable body (`max-h-[60vh]`). Fields in order:

1. **Product Image** — drag-drop-style label; empty state "Click to upload image (max 20MB)"
   (`Upload` icon); during upload, spinner + "Uploading..."; once set, image preview with a red X
   to remove (also deletes from storage). `accept="image/*"`, 20MB cap, must be an image type.
2. **Certificates of Analysis (PDF)** — list of uploaded COAs (each: red PDF icon, "COA #i",
   "View" link, red X remove → deletes from `certificate` bucket and from `coa_url`). Upload
   dropzone label "Click to upload PDF certificate (max 20MB)" or, when ≥1 exists, "Add another COA
   (PDF, max 20MB)". `accept="application/pdf"`, 20MB cap; input value reset after each upload to
   allow re-selecting the same filename.
3. **Name*** (required, red asterisk).
4. **Slug** — placeholder "product-slug (auto-generated if empty)".
5. **Price*** (number, step 0.01) & **Stock Quantity*** (number) & **Low Stock Alert Threshold**
   (number, placeholder "10", helper text "Email admins & flag on the dashboard when stock reaches
   this level or lower. Defaults to 10.").
6. **Category** / **Strength** (placeholders "e.g., Peptides" / "e.g., 5mg").
7. **Purity** / **Form** ("e.g., 99%" / "e.g., Lyophilized Powder").
8. **Short Description** (textarea), **Full Description**, **Benefits**, **Mechanism**.
9. **Featured Product** & **Active** checkboxes (vital accent).

Footer: **Cancel** (surface) + **Create Product / Update Product** (`bg-ink`, `Save` icon).
Client validation message when name/price/stock missing: "Name, price, and stock quantity are
required"; "Invalid price"; "Invalid stock quantity". Success banners: "Product created
successfully" / "Product updated successfully".

### Delete confirmation modal

Title "Delete Product", body "Are you sure you want to delete **{name}**? This action cannot be
undone." Buttons: Cancel + **Delete Product** (red, `Trash2`). Success: "Product deleted successfully".

### Restock confirmation modal (waitlist email gate)

Triggered when an edit (modal save **or** inline stock save) raises stock from `<= 0` to `> 0`
**and** the product has pending waitlist emails. Header: vital `Bell` tile, "Notify waitlist?",
product name. Body: "Restocking this product will email **N** person/people who asked to be
notified:" followed by a scrollable email list. Buttons: **Cancel** + **Confirm & notify**
(`bg-ink`, `Bell`; shows `Loader2` + "Saving..." while running). On confirm it runs the queued
`onConfirm` (the actual PUT), which on the server fires the restock emails.

### CSV Import (two-step modal)

- **Step 1 — Upload**: title "Import Products from CSV". Dropzone "Click to upload CSV (max 5 MB)"
  with helper "Required columns: Code, Product Name, MG, Wholesale Price, CAD Price"; once selected
  shows filename + size. Buttons: Cancel + **Analyze CSV** (shows spinner + "Analyzing...").
- **Step 2 — Preview & Confirm**: title "Confirm Import". Summary pills: emerald "N New", vital
  "N Updates", amber "N Skipped (no Code)" (when any). Preview table (Status / Slug / Name /
  Strength / Price) with "New"/"Update" badges. Buttons: **Back** + **Confirm Import** (spinner +
  "Importing..."). Success banner "Imported X new and updated Y products".

### Inline-edit colors (quick reference)

- Stock value: emerald `> 10`, amber `1–10`, red `0`.
- Threshold: amber when `stock <= threshold`, else muted.
- Status pills: Active = emerald, Inactive = grey, Featured = vital.

### Responsive

Toolbar buttons go full-width and stack on mobile; the table scrolls horizontally; modals are
`p-4`-guttered full-width. Form grids collapse to one column (`grid-cols-1 sm:grid-cols-2`).

---

## Dependencies

- **npm**: `@supabase/supabase-js` (auth + storage + DB), `next`, `react`/`react-dom`,
  `lucide-react` (icons), `xlsx` (CSV import parsing), `tailwindcss`. Email sending uses
  `nodemailer` (and/or `resend`) via `lib/email-smtp`.
- **Env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client session),
  `SUPABASE_SERVICE_ROLE_KEY` (all admin routes / storage). Restock emails additionally need the
  SMTP/Resend config consumed by `lib/email-smtp` (e.g. `RESEND_API_KEY`, `EMAIL_FROM`,
  `NEXT_PUBLIC_BASE_URL`).
- **Other modules**:
  - `lib/permissions.ts` + `lib/hooks/usePermissions.ts` + the admin layout's `useUserRole`
    (role-based access). The admin layout/auth is its own module.
  - **Inventory / low-stock module** — owns `low_stock_threshold` / `low_stock_alerted` semantics
    and `lib/admin/low-stock.checkLowStockForProducts`, called from the product PUT. Cross-reference
    rather than duplicate.
  - **Stock notifications** — `stock_notifications` table, `lib/email-smtp.sendBackInStockNotification`,
    and `GET /api/admin/stock-notifications`. Restock email send lives in the product PUT route.
  - Storage buckets `products`, `certificate`, `product-imports` (created via Supabase Dashboard).

---

## Porting notes

- **Strip affiliate scoping** (we are not porting affiliates):
  - In `lib/permissions.ts`, remove `/admin/products` from `AFFILIATE_PAGES` (and ideally remove the
    `affiliate` role entirely from `UserRole` and its branches).
  - In `app/api/admin/products/route.ts` `GET`, remove `affiliate` from the read-auth branch
    (`role === 'admin' || role === 'assistant' || role === 'affiliate'` → drop the affiliate term).
  - No change needed for mutations — `canCreate/canEdit/canDelete` already restrict to `admin`.
  - The page UI has **no affiliate-specific code**; `assistant` already gets a read-only view via
    `canEdit=false` ("View only", "(view only)" subtitle). That read-only pattern is worth keeping.
- **COA is an array** (`coa_url TEXT[]`, default `[]`): port the `certificate` bucket + the
  `upload-certificate` route; always normalize to a filtered `string[]` on write (the API already
  does). Don't reintroduce a single `certificate_url`.
- **Storage buckets must be created manually** in the Supabase Dashboard (`products`, `certificate`
  public; `product-imports` for CSV audit). The "SQL" file is documentation only — do not run it.
- **Partial PUT semantics** are load-bearing for inline edits — keep the `!== undefined` field
  guards so single-field PATCH-style updates don't clobber other columns.
- **Restock email gate**: the confirmation modal is a UX safeguard, but the *actual* emailing
  happens server-side in the PUT route on any `<=0 → >0` transition (even via inline edit). Keep
  both, and ensure `lib/email-smtp` + the `stock_notifications` table are ported, or stub
  `notifyWaitlist` out.
- **Low-stock threshold default = 10** everywhere (DB default, form default string `'10'`, POST
  fallback, inline display `?? 10`). This is shared with the Inventory module — port that module's
  schema/migration (`low-stock-alerts-migration.sql`) and `checkLowStockForProducts` alongside, or
  comment out the `checkLowStockForProducts` call.
- **CSV import** is tailored to a specific column set (Code/Product Name/MG/Wholesale/CAD) and a
  CAD-preferred pricing rule; adapt `parseCSVBuffer` to the target catalog's columns. Requires the
  `product-imports` bucket and the `xlsx` package.
- **Order of implementation**: (1) `products` table + storage buckets, (2) `lib/permissions` +
  admin auth/layout, (3) list/create/edit/delete routes + the page table & modal, (4) image &
  COA upload routes, (5) inline-edit + restock-confirm flow (needs `stock_notifications` +
  `email-smtp` + the Inventory low-stock helper), (6) CSV import.
