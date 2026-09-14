# Cluster 7 — Restock Supply Chain (Backorders ↔ Purchase Orders ↔ Suppliers): Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 7 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **seventh** (after 1, 10, 2, 3, 4, 5). It closes the
> inventory loop: invoices that can't be filled create backorders; purchase orders restock;
> receiving increments `products.stock_quantity` and writes `inventory_log`.
>
> **Companion deep spec:** `docs/module-ports/09-purchase-orders-and-suppliers.md`,
> `02-inventory-and-stock.md`. This is the *map*; those are the *atlas*.

---

## 1. What the cluster is / does

The procurement + restock side of inventory:
- **Suppliers** — vendor master data + per-supplier product price lists (with a "cheapest supplier"
  lookup).
- **Purchase Orders** — order stock from suppliers; track partial/full **receiving**; receiving
  **increments stock** and logs it.
- **Backorders** — when an invoice (Cluster 5) or warehouse line (Cluster 6) can't be fully filled,
  a backorder row is created; the admin "Fulfills" it by **deep-linking into PO creation**, and the
  PO is linked back to the backorder.

**Why it ports here:** it depends on products (2) and is fed by invoices/fulfillment (5/6). It
**owns the `inventory_log` increment side** and the `apply_po_inventory`/`receive_po_items` RPCs.

---

## 2. Database schema — what exists and where it comes from

### `suppliers` (`purchase-orders-migration.sql`)
`id`, `name`, `contact_person`, `email`, `phone`, `lead_time_days` (default 7), `notes`, timestamps.
Index on `lower(name)`.

### `purchase_orders` (same migration)
`id`, **`po_number text UNIQUE DEFAULT 'PO-' || LPAD(nextval('po_number_seq'),5,'0')`** (seq starts
1001), `supplier_id → suppliers ON DELETE **RESTRICT**` (can't delete a supplier with POs), **`status
CHECK IN ('pending','partially_fulfilled','fulfilled','paid','cancelled')`**, `subtotal`, `tax_type`
(`percentage|fixed`), `tax_value`, `tax_total`, `total`, `notes`, `expected_date`,
**`inventory_applied boolean` + `inventory_applied_at`** (guards double-applying stock),
`created_by → customers`, timestamps.
- `purchase-orders-discount-shipping-migration.sql` adds `discount`, `shipping_fee`, `order_date`,
  `discount_type` (`percentage|fixed`), `discount_value`.

### `purchase_order_items` (same migration)
`id`, `purchase_order_id → purchase_orders ON DELETE CASCADE`, `product_id → products ON DELETE SET
NULL`, `description`, `sku_snapshot`, `qty CHECK(>0)`, `unit_price`, `line_total`, `created_at`.
- `purchase-orders-receiving-migration.sql` adds **`qty_received integer DEFAULT 0 CHECK(>=0)`**.

### Receiving tables (`purchase-orders-receiving-migration.sql`)
- **`purchase_order_receipts`**: `id`, `purchase_order_id → purchase_orders ON DELETE CASCADE`,
  `note`, `created_by → customers`, `created_at`. One row per receiving event.
- **`purchase_order_receipt_items`**: `id`, `receipt_id → receipts ON DELETE CASCADE`, `po_item_id →
  purchase_order_items ON DELETE CASCADE`, `product_id → products`, `qty CHECK(>0)`. **No `.from()`
  in app code** — written only by the RPC.

### `inventory_log` (created here, in `purchase-orders-migration.sql`)
`id`, `product_id → products ON DELETE SET NULL`, `delta integer`, `reason text`, `reference_type`,
`reference_id`, `created_by → customers`, `created_at`. (Cluster 2 reads/uses it conceptually;
**this cluster is where it's defined and written**.) The discount-shipping migration re-adds columns
defensively (it had a vestigial `variant_id`).

### `supplier_prices` (`supplier-pricelists-migration.sql`)
`id`, `supplier_id → suppliers ON DELETE CASCADE`, `product_id → products ON DELETE CASCADE`,
`price CHECK(>=0)`, timestamps. Indexes on both FKs.

### `backorders` + `backorder_items` (`backorders-migration.sql`)
- **`backorders`**: `id`, `invoice_id → invoices ON DELETE CASCADE`, **`status CHECK IN ('open',
  'fulfilled','cancelled')`**, **`purchase_order_id → purchase_orders ON DELETE SET NULL`** (the
  link set when an admin fulfills via a PO), `created_at`, `fulfilled_at`.
- **`backorder_items`**: `id`, `backorder_id → backorders ON DELETE CASCADE`, `product_id →
  products`, `description`, `qty_ordered`, `qty_available`, `qty_backordered`, `unit_price`.

### The two stock-increment RPCs
- **`apply_po_inventory(po_id)`** — bulk-applies a whole PO's quantities to stock (used when a PO is
  created/marked `fulfilled` directly). Guarded by `inventory_applied`.
- **`receive_po_items(p_po_id, p_actor, p_note, p_items jsonb)`** — *the per-line receiving path.*
  `FOR UPDATE` locks the PO; rejects if `paid`/`cancelled`; inserts a receipt header; for each
  `{po_item_id, qty}`: validates ≤ remaining (`qty - qty_received`), bumps `qty_received`, inserts a
  receipt item, **`UPDATE products SET stock_quantity = stock_quantity + qty`** and **inserts
  `inventory_log`** (`reason:'restock'`, `reference_type:'purchase_order_receipt'`); **rejects empty
  receipts**; then recomputes PO status (`fulfilled` if all received, else `partially_fulfilled`)
  and sets `inventory_applied`.

### RLS
All tables → admin/assistant read, **admin write** (service-role bypasses). Routes re-verify role.

---

## 3. The reading map (open files in this order)

### Tier A — Types & status helpers
- `lib/supabase.ts` → `Supplier`, `SupplierPrice(Row)`, `CheapestSupplierPrice`,
  `PurchaseOrder(Item)`, `PurchaseOrderReceipt(Item)`, `PurchaseOrderStatus`, `PurchaseOrderTaxType`.
- `lib/admin/po-status.ts` → `PO_STATUSES`, `PO_STATUS_META`, **`isPoLocked(status)`** (paid/cancelled
  lock edits), **`canReceivePo(status)`**.

### Tier B — Suppliers + supplier prices
- **`app/api/admin/suppliers/route.ts`** + `[id]` — supplier CRUD (delete blocked by FK RESTRICT if
  POs exist). `lib/admin/purchase-orders.ts`: `getAllSuppliers`, `searchSuppliers`, `createSupplier`,
  `updateSupplier`, `deleteSupplier`.
- **`app/api/admin/suppliers/[id]/prices/route.ts`** + **`app/api/admin/supplier-prices/cheapest/route.ts`**
  — per-supplier price list + cheapest-supplier-per-product map. `lib/admin/supplier-prices.ts`:
  `getSupplierPrices`, `saveSupplierPrices`, `getCheapestSupplierPrices`.
- UI: `app/(admin)/admin/purchase-orders/suppliers/page.tsx`,
  `app/(admin)/admin/purchase-orders/supplier-pricelists/page.tsx`.

### Tier C — Purchase Orders

**`app/api/admin/purchase-orders/route.ts`** — GET (list, status/supplier filter) + **POST (create)**.
- POST (admin `canCreate`): insert `purchase_orders` (+ `po_number` auto), insert
  `purchase_order_items`; **roll back** the PO if item insert fails.
- **If created with `status:'fulfilled'`** → call **`apply_po_inventory` RPC** (stock applied
  immediately) and backfill `qty_received`.
- **`backorder_id` seam:** if provided, **flush the backorder** (`status:'fulfilled'`,
  `fulfilled_at`, `purchase_order_id` link) `WHERE status='open'`.

**`app/api/admin/purchase-orders/[id]/route.ts`** — GET (detail w/ items + receipts) + PATCH (edit;
locked when `isPoLocked`) + DELETE. Quick actions: mark paid / cancel.

**`app/api/admin/purchase-orders/[id]/receipts/route.ts`** — **POST = receive items** → calls
`receive_po_items` RPC. `lib/admin/purchase-orders.ts`: `receivePurchaseOrderItems`.

**`app/api/admin/purchase-orders/[id]/pdf/route.ts`** — branded PO PDF.

`lib/admin/purchase-orders.ts`: `getPurchaseOrders`, `getPurchaseOrder`, `createPurchaseOrder`,
`updatePurchaseOrder`, `receivePurchaseOrderItems`.

UI: `app/(admin)/admin/purchase-orders/page.tsx` (list + value cards), `new/page.tsx` (reads
`?backorder=` → prefills line items), `[id]/page.tsx` (+ `_components/PurchaseOrderForm.tsx`,
`PurchaseOrderReceiving.tsx`).

### Tier D — Backorders

**`app/api/admin/backorders/route.ts`** — GET `?status=open|fulfilled|cancelled`, joins invoice +
items + linked PO; computes `item_count`/`total_backordered`. **`[id]`** — single backorder (used to
prefill the PO form). **`count`** — open count for the admin nav badge.

**`lib/admin/backorder-sync.ts`** → `syncInvoiceBackorder(...)` — **the write path from Cluster 5**:
creates/updates a backorder + its items when an invoice is split.

UI: `app/(admin)/admin/backorders/page.tsx` — Open/History tabs; **"Fulfill"** → routes to
`/admin/purchase-orders/new?backorder=<id>`.

---

## 4. End-to-end flows to trace

1. **Invoice shortfall → backorder:** Cluster 5 create calls `syncInvoiceBackorder` → `backorders`
   (`open`) + `backorder_items`. Shows on `/admin/backorders` + nav badge (`count`).
2. **Fulfill a backorder:** "Fulfill" → `/admin/purchase-orders/new?backorder=<id>` (loads
   `/api/admin/backorders/[id]`, prefills lines) → POST PO with `backorder_id` → backorder flushed
   (`fulfilled` + `purchase_order_id` link).
3. **Receive a PO:** `[id]/receipts` POST → `receive_po_items` RPC → per line: `qty_received`++,
   receipt item, **`stock_quantity`++**, **`inventory_log` 'restock'** → PO status recomputed
   (`partially_fulfilled`/`fulfilled`) + `inventory_applied`.
4. **Create-as-fulfilled shortcut:** POST PO `status:'fulfilled'` → `apply_po_inventory` applies all
   quantities at once.

---

## 5. Extraction checklist & gotchas

- [ ] Create the `po_number_seq` sequence before `purchase_orders` (default expression depends on it).
- [ ] `supplier_id` FK is **ON DELETE RESTRICT** — a supplier with POs can't be deleted (intentional).
- [ ] **`inventory_log` is defined in THIS cluster** (`purchase-orders-migration.sql`), not Cluster 2.
      Port it here; Cluster 2's decrement RPC also writes it.
- [ ] **Two stock-increment paths:** `receive_po_items` (per-line, the normal path) and
      `apply_po_inventory` (whole PO, used on create-as-fulfilled). Both are idempotency-aware
      (`qty_received` / `inventory_applied`).
- [ ] `receive_po_items` is `FOR UPDATE`-locked, validates ≤ remaining, **rejects empty receipts**,
      and recomputes status — port the RPC verbatim; the route is a thin wrapper.
- [ ] `purchase_order_receipt_items` has **no app `.from()`** — written only by the RPC.
- [ ] **Backorder ↔ PO linkage:** the PO create route flushes the backorder (`backorder_id` →
      `fulfilled` + `purchase_order_id`); the backorder list joins the PO back. Keep both directions.
- [ ] The **`syncInvoiceBackorder` write path lives in Cluster 5's create flow** — backorders are
      *created* there, *managed* here. Port both or guard the call.
- [ ] PO edits are blocked by `isPoLocked` (paid/cancelled) — enforce in the route, not just UI.
- [ ] Suppliers/supplier-prices are independent of backorders — portable on their own if you only
      want procurement without the invoice-split loop.

---

## 6. File index (everything in Cluster 7)

```
DB        purchase-orders-migration.sql (suppliers, purchase_orders, purchase_order_items,
            inventory_log, apply_po_inventory, po_number_seq),
          purchase-orders-receiving-migration.sql (qty_received, receipts tables, receive_po_items),
          purchase-orders-discount-shipping-migration.sql (discount/shipping/order_date),
          supplier-pricelists-migration.sql (supplier_prices),
          backorders-migration.sql (backorders, backorder_items)
libs      lib/admin/purchase-orders.ts, lib/admin/supplier-prices.ts, lib/admin/po-status.ts,
          lib/admin/backorder-sync.ts  (+ types in lib/supabase.ts)
API       app/api/admin/purchase-orders/{route,[id],[id]/receipts,[id]/pdf}.ts,
          app/api/admin/suppliers/{route,[id],[id]/prices}.ts,
          app/api/admin/supplier-prices/cheapest/route.ts,
          app/api/admin/backorders/{route,[id],count}.ts
admin UI  app/(admin)/admin/purchase-orders/{page,new,[id]}.tsx + _components/{PurchaseOrderForm,
            PurchaseOrderReceiving}.tsx, .../suppliers/page.tsx, .../supplier-pricelists/page.tsx,
          app/(admin)/admin/backorders/page.tsx
docs      docs/module-ports/09-purchase-orders-and-suppliers.md, 02-inventory-and-stock.md
```

**Deps:** `pdfkit` (PO PDF). **Audit:** PO/supplier mutations may log via `lib/admin/audit.ts`
(Cluster 1). **Seams:** Cluster 2 (`products.stock_quantity`, `inventory_log`), Cluster 5
(`syncInvoiceBackorder` creates backorders), Cluster 6 (warehouse per-line backorder also feeds the
backorder system).
```
