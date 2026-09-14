'use client';

import React, { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Edit2, Trash2, Save, X, AlertCircle, Upload, Image as ImageIcon, Check, FileUp, Pencil, Bell, Loader2, FileText, ChevronLeft, ChevronRight, ChevronDown, History, RotateCcw, Clock, DollarSign, Package, Beaker, Mail, Send, SlidersHorizontal, TrendingUp, Calendar, Columns3, Users, Tag, Handshake, ArrowUpDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { useToast } from '@/contexts/ToastContext';
import type { Product } from '@/lib/supabase';
import { rankBySearch } from '@/lib/search';
import { productUsdPrice, usdFromCad, DEFAULT_USD_RATE, type PriceCurrency } from '@/lib/pricing';
import { currentWeekRange, toDateInput } from '@/lib/admin/stock-change-report';
import CellEditGrid from './CellEditGrid';

/** Products shown per page in the table. */
const PAGE_SIZE = 20;

/** Keys for the summary cards rendered on the downloadable Products Report. */
type ReportCardKey = 'products' | 'stock' | 'lowout' | 'revenue';
/**
 * Keys for the table columns on the downloadable Products Report, in report
 * order — SKU (slug) and Description lead; Category was retired.
 */
type ReportColumnKey =
  | 'sku'
  | 'product'
  | 'strength'
  | 'price'
  | 'stock'
  | 'stockValue'
  | 'unitsSold'
  | 'revenue'
  | 'status';

/** How stock quantities are expressed across every admin/products report. */
type StockUnit = 'boxes' | 'vials';

/**
 * The Products Report is customized by toggling whole *sections* rather than
 * individual cards/columns — ticking one box removes the related cards and
 * columns together. Each group lists the cards and columns it contributes.
 */
type ReportGroupKey = 'catalog' | 'inventory' | 'pricing' | 'revenue';

const REPORT_GROUPS: {
  key: ReportGroupKey;
  label: string;
  desc: string;
  cards: ReportCardKey[];
  columns: ReportColumnKey[];
}[] = [
  {
    key: 'catalog',
    label: 'Catalog',
    desc: 'SKU, description, strength, product count & status',
    cards: ['products'],
    columns: ['sku', 'product', 'strength', 'status'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    desc: 'Stock on hand plus low / out-of-stock counts',
    cards: ['stock', 'lowout'],
    columns: ['stock'],
  },
  {
    // Pricing is just the unit price — the figure the pricing source drives.
    key: 'pricing',
    label: 'Pricing',
    desc: 'Unit price per product',
    cards: [],
    columns: ['price'],
  },
  {
    key: 'revenue',
    label: 'Revenue',
    desc: 'Stock value, units sold & total revenue',
    cards: ['revenue'],
    columns: ['stockValue', 'unitsSold', 'revenue'],
  },
];

/** localStorage key persisting the admin's report customization choices. */
const REPORT_CONFIG_KEY = 'aminocan.productReport.config';

/** Resolve the selected groups into the card keys the report API expects. */
const cardsFromGroups = (groups: Record<ReportGroupKey, boolean>): ReportCardKey[] =>
  REPORT_GROUPS.filter((g) => groups[g.key]).flatMap((g) => g.cards);
/** Resolve the selected groups into the column keys the report API expects. */
const columnsFromGroups = (groups: Record<ReportGroupKey, boolean>): ReportColumnKey[] =>
  REPORT_GROUPS.filter((g) => groups[g.key]).flatMap((g) => g.columns);

/**
 * Stock-status filter for the downloadable Products Report — limit the rows to
 * low and/or out-of-stock items. Mirrors the `stockStatus` param the report
 * route understands; `all` (the default) imposes no filter.
 */
type ReportStockStatus = 'all' | 'lowout' | 'low' | 'out';

/**
 * Where the Products Report's price figures come from. The report can price
 * every product from the catalog default, from a saved *general* price list, from
 * a specific customer's *dedicated* price list (their price overrides), or from an
 * *affiliate's* price list. The modal toggles between the general, customer and
 * affiliate flavours — "general" is the default, and within it the catalog
 * default is the pre-selected source.
 */
type ReportPriceMode = 'general' | 'customer' | 'affiliate';

/** A general price list offered as a pricing source in the report modal. */
interface ReportPricelist {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  currency?: 'CAD' | 'USD';
  item_count: number;
}

/** A customer offered as a dedicated pricing source in the report modal. */
interface ReportPricingCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  price_currency?: 'CAD' | 'USD';
  applied_pricelist?: { id: string; name: string } | null;
}

/** An affiliate offered as a pricing source in the report modal. */
interface ReportPricingAffiliate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  price_currency?: 'CAD' | 'USD';
  override_count?: number;
}

/** Stock-status filter options offered in the Customize Report modal. */
const REPORT_STOCK_STATUS: { value: ReportStockStatus; label: string; desc: string }[] = [
  { value: 'all', label: 'All products', desc: 'No stock filter' },
  { value: 'lowout', label: 'Low or out of stock', desc: 'At/under min or sold out' },
  { value: 'low', label: 'Low stock only', desc: 'At or under the min quantity' },
  { value: 'out', label: 'Out of stock only', desc: 'Zero stock on hand' },
];

/**
 * Toggleable columns on the downloadable Stock Report, in report order. Mirrors
 * the column keys the stock-report renderer understands.
 */
type StockReportColumnKey =
  | 'sku'
  | 'description'
  | 'strength'
  | 'stock'
  | 'minQty'
  | 'onOrder'
  | 'needToOrder';

/** The Stock Report columns offered as checkboxes, in report order. */
const STOCK_REPORT_COLUMNS: { key: StockReportColumnKey; label: string; desc: string }[] = [
  { key: 'sku', label: 'SKU', desc: 'Product slug / SKU code' },
  { key: 'description', label: 'Description', desc: 'Product name' },
  { key: 'strength', label: 'Strength', desc: 'Dosage / strength' },
  { key: 'stock', label: 'Stock', desc: 'Current stock on hand' },
  { key: 'minQty', label: 'Min Quantity', desc: 'Low-stock threshold' },
  { key: 'onOrder', label: 'On Order', desc: 'Units on open purchase orders' },
  { key: 'needToOrder', label: 'Need To Order', desc: 'Units to reach the minimum' },
];

/**
 * The columns a Customer Stock Report may carry. Mirrors
 * CUSTOMER_STOCK_REPORT_COLUMN_KEYS in lib/admin/stock-report — the server
 * enforces this, so the copy here only keeps the request tidy.
 */
const CUSTOMER_STOCK_REPORT_COLUMNS: StockReportColumnKey[] = [
  'sku',
  'description',
  'strength',
  'stock',
];

/** Default Stock Report column selection — every column shown. */
const allStockColumnsSelected = (v: boolean): Record<StockReportColumnKey, boolean> =>
  Object.fromEntries(STOCK_REPORT_COLUMNS.map((c) => [c.key, v])) as Record<StockReportColumnKey, boolean>;

/** Toggleable columns in the products table (Product/Status/Actions are fixed). */
type TableColumnKey = 'price' | 'stockVials' | 'stockBoxes' | 'vialsPerBox' | 'minQuantity';

/** Optional table columns, in table order, offered in the "Columns" menu. */
const TABLE_COLUMNS: { key: TableColumnKey; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'stockVials', label: 'Stock (vials)' },
  { key: 'stockBoxes', label: 'Stock (boxes)' },
  { key: 'vialsPerBox', label: 'Vials / Box' },
  { key: 'minQuantity', label: 'Min Quantity' },
];

/** Which columns show by default — Vials/Box and Min Quantity start hidden. */
const DEFAULT_VISIBLE_COLUMNS: Record<TableColumnKey, boolean> = {
  price: true,
  stockVials: true,
  stockBoxes: true,
  vialsPerBox: false,
  minQuantity: false,
};

/** localStorage key persisting the admin's table column visibility choices. */
const TABLE_COLUMNS_KEY = 'aminocan.productTable.columns';

/**
 * How the products table is ordered. Each field offers both directions; the
 * default (`name-asc`) is alphabetical by name, matching the downloadable stock
 * report (which the DB serves via `.order('name')`).
 */
type SortKey =
  | 'name-asc'
  | 'name-desc'
  | 'price-asc'
  | 'price-desc'
  | 'stock-asc'
  | 'stock-desc'
  | 'newest'
  | 'oldest';

/** Default sort — alphabetical by name, matching the stock report. */
const DEFAULT_SORT: SortKey = 'name-asc';

/**
 * Sort options in menu order. `divideAfter` draws a separator below the row so
 * each field's two directions read as a pair. `short` is the compact label
 * shown on the toolbar button so the active sort is always visible at a glance.
 */
const SORT_OPTIONS: { key: SortKey; label: string; short: string; divideAfter?: boolean }[] = [
  { key: 'name-asc', label: 'Name: A → Z', short: 'Name A–Z' },
  { key: 'name-desc', label: 'Name: Z → A', short: 'Name Z–A', divideAfter: true },
  { key: 'price-asc', label: 'Price: Low → High', short: 'Price ↑' },
  { key: 'price-desc', label: 'Price: High → Low', short: 'Price ↓', divideAfter: true },
  { key: 'stock-asc', label: 'Stock: Low → High', short: 'Stock ↑' },
  { key: 'stock-desc', label: 'Stock: High → Low', short: 'Stock ↓', divideAfter: true },
  { key: 'newest', label: 'Recently added', short: 'Newest' },
  { key: 'oldest', label: 'Oldest first', short: 'Oldest' },
];

/** Compact label for the toolbar button, keyed by sort. */
const SORT_SHORT_LABEL: Record<SortKey, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.key, o.short]),
) as Record<SortKey, string>;

/** localStorage key persisting the admin's product-table sort choice. */
const TABLE_SORT_KEY = 'aminocan.productTable.sort';

/**
 * Return a new, sorted copy of `list`. Name sorts are case-insensitive and
 * natural (so "BPC-157" orders sensibly against "B12"); price sorts use the
 * currently displayed currency via `priceOf`. Every comparator falls back to
 * name A→Z on a tie so the order is stable and never jitters between renders.
 */
function sortProducts(
  list: Product[],
  key: SortKey,
  priceOf: (p: Product) => number,
): Product[] {
  const byName = (a: Product, b: Product) =>
    (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base', numeric: true });
  const time = (p: Product) => {
    const t = new Date(p.created_at ?? 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const arr = [...list];
  arr.sort((a, b) => {
    switch (key) {
      case 'name-asc': return byName(a, b);
      case 'name-desc': return byName(b, a);
      case 'price-asc': return (priceOf(a) - priceOf(b)) || byName(a, b);
      case 'price-desc': return (priceOf(b) - priceOf(a)) || byName(a, b);
      case 'stock-asc': return (Number(a.stock_quantity) - Number(b.stock_quantity)) || byName(a, b);
      case 'stock-desc': return (Number(b.stock_quantity) - Number(a.stock_quantity)) || byName(a, b);
      case 'newest': return (time(b) - time(a)) || byName(a, b);
      case 'oldest': return (time(a) - time(b)) || byName(a, b);
      default: return byName(a, b);
    }
  });
  return arr;
}

/** Human labels for inline-edited fields, used in save/undo toasts. */
const INLINE_FIELD_LABEL: Record<
  'price' | 'price_usd' | 'vial_price' | 'stock_quantity' | 'vials_per_box' | 'low_stock_threshold',
  string
> = {
  price: 'Price',
  price_usd: 'USD price',
  vial_price: 'Vial price',
  stock_quantity: 'Stock',
  vials_per_box: 'Vials per box',
  low_stock_threshold: 'Min quantity',
};

const allGroupsSelected = (v: boolean): Record<ReportGroupKey, boolean> =>
  Object.fromEntries(REPORT_GROUPS.map((g) => [g.key, v])) as Record<ReportGroupKey, boolean>;

interface ImportPreviewRow {
  slug: string;
  name: string;
  price: number;
  strength: string | null;
  description_short: string | null;
}

/** A single price or stock change, as returned by the history API. */
interface HistoryEntry {
  id: string;
  field: 'price' | 'price_usd' | 'stock_quantity' | 'vial_price';
  old_value: number | null;
  new_value: number;
  change_source: 'create' | 'inline' | 'form' | 'import' | 'revert' | 'api' | 'order' | 'invoice' | 'restock' | 'invoice_cancel' | 'cell-grid';
  changed_by: string | null;
  changed_by_name: string;
  created_at: string;
}

/** Human label for how a change was made. */
const CHANGE_SOURCE_LABEL: Record<HistoryEntry['change_source'], string> = {
  create: 'Created',
  inline: 'Inline edit',
  form: 'Edit form',
  import: 'CSV import',
  revert: 'Reverted',
  api: 'API',
  order: 'Order sale',
  invoice: 'Invoice sale',
  restock: 'PO receipt',
  invoice_cancel: 'Invoice cancelled',
  'cell-grid': 'Cell edit',
};

/** Express a vial count as its box equivalent (e.g. "10 boxes", "10 boxes + 3"). */
function formatBoxes(vials: number, vialsPerBox: number): string {
  const per = vialsPerBox > 0 ? vialsPerBox : 10;
  if (vials <= 0) return '0 boxes';
  const boxes = Math.floor(vials / per);
  const rem = vials % per;
  const boxLabel = `${boxes} box${boxes === 1 ? '' : 'es'}`;
  if (boxes === 0) return `${rem} vial${rem === 1 ? '' : 's'}`;
  return rem > 0 ? `${boxLabel} + ${rem}` : boxLabel;
}

/**
 * Express a vial count as a box count for the editable "Stock (boxes)" cell.
 * Whole boxes render as integers (e.g. "5"); partial boxes keep up to two
 * trimmed decimals (e.g. "2.5" for 25 vials at 10/box).
 */
function vialsToBoxes(vials: number, vialsPerBox: number): string {
  const per = vialsPerBox > 0 ? vialsPerBox : 10;
  const boxes = (vials || 0) / per;
  if (Number.isInteger(boxes)) return boxes.toString();
  return boxes.toFixed(2).replace(/\.?0+$/, '');
}

/** Format a span of milliseconds as a compact human duration (e.g. "3d 4h"). */
function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return 'under a minute';
}

function ProductsManagementPage() {
  const { canCreate, canEdit, canDelete, canEditProductDescriptors } = usePermissions();
  const role = useUserRole();
  const isAdmin = role === 'admin';
  // Analytics accounts can open the edit modal and save descriptor/content
  // fields, but not price/stock/pricing/visibility, and can't create or delete.
  // `canEdit` gates everything commerce; `canEditDescriptors` gates the content
  // form and its entry point.
  const canEditDescriptors = canEdit || canEditProductDescriptors;
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  // Seed the search from the URL so it survives refresh/back and can be shared;
  // it's written back to the URL whenever it changes.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [page, setPage] = useState(0);

  // Products has two view modes behind a segmented toggle: the full catalog
  // Table (modal editor, uploads, CSV import, USD toggle, pagination) and the
  // Cell edit spreadsheet — a grid for the two things that get bulk-edited
  // constantly, prices and stock. Grid edits are staged locally until Save, so
  // `gridDirty` mirrors the grid's unsaved-row count up here to badge the
  // toggle and to warn before leaving the mode.
  const [viewMode, setViewMode] = useState<'table' | 'cells'>('table');
  const [gridDirty, setGridDirty] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchQuery, pathname, router]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  // Inline validation error shown inside the create/edit form. Save-outcome
  // (success / API failure) messages are surfaced as toasts instead.
  const [formError, setFormError] = useState('');
  // True while a create/update request is in flight — drives the save button
  // spinner and prevents double-submits.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Which section of the create/edit modal is visible: the product fields or
  // the image/certificate uploads.
  const [modalTab, setModalTab] = useState<'details' | 'images'>('details');
  // `stock_boxes` is a virtual field: it edits stock in whole/partial boxes but
  // is persisted to `stock_quantity` (vials) via the product's vials-per-box rate.
  const [inlineEdit, setInlineEdit] = useState<{ id: string; field: 'price' | 'price_usd' | 'vial_price' | 'stock_quantity' | 'stock_boxes' | 'vials_per_box' | 'low_stock_threshold'; value: string } | null>(null);

  // Which currency the Price/Vial columns display. CAD is the base (the `price`
  // column); USD shows price_usd or, when unset, price × the global rate. Seeded
  // with CAD, then defaulted to the signed-in user's own configured currency
  // (their customers.price_currency tag) once it loads — so a USD-tagged
  // client/affiliate lands on USD. Still freely toggled afterwards.
  const [priceCurrency, setPriceCurrency] = useState<PriceCurrency>('CAD');
  // Global CAD→USD multiplier from Site Settings (drives auto USD prices).
  const [usdRate, setUsdRate] = useState<number>(DEFAULT_USD_RATE);
  // The db column being edited when the Price cell is inline-edited: the CAD
  // `price` in CAD mode, the USD override `price_usd` in USD mode.
  const boxField: 'price' | 'price_usd' = priceCurrency === 'USD' ? 'price_usd' : 'price';

  // Price & stock change history.
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTab, setHistoryTab] = useState<'price' | 'price_usd' | 'vial_price' | 'stock_quantity'>('price');
  const [revertingId, setRevertingId] = useState<string | null>(null);

  // Restock confirmation: shown before a stock update that will email a waitlist.
  const [restockConfirm, setRestockConfirm] = useState<{
    productName: string;
    emails: string[];
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [restockSaving, setRestockSaving] = useState(false);

  // CSV Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    csvPath: string;
    newProducts: ImportPreviewRow[];
    updateProducts: ImportPreviewRow[];
    skippedRows: number;
  } | null>(null);
  const [importConfirming, setImportConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingStock, setDownloadingStock] = useState(false);
  const [downloadingCustomerStock, setDownloadingCustomerStock] = useState(false);
  const [downloadingChanges, setDownloadingChanges] = useState(false);

  // ---- Stock Change Report (stock movement over a date range) ----
  const [showChangeReportModal, setShowChangeReportModal] = useState(false);
  const [changeRange, setChangeRange] = useState<{ from: string; to: string }>(currentWeekRange());

  // ---- Customizable "Download Report" (which sections to include) ----
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGroups, setReportGroups] = useState<Record<ReportGroupKey, boolean>>(allGroupsSelected(true));
  // Stock-status filter for the Products Report — 'all' (default) or limit the
  // rows to low / out-of-stock items.
  const [reportStockStatus, setReportStockStatus] = useState<ReportStockStatus>('all');
  // Stock display — applies to every admin/products report. Boxes by default,
  // with any leftover vials shown as a subscript unless opted out.
  const [stockUnit, setStockUnit] = useState<StockUnit>('boxes');
  const [showRemainder, setShowRemainder] = useState(true);
  // ---- Report pricing source (general price list vs a customer's dedicated one) ----
  // 'general' prices from a saved price list (or the catalog default); 'customer'
  // prices from a specific customer's overrides. General is the default.
  const [reportPriceMode, setReportPriceMode] = useState<ReportPriceMode>('general');
  // Selected general price list — '' means the catalog default (products.price).
  const [reportPricelistId, setReportPricelistId] = useState<string>('');
  // Selected customer whose dedicated prices drive the report — '' = none yet.
  const [reportCustomerId, setReportCustomerId] = useState<string>('');
  // Search within the customer picker (there can be many customers).
  const [pricingCustomerSearch, setPricingCustomerSearch] = useState('');
  // Selected affiliate whose price list drives the report — '' = none yet.
  const [reportAffiliateId, setReportAffiliateId] = useState<string>('');
  // Search within the affiliate picker.
  const [pricingAffiliateSearch, setPricingAffiliateSearch] = useState('');
  // Pricing sources, lazily loaded the first time the report modal opens.
  const [reportPricelists, setReportPricelists] = useState<ReportPricelist[]>([]);
  const [reportCustomers, setReportCustomers] = useState<ReportPricingCustomer[]>([]);
  const [reportAffiliates, setReportAffiliates] = useState<ReportPricingAffiliate[]>([]);
  const [pricingSourcesLoading, setPricingSourcesLoading] = useState(false);
  const pricingSourcesFetched = useRef(false);
  // ---- Consolidated "Reports" dropdown menu in the header ----
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  // ---- Stock Report options (its own customize modal) ----
  const [showStockReportModal, setShowStockReportModal] = useState(false);
  const [stockShowCards, setStockShowCards] = useState(true);
  const [stockShowOnOrder, setStockShowOnOrder] = useState(true);
  // Which Stock Report table columns to include in the download.
  const [stockColumns, setStockColumns] = useState<Record<StockReportColumnKey, boolean>>(
    allStockColumnsSelected(true),
  );
  // Guards the persist-on-change effect from firing before the saved config has
  // been loaded (which would clobber it with the defaults on first mount).
  const reportConfigLoaded = useRef(false);

  // ---- Table column visibility (which columns the table shows) ----
  const [visibleColumns, setVisibleColumns] = useState<Record<TableColumnKey, boolean>>(DEFAULT_VISIBLE_COLUMNS);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  // Same first-mount guard as the report config above.
  const columnsLoaded = useRef(false);

  // ---- Sort order (how the product list is ordered) ----
  const [sortBy, setSortBy] = useState<SortKey>(DEFAULT_SORT);
  const [showSortMenu, setShowSortMenu] = useState(false);
  // First-mount guard so the persist effect doesn't overwrite the saved choice
  // with the default before it's loaded.
  const sortLoaded = useRef(false);

  // Load any saved column visibility once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABLE_COLUMNS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setVisibleColumns((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
    columnsLoaded.current = true;
  }, []);

  // Persist column visibility whenever it changes (after the initial load).
  useEffect(() => {
    if (!columnsLoaded.current) return;
    try {
      localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
    } catch {
      /* ignore blocked storage */
    }
  }, [visibleColumns]);

  // Load any saved sort choice once on mount (falling back to the default).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABLE_SORT_KEY);
      if (raw && SORT_OPTIONS.some((o) => o.key === raw)) setSortBy(raw as SortKey);
    } catch {
      /* ignore malformed/blocked storage */
    }
    sortLoaded.current = true;
  }, []);

  // Persist the sort choice whenever it changes (after the initial load).
  useEffect(() => {
    if (!sortLoaded.current) return;
    try {
      localStorage.setItem(TABLE_SORT_KEY, sortBy);
    } catch {
      /* ignore blocked storage */
    }
  }, [sortBy]);

  // Number of rendered table columns: Product + Status + Actions are always
  // shown; the rest depend on the visibility toggles. Drives skeleton/empty
  // colSpan so they stay aligned as columns are hidden.
  const visibleColumnCount =
    3 + TABLE_COLUMNS.filter((c) => visibleColumns[c.key]).length;

  // Load any saved report customization once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REPORT_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.groups) setReportGroups((prev) => ({ ...prev, ...parsed.groups }));
        if (['all', 'lowout', 'low', 'out'].includes(parsed?.reportStockStatus)) {
          setReportStockStatus(parsed.reportStockStatus);
        }
        if (parsed?.stockUnit === 'boxes' || parsed?.stockUnit === 'vials') {
          setStockUnit(parsed.stockUnit);
        }
        if (typeof parsed?.showRemainder === 'boolean') setShowRemainder(parsed.showRemainder);
        if (typeof parsed?.stockShowCards === 'boolean') setStockShowCards(parsed.stockShowCards);
        if (typeof parsed?.stockShowOnOrder === 'boolean') setStockShowOnOrder(parsed.stockShowOnOrder);
        if (parsed?.stockColumns && typeof parsed.stockColumns === 'object') {
          setStockColumns((prev) => ({ ...prev, ...parsed.stockColumns }));
        }
        // Pricing source — the general price list selection sticks; the report
        // output always names its source, so a remembered choice is never hidden.
        if (['general', 'customer', 'affiliate'].includes(parsed?.reportPriceMode)) {
          setReportPriceMode(parsed.reportPriceMode);
        }
        if (typeof parsed?.reportPricelistId === 'string') setReportPricelistId(parsed.reportPricelistId);
        if (typeof parsed?.reportCustomerId === 'string') setReportCustomerId(parsed.reportCustomerId);
        if (typeof parsed?.reportAffiliateId === 'string') setReportAffiliateId(parsed.reportAffiliateId);
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
    reportConfigLoaded.current = true;
  }, []);

  // Persist the customization whenever it changes (after the initial load).
  useEffect(() => {
    if (!reportConfigLoaded.current) return;
    try {
      localStorage.setItem(
        REPORT_CONFIG_KEY,
        JSON.stringify({ groups: reportGroups, reportStockStatus, stockUnit, showRemainder, stockShowCards, stockShowOnOrder, stockColumns, reportPriceMode, reportPricelistId, reportCustomerId, reportAffiliateId }),
      );
    } catch {
      /* ignore blocked storage */
    }
  }, [reportGroups, reportStockStatus, stockUnit, showRemainder, stockShowCards, stockShowOnOrder, stockColumns, reportPriceMode, reportPricelistId, reportCustomerId, reportAffiliateId]);

  const selectedColumnCount = columnsFromGroups(reportGroups).length;
  // Customers matching the pricing-source search box (customer mode).
  const filteredPricingCustomers = (() => {
    const q = pricingCustomerSearch.toLowerCase().trim();
    if (!q) return reportCustomers;
    return reportCustomers.filter((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
      return name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });
  })();
  // Affiliates matching the pricing-source search box (affiliate mode).
  const filteredPricingAffiliates = (() => {
    const q = pricingAffiliateSearch.toLowerCase().trim();
    if (!q) return reportAffiliates;
    return reportAffiliates.filter((a) => {
      const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
      return name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    });
  })();
  // The report can't be generated with zero columns, or in customer/affiliate
  // mode with no source chosen (there'd be no dedicated prices to apply).
  const canDownloadReport =
    selectedColumnCount > 0 &&
    !(reportPriceMode === 'customer' && !reportCustomerId) &&
    !(reportPriceMode === 'affiliate' && !reportAffiliateId);
  /** Stock-display params shared by every admin/products report download. */
  const stockParams = { stockUnit, boxRemainder: showRemainder ? '1' : '0' };

  // Open a printable report in a new tab. `path` selects which report route;
  // both share the current search filter. `extra` adds report-specific params
  // (e.g. the card/column selection for the products report).
  const openReport = async (
    path: string,
    setBusy: (v: boolean) => void,
    extra?: Record<string, string>,
  ) => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) params.set(k, v);
      }
      const qs = params.toString();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`${path}${qs ? `?${qs}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        alert('Could not generate report');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    const cards = cardsFromGroups(reportGroups).join(',');
    const cols = columnsFromGroups(reportGroups).join(',');
    const extra: Record<string, string> = { cards, cols, ...stockParams };
    // Only send the filter when it narrows the report — keeps the default URL clean.
    if (reportStockStatus !== 'all') extra.stockStatus = reportStockStatus;
    // Pricing source: a customer's dedicated prices, an affiliate's price list, a
    // general price list, or — when nothing is selected — the catalog default
    // (no params, server default).
    if (reportPriceMode === 'customer' && reportCustomerId) {
      extra.priceSource = 'customer';
      extra.customerId = reportCustomerId;
    } else if (reportPriceMode === 'affiliate' && reportAffiliateId) {
      extra.priceSource = 'affiliate';
      extra.affiliateId = reportAffiliateId;
    } else if (reportPriceMode === 'general' && reportPricelistId) {
      extra.priceSource = 'pricelist';
      extra.pricelistId = reportPricelistId;
    }
    return openReport('/api/admin/products/report', setDownloading, extra);
  };

  // Load the pricing sources (general price lists + customers) the first time
  // the report modal opens. The report itself only needs the selected id, so a
  // quick toolbar download never has to wait on this.
  const ensurePricingSources = async () => {
    if (pricingSourcesFetched.current) return;
    pricingSourcesFetched.current = true;
    setPricingSourcesLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [plRes, custRes, affRes] = await Promise.all([
        fetch('/api/admin/pricelists', { headers }),
        fetch('/api/admin/customers', { headers }),
        fetch('/api/admin/affiliates', { headers }),
      ]);
      if (plRes.ok) {
        const { pricelists } = await plRes.json();
        setReportPricelists(pricelists || []);
      }
      if (custRes.ok) {
        const { customers } = await custRes.json();
        setReportCustomers(customers || []);
      }
      if (affRes.ok) {
        const { affiliates } = await affRes.json();
        setReportAffiliates(affiliates || []);
      }
    } catch {
      // Leave the pickers empty on failure — the report still works on catalog prices.
      pricingSourcesFetched.current = false;
    } finally {
      setPricingSourcesLoading(false);
    }
  };

  const openReportModal = () => {
    setShowReportModal(true);
    ensurePricingSources();
  };
  /** The Stock Report columns the operator currently has switched on. */
  const selectedStockCols = () =>
    STOCK_REPORT_COLUMNS.filter((c) => stockColumns[c.key]).map((c) => c.key);

  const downloadStockReport = () =>
    openReport('/api/admin/products/stock-report', setDownloadingStock, {
      ...stockParams,
      cards: stockShowCards ? '1' : '0',
      onOrder: stockShowOnOrder ? '1' : '0',
      cols: selectedStockCols().join(','),
    });

  /**
   * The same Stock Report, minus everything that describes how we buy: Min
   * Quantity, On Order and Need To Order (and their summary cards and the
   * on-order note). The trimming is enforced server-side by `audience`; the
   * column list here only carries the operator's other choices through, so a
   * customer copy can never leak a purchasing column.
   */
  const downloadCustomerStockReport = () =>
    openReport('/api/admin/products/stock-report', setDownloadingCustomerStock, {
      ...stockParams,
      audience: 'customer',
      cards: stockShowCards ? '1' : '0',
      cols: selectedStockCols()
        .filter((k) => CUSTOMER_STOCK_REPORT_COLUMNS.includes(k))
        .join(','),
    });
  const downloadChangeReport = () =>
    openReport('/api/admin/products/stock-change-report', setDownloadingChanges, {
      from: changeRange.from,
      to: changeRange.to,
      ...stockParams,
    });

  const resetReportConfig = () => {
    setReportGroups(allGroupsSelected(true));
    setReportStockStatus('all');
    setStockUnit('boxes');
    setShowRemainder(true);
    setReportPriceMode('general');
    setReportPricelistId('');
    setReportCustomerId('');
    setPricingCustomerSearch('');
    setReportAffiliateId('');
    setPricingAffiliateSearch('');
  };

  // ---- Scheduled Stock Report email (admin only) ----
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSending, setScheduleSending] = useState(false);
  const [schedule, setSchedule] = useState<{
    enabled: boolean;
    recipients: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    lastSentAt: string | null;
  }>({ enabled: false, recipients: '', frequency: 'weekly', lastSentAt: null });

  // Split a free-text recipients field ("a@x.com, b@y.com") into a clean list.
  const parseRecipients = (raw: string): string[] =>
    raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const openScheduleModal = async () => {
    setShowScheduleModal(true);
    setScheduleLoading(true);
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        setSchedule({
          enabled: Boolean(data.stock_report_email_enabled),
          recipients: Array.isArray(data.stock_report_email_recipients)
            ? data.stock_report_email_recipients.join(', ')
            : '',
          frequency: ['daily', 'weekly', 'monthly'].includes(data.stock_report_email_frequency)
            ? data.stock_report_email_frequency
            : 'weekly',
          lastSentAt: data.stock_report_email_last_sent_at ?? null,
        });
      }
    } catch {
      toast.error('Failed to load schedule settings');
    }
    setScheduleLoading(false);
  };

  const saveSchedule = async () => {
    const recipients = parseRecipients(schedule.recipients);
    if (schedule.enabled && recipients.length === 0) {
      toast.error('Add at least one recipient email to enable the schedule');
      return;
    }
    setScheduleSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          stock_report_email_enabled: schedule.enabled,
          stock_report_email_recipients: recipients,
          stock_report_email_frequency: schedule.frequency,
        }),
      });
      if (res.ok) {
        toast.success('Report schedule saved');
        setShowScheduleModal(false);
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Failed to save' }));
        toast.error(error || 'Failed to save schedule');
      }
    } catch {
      toast.error('Failed to save schedule');
    }
    setScheduleSaving(false);
  };

  const sendScheduleNow = async () => {
    const recipients = parseRecipients(schedule.recipients);
    if (recipients.length === 0) {
      toast.error('Add at least one recipient email first');
      return;
    }
    setScheduleSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/products/stock-report/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipients }),
      });
      if (res.ok) {
        toast.success(`Stock report sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`);
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Failed to send' }));
        toast.error(error || 'Failed to send report');
      }
    } catch {
      toast.error('Failed to send report');
    }
    setScheduleSending(false);
  };

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    price_usd: '',
    vial_price: '',
    stock_quantity: '',
    vials_per_box: '10',
    low_stock_threshold: '10',
    category: '',
    image_url: '',
    box_image_url: '',
    box_image_first: false,
    strength: '',
    purity: '',
    form: '',
    featured: false,
    active: true,
    is_checkout_addon: false,
    slug: '',
    description_short: '',
    benefits: '',
    mechanism: '',
    coa_url: [] as string[],
  });

  useEffect(() => {
    fetchProducts();
    // Load the CAD→USD multiplier so the USD toggle shows accurate prices.
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rate = Number(data?.usd_exchange_rate);
        if (Number.isFinite(rate) && rate > 0) setUsdRate(rate);
      })
      .catch(() => {/* keep the default rate */});
    // Default the CAD/USD toggle to the signed-in user's configured currency
    // (their own customers.price_currency tag). RLS lets a user read their own
    // row. Best-effort: a failure just leaves the toggle on the CAD default.
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('customers')
        .select('price_currency')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.price_currency === 'USD') setPriceCurrency('USD');
    })();
  }, []);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredProducts(products);
    } else {
      setFilteredProducts(
        rankBySearch(products, searchQuery, [
          { value: (p) => p.name, weight: 3 },
          { value: (p) => p.category, weight: 1 },
          { value: (p) => p.slug, weight: 1 },
        ]),
      );
    }
  }, [searchQuery, products]);

  // Reset to the first page whenever the search query or sort changes, so the
  // current page never points past the end of the list and a re-sort shows from
  // the top.
  useEffect(() => {
    setPage(0);
  }, [searchQuery, sortBy]);

  // Apply the chosen sort to the (search-filtered) set. Price sorts respect the
  // currently displayed currency, so toggling CAD/USD re-orders a price sort to
  // match what's on screen.
  const sortedProducts = useMemo(() => {
    const priceOf = (p: Product) =>
      priceCurrency === 'USD'
        ? productUsdPrice({ price: Number(p.price), price_usd: p.price_usd }, usdRate)
        : Number(p.price);
    return sortProducts(filteredProducts, sortBy, priceOf);
  }, [filteredProducts, sortBy, priceCurrency, usdRate]);

  // Clamp in case the list shrank (e.g. a product was deleted) below the
  // current page.
  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedProducts = sortedProducts.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = sortedProducts.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(sortedProducts.length, (safePage + 1) * PAGE_SIZE);

  const switchViewMode = (mode: 'table' | 'cells') => {
    if (mode === viewMode) return;
    if (viewMode === 'cells' && gridDirty > 0) {
      const leave = window.confirm(
        `You have ${gridDirty} product(s) with unsaved cell edits. Leave anyway and discard them?`,
      );
      if (!leave) return;
      setGridDirty(0);
    }
    setViewMode(mode);
  };

  // The grid hands back the rows the API returned, so the table view and the
  // grid agree without a refetch.
  const handleGridSaved = (updated: Product[]) => {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((p) => [p.id, p]));
    setProducts((prev) => prev.map((p) => byId.get(p.id) ?? p));
    toast.success(`Updated ${updated.length} product(s)`);
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const response = await fetch('/api/admin/products', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const { products: data } = await response.json();
        setProducts(data || []);
      } else {
        toast.error('Failed to load products');
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Failed to load products');
    }
    setLoading(false);
  };

  const extractFilePathFromUrl = (url: string, bucket: 'products' | 'certificate'): string | null => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split(`/object/public/${bucket}/`);
      return pathParts[1] || null;
    } catch {
      return null;
    }
  };

  const deleteFileFromStorage = async (url: string, bucket: 'products' | 'certificate') => {
    const path = extractFilePathFromUrl(url, bucket);
    if (!path) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const endpoint = bucket === 'products'
        ? '/api/admin/products/upload'
        : '/api/admin/products/upload-certificate';

      await fetch(`${endpoint}?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.error(`Error deleting file from ${bucket} bucket:`, error);
    }
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'image_url' | 'box_image_url' = 'image_url',
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setFormError('Please upload an image file');
      return;
    }

    // Validate file size (20MB)
    if (file.size > 20 * 1024 * 1024) {
      setFormError('Image must be less than 20MB');
      return;
    }

    setUploading(true);
    setFormError('');

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const formDataToUpload = new FormData();
      formDataToUpload.append('file', file);

      const response = await fetch('/api/admin/products/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formDataToUpload,
      });

      if (response.ok) {
        const { url } = await response.json();
        setFormData((prev) => ({ ...prev, [field]: url }));
      } else {
        const { error: errorMsg } = await response.json();
        setFormError(errorMsg || 'Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      setFormError('Failed to upload image');
    }
    setUploading(false);
  };

  const handleCertificateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setFormError('Please upload a PDF file');
      return;
    }

    // Validate file size (20MB)
    if (file.size > 20 * 1024 * 1024) {
      setFormError('PDF must be less than 20MB');
      return;
    }

    setUploading(true);
    setFormError('');

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const formDataToUpload = new FormData();
      formDataToUpload.append('file', file);

      const response = await fetch('/api/admin/products/upload-certificate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formDataToUpload,
      });

      if (response.ok) {
        const { url } = await response.json();
        setFormData((prev) => ({ ...prev, coa_url: [...prev.coa_url, url] }));
      } else {
        const { error: errorMsg } = await response.json();
        setFormError(errorMsg || 'Failed to upload certificate');
      }
    } catch (error) {
      console.error('Error uploading certificate:', error);
      setFormError('Failed to upload certificate');
    }
    setUploading(false);
    // Allow re-uploading the same file name in a row
    e.target.value = '';
  };

  const removeCoa = async (url: string) => {
    try {
      await deleteFileFromStorage(url, 'certificate');
    } catch (err) {
      console.error('Failed to delete certificate from storage:', err);
    }
    setFormData((prev) => ({
      ...prev,
      coa_url: prev.coa_url.filter((u) => u !== url),
    }));
  };

  const handleCreateOrUpdate = async () => {
    setFormError('');

    // All validated fields live on the Details tab — surface the tab so the
    // offending input is visible alongside the error message.
    const failValidation = (message: string) => {
      setModalTab('details');
      setFormError(message);
    };

    // Analytics accounts edit descriptor/content fields only; commerce fields
    // (price/stock/pricing/visibility) are hidden for them and never submitted.
    // Admins (canEdit) get the full form and its validation.
    const descriptorsOnly = !canEdit;

    if (!formData.name) {
      failValidation('Name is required');
      return;
    }

    let price = 0;
    let stockQuantity = 0;
    let vialPrice: number | null = null;
    let priceUsd: number | null = null;

    if (!descriptorsOnly) {
      if (!formData.price || formData.stock_quantity === '') {
        failValidation('Name, price, and stock quantity are required');
        return;
      }

      price = parseFloat(formData.price);
      stockQuantity = parseInt(formData.stock_quantity, 10);

      if (isNaN(price) || price < 0) {
        failValidation('Invalid price');
        return;
      }

      if (isNaN(stockQuantity) || stockQuantity < 0) {
        failValidation('Invalid stock quantity');
        return;
      }

      // Vial price is optional — blank means "use price/10 on the storefront".
      if (formData.vial_price.trim() !== '') {
        vialPrice = parseFloat(formData.vial_price);
        if (isNaN(vialPrice) || vialPrice < 0) {
          failValidation('Invalid vial price');
          return;
        }
      }

      // USD price is optional — blank means "auto: price × the global rate".
      if (formData.price_usd.trim() !== '') {
        priceUsd = parseFloat(formData.price_usd);
        if (isNaN(priceUsd) || priceUsd < 0) {
          failValidation('Invalid USD price');
          return;
        }
      }
    }

    // Descriptor/content fields — the only ones an analytics editor may change.
    const descriptorFields = {
      name: formData.name,
      description: formData.description || null,
      category: formData.category || null,
      image_url: formData.image_url || null,
      box_image_url: formData.box_image_url || null,
      box_image_first: formData.box_image_first,
      strength: formData.strength || null,
      purity: formData.purity || null,
      form: formData.form || null,
      slug: formData.slug || null,
      description_short: formData.description_short || null,
      benefits: formData.benefits || null,
      mechanism: formData.mechanism || null,
      coa_url: formData.coa_url,
    };

    const payload = descriptorsOnly
      ? {
          ...descriptorFields,
          // Tag edits from the full form so the history view can show "how" it
          // changed. Ignored on create (POST records a 'create' entry instead).
          change_source: 'form',
        }
      : {
          ...descriptorFields,
          price,
          price_usd: priceUsd,
          vial_price: vialPrice,
          stock_quantity: stockQuantity,
          vials_per_box:
            formData.vials_per_box.trim() === ''
              ? 10
              : Math.max(1, parseInt(formData.vials_per_box, 10) || 10),
          low_stock_threshold:
            formData.low_stock_threshold.trim() === ''
              ? 10
              : parseInt(formData.low_stock_threshold, 10),
          featured: formData.featured,
          active: formData.active,
          is_checkout_addon: formData.is_checkout_addon,
          change_source: 'form',
        };

    const submit = async () => {
      const isEditing = !!editingProduct;
      setSaving(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;

        const url = editingProduct
          ? `/api/admin/products/${editingProduct.id}`
          : '/api/admin/products';

        const method = editingProduct ? 'PUT' : 'POST';

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          // Patch the single affected row in place rather than reloading the
          // whole table — avoids the full-page refresh/flicker on save.
          const { product } = await response.json();
          if (product) {
            setProducts((prev) =>
              isEditing
                ? prev.map((p) => (p.id === product.id ? product : p))
                : [product, ...prev],
            );
          }
          setShowModal(false);
          resetForm();
          toast.success(
            isEditing
              ? 'Product updated successfully'
              : 'Product created successfully',
          );
        } else {
          const { error: errorMsg } = await response.json();
          toast.error(errorMsg || 'Failed to save product');
        }
      } catch (error) {
        console.error('Error saving product:', error);
        toast.error('Failed to save product');
      } finally {
        setSaving(false);
      }
    };

    // Restocking an out-of-stock product with a waitlist will email everyone on
    // it — confirm with the admin (showing who) before saving.
    if (editingProduct && (editingProduct.stock_quantity ?? 0) <= 0 && stockQuantity > 0) {
      const emails = await fetchWaiters(editingProduct.id);
      if (emails.length > 0) {
        setRestockConfirm({ productName: formData.name, emails, onConfirm: submit });
        return;
      }
    }

    await submit();
  };

  // Fetch the pending "notify me" waitlist emails for a product (admin only).
  const fetchWaiters = async (productId: string): Promise<string[]> => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const url = new URL('/api/admin/stock-notifications', window.location.origin);
      url.searchParams.set('product_id', productId);
      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.emails) ? data.emails : [];
    } catch {
      return [];
    }
  };

  // Run a queued restock update after the admin confirms the waitlist email.
  const confirmRestock = async () => {
    if (!restockConfirm) return;
    setRestockSaving(true);
    try {
      await restockConfirm.onConfirm();
    } finally {
      setRestockSaving(false);
      setRestockConfirm(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;

    setDeleting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const response = await fetch(`/api/admin/products/${deletingProduct.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Drop the row from local state instead of reloading the whole table.
        setProducts((prev) => prev.filter((p) => p.id !== deletingProduct.id));
        setShowDeleteModal(false);
        setDeletingProduct(null);
        toast.success('Product deleted successfully');
      } else {
        toast.error('Failed to delete product');
      }
    } catch (error) {
      console.error('Error deleting product:', error);
      toast.error('Failed to delete product');
    } finally {
      setDeleting(false);
    }
  };

  // Persist a single inline field change. Optimistic: the new value is applied
  // to the table immediately (so the edit feels instant — no waiting on the
  // round-trip) and the PUT is sent in the background. If the request fails we
  // roll the cell back to its previous value. Returns whether the save
  // succeeded; pass `silent` to suppress the generic error toast when the caller
  // shows its own (e.g. the box-stock progress toast).
  const commitInlineSave = async (
    id: string,
    field: 'price' | 'price_usd' | 'vial_price' | 'stock_quantity' | 'vials_per_box' | 'low_stock_threshold',
    val: number | null,
    // `silent` suppresses both the success and error toasts (used when the
    // caller shows its own, e.g. the box-stock progress toast). `isUndo` marks
    // a save that reverts a prior one — it shows a plain confirmation instead of
    // another Undo button so undos don't chain endlessly.
    opts?: { silent?: boolean; isUndo?: boolean },
  ): Promise<boolean> => {
    // Capture the pre-edit value synchronously so we can restore it on failure
    // (rollback) or offer it as the target of an Undo.
    const product = products.find((p) => p.id === id);
    const previous = (product as any)?.[field] ?? null;
    const productName = product?.name ?? 'Product';
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: val } : p)));

    const rollback = () => {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: previous } : p)));
      if (!opts?.silent) toast.error('Failed to save change');
    };

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: val, change_source: 'inline' }),
      });
      if (!res.ok) { rollback(); return false; }
      if (!opts?.silent) {
        const label = INLINE_FIELD_LABEL[field];
        if (opts?.isUndo) {
          toast.success(`${productName} · ${label} reverted`);
        } else {
          toast.success(`${productName} · ${label} updated`, {
            duration: 6000,
            action: {
              label: 'Undo',
              onClick: () => { void commitInlineSave(id, field, previous, { isUndo: true }); },
            },
          });
        }
      }
      return true;
    } catch {
      rollback();
      return false;
    }
  };

  const handleInlineSave = async () => {
    if (!inlineEdit) return;
    const { id, field } = inlineEdit;

    // Vial and USD prices are optional: clearing them stores null (vial → use
    // price/10; price_usd → auto price × rate).
    if ((field === 'vial_price' || field === 'price_usd') && inlineEdit.value.trim() === '') {
      setInlineEdit(null);
      void commitInlineSave(id, field, null);
      return;
    }

    // The boxes cell edits stock in boxes but persists vials: convert using the
    // product's vials-per-box rate, then commit to stock_quantity (reusing the
    // same restock-waitlist confirmation flow as an in-vials edit).
    if (field === 'stock_boxes') {
      const product = products.find((p) => p.id === id);
      const per = product?.vials_per_box && product.vials_per_box > 0 ? product.vials_per_box : 10;
      const boxes = parseFloat(inlineEdit.value);
      if (isNaN(boxes) || boxes < 0) { setInlineEdit(null); return; }
      const vials = Math.round(boxes * per);
      const name = product?.name ?? 'Product';
      const prevStock = product?.stock_quantity ?? 0;
      const boxLabel = `${boxes} box${boxes === 1 ? '' : 'es'}`;
      const vialLabel = `${vials} vial${vials === 1 ? '' : 's'}`;

      // A bottom-right progress toast that names the product and the amount,
      // then morphs into success/error once the save call resolves. On success
      // it offers an Undo that restores the previous vial count.
      const doSave = async () => {
        const toastId = toast.loading(`Updating ${name} to ${boxLabel} (${vialLabel})…`);
        const saved = await commitInlineSave(id, 'stock_quantity', vials, { silent: true });
        if (saved) {
          toast.update(toastId, `${name} set to ${boxLabel} · ${vialLabel}`, 'success', {
            action: {
              label: 'Undo',
              onClick: () => { void commitInlineSave(id, 'stock_quantity', prevStock, { isUndo: true }); },
            },
          });
        } else {
          toast.update(toastId, `Couldn't update ${name} to ${boxLabel}`, 'error');
        }
      };

      if (vials > 0 && product && (product.stock_quantity ?? 0) <= 0) {
        const emails = await fetchWaiters(id);
        if (emails.length > 0) {
          setInlineEdit(null);
          setRestockConfirm({ productName: product.name, emails, onConfirm: doSave });
          return;
        }
      }
      setInlineEdit(null);
      void doSave();
      return;
    }

    const val = field === 'price' || field === 'price_usd' || field === 'vial_price'
      ? parseFloat(inlineEdit.value)
      : parseInt(inlineEdit.value, 10);
    if (isNaN(val) || val < 0) { setInlineEdit(null); return; }
    // A box must hold at least one vial.
    if (field === 'vials_per_box' && val < 1) { setInlineEdit(null); return; }

    // Restocking an out-of-stock product with a waitlist will email everyone —
    // confirm first (showing who) before committing the change.
    if (field === 'stock_quantity' && val > 0) {
      const product = products.find(p => p.id === id);
      if (product && (product.stock_quantity ?? 0) <= 0) {
        const emails = await fetchWaiters(id);
        if (emails.length > 0) {
          setInlineEdit(null);
          setRestockConfirm({
            productName: product.name,
            emails,
            onConfirm: () => commitInlineSave(id, field, val),
          });
          return;
        }
      }
    }

    setInlineEdit(null);
    void commitInlineSave(id, field, val);
  };

  // Open the history modal for a product and load its change timeline.
  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryTab('price');
    setHistoryEntries([]);
    setHistoryLoading(true);
    await fetchHistory(product.id);
    setHistoryLoading(false);
  };

  const fetchHistory = async (productId: string) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/products/${productId}/history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        const { history } = await res.json();
        setHistoryEntries(Array.isArray(history) ? history : []);
      } else {
        setHistoryEntries([]);
      }
    } catch {
      setHistoryEntries([]);
    }
  };

  // Revert a field back to a previous value. Records a new 'revert' entry and
  // refreshes both the products table and the open history timeline.
  const revertChange = async (entry: HistoryEntry) => {
    if (!historyProduct) return;
    setRevertingId(entry.id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/products/${historyProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [entry.field]: entry.new_value, change_source: 'revert' }),
      });
      if (res.ok) {
        setProducts((prev) =>
          prev.map((p) => (p.id === historyProduct.id ? { ...p, [entry.field]: entry.new_value } : p)),
        );
        setHistoryProduct((prev) => (prev ? { ...prev, [entry.field]: entry.new_value } : prev));
        await fetchHistory(historyProduct.id);
      } else {
        toast.error('Failed to revert change');
      }
    } catch {
      toast.error('Failed to revert change');
    }
    setRevertingId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setEditingProduct(null);
    setModalTab('details');
    setShowModal(true);
    setFormError('');
  };

  const openEditModal = (product: Product) => {
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      price_usd: product.price_usd != null ? product.price_usd.toString() : '',
      vial_price: product.vial_price != null ? product.vial_price.toString() : '',
      stock_quantity: product.stock_quantity.toString(),
      vials_per_box:
        product.vials_per_box != null ? product.vials_per_box.toString() : '10',
      low_stock_threshold:
        product.low_stock_threshold != null ? product.low_stock_threshold.toString() : '10',
      category: product.category || '',
      image_url: product.image_url || '',
      box_image_url: product.box_image_url || '',
      box_image_first: product.box_image_first ?? false,
      strength: product.strength || '',
      purity: product.purity || '',
      form: product.form || '',
      featured: product.featured,
      active: product.active,
      is_checkout_addon: product.is_checkout_addon ?? false,
      slug: product.slug || '',
      description_short: product.description_short || '',
      benefits: product.benefits || '',
      mechanism: product.mechanism || '',
      coa_url: Array.isArray(product.coa_url) ? product.coa_url : [],
    });
    setEditingProduct(product);
    setModalTab('details');
    setShowModal(true);
    setFormError('');
  };

  const openDeleteModal = (product: Product) => {
    setDeletingProduct(product);
    setShowDeleteModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      price_usd: '',
      vial_price: '',
      stock_quantity: '',
      vials_per_box: '10',
      low_stock_threshold: '10',
      category: '',
      image_url: '',
      box_image_url: '',
      box_image_first: false,
      strength: '',
      purity: '',
      form: '',
      featured: false,
      active: true,
      is_checkout_addon: false,
      slug: '',
      description_short: '',
      benefits: '',
      mechanism: '',
      coa_url: [],
    });
    setEditingProduct(null);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportStep('upload');
    setImportFile(null);
    setImportPreview(null);
    setFormError('');
  };

  const handleImportUpload = async () => {
    if (!importFile) {
      setFormError('Please select a CSV file');
      return;
    }
    setImportLoading(true);
    setFormError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const fd = new FormData();
      fd.append('file', importFile);

      const response = await fetch('/api/admin/products/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const data = await response.json();
      if (response.ok) {
        setImportPreview(data);
        setImportStep('preview');
      } else {
        setFormError(data.error || 'Failed to analyze CSV');
      }
    } catch {
      setFormError('Failed to analyze CSV');
    }
    setImportLoading(false);
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImportConfirming(true);
    setFormError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const response = await fetch('/api/admin/products/import', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          newProducts: importPreview.newProducts,
          updateProducts: importPreview.updateProducts,
          csvPath: importPreview.csvPath,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        closeImportModal();
        toast.success(`Imported ${data.inserted} new and updated ${data.updated} products`);
        // A bulk import can touch many rows — reload the table to reflect them.
        fetchProducts();
      } else {
        setFormError(data.error || 'Import failed');
      }
    } catch {
      setFormError('Import failed');
    }
    setImportConfirming(false);
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink mb-1">Products</h1>
          <p className="text-ink-muted text-sm">{canEdit ? 'Manage product catalog' : canEditDescriptors ? 'Edit product details — pricing & stock are locked' : 'Product catalog (view only)'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/*
            Reports live behind one "Reports" menu so the header stays calm — the
            four report actions (each of which used to be its own header button)
            are grouped as clearly-labelled rows, with a one-click download and a
            separate "Customize" affordance where one applies. Import & Add stay
            as direct actions since they're the day-to-day catalog controls.
          */}
          <div className="relative flex-1 sm:flex-none">
            <button
              onClick={() => setShowReportsMenu((v) => !v)}
              aria-haspopup="true"
              aria-expanded={showReportsMenu}
              disabled={downloading || downloadingStock || downloadingCustomerStock || downloadingChanges}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 bg-white text-ink border border-line rounded-lg hover:bg-surface transition-all font-medium text-sm disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {downloading || downloadingStock || downloadingCustomerStock || downloadingChanges ? 'Generating…' : 'Reports'}
              <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${showReportsMenu ? 'rotate-180' : ''}`} />
            </button>
            {showReportsMenu && (
              <>
                {/* Click-away backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setShowReportsMenu(false)} aria-hidden="true" />
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white border border-line rounded-xl shadow-lg z-20 p-1.5">
                  <div className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Download a report
                  </div>

                  {/* Products Report — the customizable catalog/inventory/pricing report */}
                  <div className="flex items-stretch gap-1">
                    <button
                      onClick={() => { setShowReportsMenu(false); downloadReport(); }}
                      disabled={downloading}
                      className="flex-1 flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      <FileText className="w-4 h-4 text-vital mt-0.5 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">Products Report</span>
                        <span className="block text-xs text-ink-muted">Catalog, inventory & pricing</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setShowReportsMenu(false); openReportModal(); }}
                      title="Customize — sections, stock filter & pricing source"
                      aria-label="Customize Products Report"
                      className="inline-flex items-center justify-center px-2.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink transition-colors"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stock Report — on-hand & reorder levels */}
                  <div className="flex items-stretch gap-1">
                    <button
                      onClick={() => { setShowReportsMenu(false); downloadStockReport(); }}
                      disabled={downloadingStock}
                      className="flex-1 flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      <Package className="w-4 h-4 text-vital mt-0.5 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">Stock Report</span>
                        <span className="block text-xs text-ink-muted">On-hand & reorder levels</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setShowReportsMenu(false); setShowStockReportModal(true); }}
                      title="Customize — units, cards, columns & on-order note"
                      aria-label="Customize Stock Report"
                      className="inline-flex items-center justify-center px-2.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink transition-colors"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Customer Stock Report — the same stock levels with every
                      purchasing detail (min qty, on order, need to order)
                      stripped, so it can be sent straight to a customer. */}
                  <button
                    onClick={() => { setShowReportsMenu(false); downloadCustomerStockReport(); }}
                    disabled={downloadingCustomerStock}
                    className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
                  >
                    <Users className="w-4 h-4 text-vital mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">Customer Stock Report</span>
                      <span className="block text-xs text-ink-muted">
                        On-hand stock only — no min qty, on order or need to order
                      </span>
                    </span>
                  </button>

                  {/* Stock Changes — movement over a date range (opens its own modal) */}
                  <button
                    onClick={() => { setShowReportsMenu(false); setShowChangeReportModal(true); }}
                    className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface transition-colors"
                  >
                    <TrendingUp className="w-4 h-4 text-vital mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">Stock Changes</span>
                      <span className="block text-xs text-ink-muted">Movement over a date range</span>
                    </span>
                  </button>

                  {isAdmin && (
                    <>
                      <div className="my-1 border-t border-line/70" />
                      <button
                        onClick={() => { setShowReportsMenu(false); openScheduleModal(); }}
                        className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface transition-colors"
                      >
                        <Mail className="w-4 h-4 text-ink-muted mt-0.5 flex-shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">Email Schedule</span>
                          <span className="block text-xs text-ink-muted">Auto-email the Stock Report</span>
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {canCreate && (
            <>
              <button
                onClick={() => { setShowImportModal(true); setImportStep('upload'); }}
                className="inline-flex items-center justify-center gap-2 flex-1 sm:flex-none px-4 py-2.5 bg-surface text-ink border border-line rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                <FileUp className="w-4 h-4" />
                Import CSV
              </button>
              <button
                onClick={openCreateModal}
                className="inline-flex items-center justify-center gap-2 flex-1 sm:flex-none px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Product
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search Bar + price currency toggle */}
      <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
          />
        </div>
        {/* View mode: the full catalog table, or the bulk price/stock grid. */}
        <div className="inline-flex items-center rounded-xl border border-line bg-surface p-1 self-start sm:self-auto">
          {([
            { key: 'table', label: 'Table', hint: 'Full catalog — edit, upload, import' },
            { key: 'cells', label: 'Cell edit', hint: 'Spreadsheet for bulk price & stock edits' },
          ] as const).map((mode) => {
            const active = viewMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                onClick={() => switchViewMode(mode.key)}
                title={mode.hint}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {mode.label}
                {mode.key === 'cells' && !active && gridDirty > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold tabular-nums">
                    {gridDirty}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* CAD is the base price column; USD shows price_usd or price × rate.
            The cell grid always edits the CAD base, so this is table-only. */}
        {viewMode === 'table' && (
        <div
          className="inline-flex items-center rounded-xl border border-line bg-surface p-1 self-start sm:self-auto"
          title="Show prices in CAD or USD"
        >
          {(['CAD', 'USD'] as const).map((cur) => {
            const active = priceCurrency === cur;
            return (
              <button
                key={cur}
                type="button"
                onClick={() => setPriceCurrency(cur)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                ${cur}
              </button>
            );
          })}
        </div>
        )}
        {/* Sort menu — choose how the product list is ordered. Defaults to
            Name A–Z (alphabetical), matching the downloadable stock report. */}
        <div className="relative self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowSortMenu((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showSortMenu}
            title="Choose how to sort the list"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-ink border border-line rounded-xl hover:bg-surface transition-all font-medium text-sm"
          >
            <ArrowUpDown className="w-4 h-4" />
            Sort
            <span className="text-ink-muted font-normal">· {SORT_SHORT_LABEL[sortBy]}</span>
            <ChevronDown className="w-4 h-4 text-ink-muted" />
          </button>
          {showSortMenu && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowSortMenu(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-56 bg-white border border-line rounded-xl shadow-lg z-20 p-2">
                <div className="px-2 py-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Sort by
                </div>
                {SORT_OPTIONS.map((opt) => {
                  const active = sortBy === opt.key;
                  return (
                    <React.Fragment key={opt.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setSortBy(opt.key);
                          setShowSortMenu(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                          active ? 'bg-surface text-ink font-medium' : 'text-ink hover:bg-surface'
                        }`}
                      >
                        {opt.label}
                        {active && <Check className="w-4 h-4 text-vital shrink-0" />}
                      </button>
                      {opt.divideAfter && <div className="my-1 border-t border-line" />}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {/* Column visibility menu — choose which optional columns to show.
            The cell grid has its own fixed six columns. */}
        {viewMode === 'table' && (
        <div className="relative self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowColumnMenu((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showColumnMenu}
            title="Choose which columns to show"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-ink border border-line rounded-xl hover:bg-surface transition-all font-medium text-sm"
          >
            <Columns3 className="w-4 h-4" />
            Columns
          </button>
          {showColumnMenu && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowColumnMenu(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-60 bg-white border border-line rounded-xl shadow-lg z-20 p-2">
                <div className="px-2 py-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Show columns
                </div>
                {TABLE_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface cursor-pointer text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns[col.key]}
                      onChange={(e) =>
                        setVisibleColumns((prev) => ({ ...prev, [col.key]: e.target.checked }))
                      }
                      className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                    />
                    {col.label}
                  </label>
                ))}
                <div className="border-t border-line mt-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface text-xs text-ink-muted hover:text-ink transition-colors"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        )}
      </div>
      {viewMode === 'table' && priceCurrency === 'USD' && (
        <p className="-mt-3 mb-6 text-xs text-ink-muted">
          Showing USD prices (1&nbsp;CAD&nbsp;≈&nbsp;{usdRate}&nbsp;USD). Prices marked
          {' '}<span className="italic">auto</span>{' '}are computed from the CAD price;
          edit a USD price to override it. The rate is set in Site Settings.
        </p>
      )}

      {viewMode === 'cells' ? (
        loading ? (
          <div className="bg-white rounded-xl border border-line p-12 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-b-2 border-vital animate-spin" />
            <span className="text-sm text-ink-muted">Loading catalog…</span>
          </div>
        ) : (
          // The grid renders the rows it is handed: search-filtered and sorted
          // here, never paginated — a spreadsheet you have to page through
          // isn't one. It never fetches and never talks to Supabase directly.
          <CellEditGrid
            products={sortedProducts}
            canEdit={canEdit}
            onSaved={handleGridSaved}
            onDirtyCountChange={setGridDirty}
          />
        )
      ) : (
      /* Products Table (desktop ≥lg) / cards (mobile) — ADR 0007. The table is
         untouched at ≥lg; below lg it's hidden and the card list renders. */
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Product
                </th>
                {visibleColumns.price && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Price ({priceCurrency})
                  </th>
                )}
                {visibleColumns.stockVials && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Stock (vials)
                  </th>
                )}
                {visibleColumns.stockBoxes && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Stock (boxes)
                  </th>
                )}
                {visibleColumns.vialsPerBox && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Vials / Box
                  </th>
                )}
                {visibleColumns.minQuantity && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Min Quantity
                  </th>
                )}
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-line/40" />
                        <div className="h-4 w-32 bg-line/40 rounded" />
                      </div>
                    </td>
                    {Array.from({ length: visibleColumnCount - 1 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 w-16 bg-line/40 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-5 py-12 text-center text-ink-muted text-sm">
                    No products found
                  </td>
                </tr>
              ) : (
                pagedProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              title="Product image"
                              className="w-12 h-12 rounded-lg object-cover border border-line"
                            />
                          ) : (
                            <div
                              className="w-12 h-12 rounded-lg bg-surface border border-line flex items-center justify-center"
                              title="No product image"
                            >
                              <ImageIcon className="w-5 h-5 text-ink-muted" />
                            </div>
                          )}
                          {product.box_image_url && (
                            <img
                              src={product.box_image_url}
                              alt={`${product.name} packaging`}
                              title="Box / packaging image"
                              className="w-12 h-12 rounded-lg object-cover border border-line"
                            />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">{product.name}</div>
                          {product.slug && (
                            <div className="text-xs text-ink-muted">{product.slug}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {visibleColumns.price && (
                    <td className="px-5 py-4 font-semibold text-ink tabular-nums">
                      <div className="flex flex-col items-start gap-0.5">
                        {/* Main price (CAD base or USD override / auto). */}
                        {canEdit && inlineEdit?.id === product.id && inlineEdit.field === boxField ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={inlineEdit.value}
                            autoFocus
                            placeholder={priceCurrency === 'USD' ? productUsdPrice(product, usdRate).toFixed(2) : undefined}
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-24 px-2 py-1 border border-vital/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && setInlineEdit({
                              id: product.id,
                              field: boxField,
                              value: priceCurrency === 'USD'
                                ? (product.price_usd != null ? product.price_usd.toString() : '')
                                : product.price.toString(),
                            })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-left ${
                              canEdit
                                ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital hover:text-vital transition-colors'
                                : ''
                            }`}
                            title={canEdit ? (priceCurrency === 'USD' ? 'Click to set a USD price (blank = auto)' : 'Click to edit price') : undefined}
                          >
                            {priceCurrency === 'CAD' ? (
                              <span>${product.price.toFixed(2)}</span>
                            ) : product.price_usd != null ? (
                              <span>${product.price_usd.toFixed(2)}</span>
                            ) : (
                              <span className="font-normal text-ink-muted">${productUsdPrice(product, usdRate).toFixed(2)} <span className="text-[10px]">auto</span></span>
                            )}
                            {canEdit && (
                              <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />
                            )}
                          </button>
                        )}
                        {/* Vial price shown as a subscript of the price column. */}
                        {priceCurrency === 'USD' ? (
                          // No per-vial USD override — the USD vial price is always
                          // the CAD vial price × the global rate. Edit in CAD mode.
                          <span
                            className="text-[11px] font-normal text-ink-muted"
                            title="USD vial price (auto from CAD × rate). Switch to CAD to edit."
                          >
                            Vial ${usdFromCad(product.vial_price != null ? product.vial_price : product.price / 10, usdRate).toFixed(2)}{' '}
                            <span className="text-[9px]">auto</span>
                          </span>
                        ) : canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'vial_price' ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={inlineEdit.value}
                            autoFocus
                            placeholder={(product.price / 10).toFixed(2)}
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-20 px-2 py-0.5 border border-vital/60 rounded text-xs focus:outline-none focus:ring-2 focus:ring-vital/40"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'vial_price', value: product.vial_price != null ? product.vial_price.toString() : '' })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 text-[11px] font-normal text-ink-muted ${
                              canEdit
                                ? 'cursor-text border-b border-dashed border-ink-muted/30 hover:bg-vital/5 hover:border-vital hover:text-vital transition-colors'
                                : ''
                            }`}
                            title={canEdit ? 'Click to edit single-vial price' : undefined}
                          >
                            {product.vial_price != null ? (
                              <span>Vial ${product.vial_price.toFixed(2)}</span>
                            ) : (
                              <span>Vial ${(product.price / 10).toFixed(2)} <span className="text-[9px]">auto</span></span>
                            )}
                            {canEdit && (
                              <Pencil className="w-2.5 h-2.5 text-ink-muted/40 group-hover:text-vital transition-colors" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    )}
                    {visibleColumns.stockVials && (
                    <td className="px-5 py-4">
                      {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'stock_quantity' ? (
                        <input
                          type="number"
                          min="0"
                          value={inlineEdit.value}
                          autoFocus
                          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onBlur={handleInlineSave}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="w-20 px-2 py-1 border border-vital/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                      ) : (
                        <div>
                          <button
                            type="button"
                            onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'stock_quantity', value: product.stock_quantity.toString() })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium ${
                              canEdit
                                ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors'
                                : ''
                            } ${
                              product.stock_quantity > 10
                                ? 'text-emerald-600'
                                : product.stock_quantity > 0
                                ? 'text-amber-600'
                                : 'text-red-600'
                            }`}
                            title={canEdit ? 'Click to edit stock (in vials)' : undefined}
                          >
                            <span>{product.stock_quantity}</span>
                            {canEdit && (
                              <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />
                            )}
                          </button>
                          <div className="mt-0.5 text-[10px] text-ink-muted tabular-nums">
                            {formatBoxes(product.stock_quantity, product.vials_per_box ?? 10)}
                          </div>
                        </div>
                      )}
                    </td>
                    )}
                    {visibleColumns.stockBoxes && (
                    <td className="px-5 py-4">
                      {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'stock_boxes' ? (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={inlineEdit.value}
                          autoFocus
                          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onBlur={handleInlineSave}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="w-20 px-2 py-1 border border-vital/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                      ) : (
                        <div>
                          <button
                            type="button"
                            onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'stock_boxes', value: vialsToBoxes(product.stock_quantity, product.vials_per_box ?? 10) })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium text-ink ${
                              canEdit
                                ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors'
                                : ''
                            }`}
                            title={canEdit ? `Click to edit stock in boxes (× ${product.vials_per_box ?? 10} vials/box)` : undefined}
                          >
                            <span>{vialsToBoxes(product.stock_quantity, product.vials_per_box ?? 10)}</span>
                            {canEdit && (
                              <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />
                            )}
                          </button>
                          <div className="mt-0.5 text-[10px] text-ink-muted tabular-nums">
                            {product.stock_quantity} vial{product.stock_quantity === 1 ? '' : 's'}
                          </div>
                        </div>
                      )}
                    </td>
                    )}
                    {visibleColumns.vialsPerBox && (
                    <td className="px-5 py-4">
                      {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'vials_per_box' ? (
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={inlineEdit.value}
                          autoFocus
                          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onBlur={handleInlineSave}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="w-20 px-2 py-1 border border-vital/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'vials_per_box', value: (product.vials_per_box ?? 10).toString() })}
                          disabled={!canEdit}
                          className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium text-ink ${
                            canEdit
                              ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors'
                              : ''
                          }`}
                          title={canEdit ? 'Vials per box — used to convert received boxes into vials' : undefined}
                        >
                          <span>{product.vials_per_box ?? 10}</span>
                          {canEdit && (
                            <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />
                          )}
                        </button>
                      )}
                    </td>
                    )}
                    {visibleColumns.minQuantity && (
                    <td className="px-5 py-4">
                      {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'low_stock_threshold' ? (
                        <input
                          type="number"
                          min="0"
                          value={inlineEdit.value}
                          autoFocus
                          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onBlur={handleInlineSave}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                          className="w-20 px-2 py-1 border border-vital/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'low_stock_threshold', value: (product.low_stock_threshold ?? 10).toString() })}
                          disabled={!canEdit}
                          className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium ${
                            canEdit
                              ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors'
                              : ''
                          } ${
                            product.stock_quantity <= (product.low_stock_threshold ?? 10)
                              ? 'text-amber-600'
                              : 'text-ink-muted'
                          }`}
                          title={canEdit ? 'Click to edit low-stock alert threshold' : undefined}
                        >
                          <span>≤ {product.low_stock_threshold ?? 10}</span>
                          {canEdit && (
                            <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />
                          )}
                        </button>
                      )}
                    </td>
                    )}
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          product.active
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-gray-500/10 text-ink-muted'
                        }`}
                      >
                        {product.active ? 'Active' : 'Inactive'}
                      </span>
                      {product.featured && (
                        <span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-vital/10 text-vital">
                          Featured
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openHistory(product)}
                          className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-vital"
                          title="Price & stock history"
                        >
                          <History className="w-4 h-4" />
                        </button>
                        {canEditDescriptors && (
                          <>
                            <button
                              onClick={() => openEditModal(product)}
                              className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => openDeleteModal(product)}
                                className="p-2 hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg). Each editable field reuses the exact same
            inline-edit conditionals as the table (single `inlineEdit` state, so
            no conflict between the two renderings); inputs use 16px to avoid iOS
            focus-zoom. See ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="divide-y divide-line/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`skc-${i}`} className="px-4 py-3.5 animate-pulse flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-line/40 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-line/40 rounded" />
                    <div className="h-3 w-20 bg-line/40 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">No products found</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {pagedProducts.map((product) => (
                <li key={product.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-1 shrink-0">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} title="Product image" className="w-12 h-12 rounded-lg object-cover border border-line" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-surface border border-line flex items-center justify-center" title="No product image">
                          <ImageIcon className="w-5 h-5 text-ink-muted" />
                        </div>
                      )}
                      {product.box_image_url && (
                        <img src={product.box_image_url} alt={`${product.name} packaging`} title="Box / packaging image" className="w-12 h-12 rounded-lg object-cover border border-line" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink">{product.name}</div>
                          {product.slug && <div className="text-xs text-ink-muted break-all">{product.slug}</div>}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => openHistory(product)} className="w-10 h-10 flex items-center justify-center hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-vital" title="Price & stock history" aria-label="History">
                            <History className="w-4 h-4" />
                          </button>
                          {canEditDescriptors && (
                            <>
                              <button onClick={() => openEditModal(product)} className="w-10 h-10 flex items-center justify-center hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink" title="Edit" aria-label="Edit">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {canDelete && (
                                <button onClick={() => openDeleteModal(product)} className="w-10 h-10 flex items-center justify-center hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600" title="Delete" aria-label="Delete">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${product.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-ink-muted'}`}>
                          {product.active ? 'Active' : 'Inactive'}
                        </span>
                        {product.featured && <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-vital/10 text-vital">Featured</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    {visibleColumns.price && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light mb-0.5">Price ({priceCurrency})</div>
                        <div className="flex flex-col items-start gap-0.5">
                          {canEdit && inlineEdit?.id === product.id && inlineEdit.field === boxField ? (
                            <input type="number" step="0.01" min="0" value={inlineEdit.value} autoFocus
                              placeholder={priceCurrency === 'USD' ? productUsdPrice(product, usdRate).toFixed(2) : undefined}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={handleInlineSave}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                              className="w-24 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                          ) : (
                            <button type="button"
                              onClick={() => canEdit && setInlineEdit({ id: product.id, field: boxField, value: priceCurrency === 'USD' ? (product.price_usd != null ? product.price_usd.toString() : '') : product.price.toString() })}
                              disabled={!canEdit}
                              className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-semibold text-ink ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital hover:text-vital transition-colors' : ''}`}>
                              {priceCurrency === 'CAD' ? <span>${product.price.toFixed(2)}</span>
                                : product.price_usd != null ? <span>${product.price_usd.toFixed(2)}</span>
                                  : <span className="font-normal text-ink-muted">${productUsdPrice(product, usdRate).toFixed(2)} <span className="text-[10px]">auto</span></span>}
                              {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                            </button>
                          )}
                          {priceCurrency === 'USD' ? (
                            <span className="text-[11px] font-normal text-ink-muted" title="USD vial price (auto from CAD × rate). Switch to CAD to edit.">
                              Vial ${usdFromCad(product.vial_price != null ? product.vial_price : product.price / 10, usdRate).toFixed(2)} <span className="text-[9px]">auto</span>
                            </span>
                          ) : canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'vial_price' ? (
                            <input type="number" step="0.01" min="0" value={inlineEdit.value} autoFocus placeholder={(product.price / 10).toFixed(2)}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={handleInlineSave}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                              className="w-20 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                          ) : (
                            <button type="button"
                              onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'vial_price', value: product.vial_price != null ? product.vial_price.toString() : '' })}
                              disabled={!canEdit}
                              className={`group inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 text-[11px] font-normal text-ink-muted ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/30 hover:bg-vital/5 hover:border-vital hover:text-vital transition-colors' : ''}`}>
                              {product.vial_price != null ? <span>Vial ${product.vial_price.toFixed(2)}</span> : <span>Vial ${(product.price / 10).toFixed(2)} <span className="text-[9px]">auto</span></span>}
                              {canEdit && <Pencil className="w-2.5 h-2.5 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {visibleColumns.stockVials && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light mb-0.5">Stock (vials)</div>
                        {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'stock_quantity' ? (
                          <input type="number" min="0" value={inlineEdit.value} autoFocus
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-20 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                        ) : (
                          <div>
                            <button type="button"
                              onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'stock_quantity', value: product.stock_quantity.toString() })}
                              disabled={!canEdit}
                              className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors' : ''} ${product.stock_quantity > 10 ? 'text-emerald-600' : product.stock_quantity > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                              <span>{product.stock_quantity}</span>
                              {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                            </button>
                            <div className="mt-0.5 text-[10px] text-ink-muted tabular-nums">{formatBoxes(product.stock_quantity, product.vials_per_box ?? 10)}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {visibleColumns.stockBoxes && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light mb-0.5">Stock (boxes)</div>
                        {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'stock_boxes' ? (
                          <input type="number" min="0" step="any" value={inlineEdit.value} autoFocus
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-20 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                        ) : (
                          <div>
                            <button type="button"
                              onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'stock_boxes', value: vialsToBoxes(product.stock_quantity, product.vials_per_box ?? 10) })}
                              disabled={!canEdit}
                              className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium text-ink ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors' : ''}`}>
                              <span>{vialsToBoxes(product.stock_quantity, product.vials_per_box ?? 10)}</span>
                              {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                            </button>
                            <div className="mt-0.5 text-[10px] text-ink-muted tabular-nums">{product.stock_quantity} vial{product.stock_quantity === 1 ? '' : 's'}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {visibleColumns.vialsPerBox && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light mb-0.5">Vials / Box</div>
                        {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'vials_per_box' ? (
                          <input type="number" min="1" step="1" value={inlineEdit.value} autoFocus
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-20 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                        ) : (
                          <button type="button"
                            onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'vials_per_box', value: (product.vials_per_box ?? 10).toString() })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium text-ink ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors' : ''}`}>
                            <span>{product.vials_per_box ?? 10}</span>
                            {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                          </button>
                        )}
                      </div>
                    )}
                    {visibleColumns.minQuantity && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light mb-0.5">Min Quantity</div>
                        {canEdit && inlineEdit?.id === product.id && inlineEdit.field === 'low_stock_threshold' ? (
                          <input type="number" min="0" value={inlineEdit.value} autoFocus
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onBlur={handleInlineSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setInlineEdit(null); }}
                            className="w-20 px-2 py-1 border border-vital/60 rounded text-base focus:outline-none focus:ring-2 focus:ring-vital/40" />
                        ) : (
                          <button type="button"
                            onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'low_stock_threshold', value: (product.low_stock_threshold ?? 10).toString() })}
                            disabled={!canEdit}
                            className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-sm font-medium ${canEdit ? 'cursor-text border-b border-dashed border-ink-muted/40 hover:bg-vital/5 hover:border-vital transition-colors' : ''} ${product.stock_quantity <= (product.low_stock_threshold ?? 10) ? 'text-amber-600' : 'text-ink-muted'}`}>
                            <span>≤ {product.low_stock_threshold ?? 10}</span>
                            {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-vital transition-colors" />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {!loading && sortedProducts.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{sortedProducts.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {safePage + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={safePage + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (() => {
        const imageCount =
          (formData.image_url ? 1 : 0) +
          (formData.box_image_url ? 1 : 0) +
          formData.coa_url.length;
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-4xl w-full p-4 sm:p-6 my-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-ink">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs — switch between the product fields and the media uploads. */}
            <div className="flex gap-1 mb-5 border-b border-line">
              <button
                type="button"
                onClick={() => setModalTab('details')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  modalTab === 'details'
                    ? 'border-vital text-vital'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                <FileText className="w-4 h-4" />
                Details
              </button>
              <button
                type="button"
                onClick={() => setModalTab('images')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  modalTab === 'images'
                    ? 'border-vital text-vital'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                Images &amp; Files
                {imageCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-vital/10 text-vital text-[10px] font-semibold">
                    {imageCount}
                  </span>
                )}
              </button>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{formError}</p>
              </div>
            )}

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {/* ---- Images & Files tab ---- */}
              <div className={modalTab === 'images' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'hidden'}>
              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Product Image</label>
                {formData.image_url ? (
                  <div className="relative">
                    <img
                      src={formData.image_url}
                      alt="Product preview"
                      className="w-full h-48 object-cover rounded-lg border border-line"
                    />
                    <button
                      onClick={async () => {
                        await deleteFileFromStorage(formData.image_url, 'products');
                        setFormData({ ...formData, image_url: '' });
                      }}
                      className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      className="hidden"
                      id="image-upload"
                    />
                    <label
                      htmlFor="image-upload"
                      className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
                    >
                      {uploading ? (
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-vital mx-auto mb-2" />
                          <p className="text-sm text-ink-muted">Uploading...</p>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-ink-muted mb-2" />
                          <p className="text-sm text-ink-muted">
                            Click to upload image (max 20MB)
                          </p>
                        </>
                      )}
                    </label>
                  </div>
                )}
              </div>

              {/* Box / Packaging Image Upload */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Box / Packaging Image
                </label>
                {formData.box_image_url ? (
                  <div className="relative">
                    <img
                      src={formData.box_image_url}
                      alt="Box image preview"
                      className="w-full h-48 object-cover rounded-lg border border-line"
                    />
                    <button
                      onClick={async () => {
                        await deleteFileFromStorage(formData.box_image_url, 'products');
                        setFormData({ ...formData, box_image_url: '' });
                      }}
                      className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, 'box_image_url')}
                      disabled={uploading}
                      className="hidden"
                      id="box-image-upload"
                    />
                    <label
                      htmlFor="box-image-upload"
                      className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
                    >
                      {uploading ? (
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-vital mx-auto mb-2" />
                          <p className="text-sm text-ink-muted">Uploading...</p>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-ink-muted mb-2" />
                          <p className="text-sm text-ink-muted">
                            Click to upload packaging image (max 20MB)
                          </p>
                          <p className="text-xs text-ink-muted mt-1">
                            Shown on the storefront on hover (or first, if enabled
                            below) and for box pack sizes
                          </p>
                        </>
                      )}
                    </label>
                  </div>
                )}

                {/* Opt this product's storefront cards into leading with the box
                    image instead of the vial shot. Only takes effect once a box
                    image is set above; the card falls back to the vial otherwise. */}
                <label
                  className="flex items-start gap-2 cursor-pointer mt-3"
                  title="When on, the storefront product cards show this product's box / packaging image first, with the vial image on hover. Requires a box image."
                >
                  <input
                    type="checkbox"
                    checked={formData.box_image_first}
                    onChange={(e) => setFormData({ ...formData, box_image_first: e.target.checked })}
                    className="mt-0.5 w-4 h-4 text-vital bg-surface border-line rounded focus:ring-vital/40"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-ink">Show box image first on storefront cards</span>
                    <span className="block text-xs text-ink-muted mt-0.5">
                      The card leads with the box image and moves the vial image to hover.
                    </span>
                  </span>
                </label>
              </div>

              {/* Certificates of Analysis (multiple PDFs) */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink mb-2">
                  Certificates of Analysis (PDF)
                </label>

                {formData.coa_url.length > 0 && (
                  <ul className="space-y-2 mb-3">
                    {formData.coa_url.map((url, i) => (
                      <li
                        key={url}
                        className="relative border border-line rounded-lg p-3 flex items-center gap-3"
                      >
                        <div className="flex-shrink-0 w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">COA #{i + 1}</p>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-vital hover:underline"
                          >
                            View
                          </a>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCoa(url)}
                          className="flex-shrink-0 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                          title="Remove certificate"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="relative">
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleCertificateUpload}
                    disabled={uploading}
                    className="hidden"
                    id="certificate-upload"
                  />
                  <label
                    htmlFor="certificate-upload"
                    className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
                  >
                    {uploading ? (
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-vital mx-auto mb-2" />
                        <p className="text-sm text-ink-muted">Uploading...</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-ink-muted mb-1" />
                        <p className="text-sm text-ink-muted">
                          {formData.coa_url.length > 0
                            ? 'Add another COA (PDF, max 20MB)'
                            : 'Click to upload PDF certificate (max 20MB)'}
                        </p>
                      </>
                    )}
                  </label>
                </div>
              </div>
              </div>
              {/* ---- end Images & Files tab ---- */}

              {/* ---- Details tab ---- */}
              <div className={modalTab === 'details' ? 'space-y-4' : 'hidden'}>
              {/* Name & Slug */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="Product name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Slug</label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="product-slug (auto-generated if empty)"
                  />
                </div>
              </div>

              {/* Price & Stock Quantity — admin-only. Hidden for analytics
                  (descriptor-only) editors; the API also drops these fields. */}
              {canEdit && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Price (CAD) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-ink-muted mt-1">Pack of 10 (box) price, in CAD.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Price (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price_usd}
                    onChange={(e) => setFormData({ ...formData, price_usd: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder={formData.price ? (parseFloat(formData.price) * usdRate || 0).toFixed(2) : '0.00'}
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Leave blank to auto-calculate (CAD × {usdRate}).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Vial Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.vial_price}
                    onChange={(e) => setFormData({ ...formData, vial_price: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder={formData.price ? (parseFloat(formData.price) / 10 || 0).toFixed(2) : '0.00'}
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Single-vial price. Leave blank to use price ÷ 10.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Stock Quantity (vials) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.stock_quantity}
                    onChange={(e) =>
                      setFormData({ ...formData, stock_quantity: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="0"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    On-hand stock counted in individual vials.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Vials per Box
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.vials_per_box}
                    onChange={(e) =>
                      setFormData({ ...formData, vials_per_box: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="10"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Receiving a box line on a purchase order adds this many vials. Defaults to 10.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Low Stock Alert Threshold
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.low_stock_threshold}
                    onChange={(e) =>
                      setFormData({ ...formData, low_stock_threshold: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="10"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Email admins &amp; flag on the dashboard when stock reaches this level or lower. Defaults to 10.
                  </p>
                </div>
              </div>
              )}

              {/* Category, Strength, Purity, Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Category</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="e.g., Peptides"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Strength</label>
                  <input
                    type="text"
                    value={formData.strength}
                    onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="e.g., 5mg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Purity</label>
                  <input
                    type="text"
                    value={formData.purity}
                    onChange={(e) => setFormData({ ...formData, purity: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="e.g., 99%"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Form</label>
                  <input
                    type="text"
                    value={formData.form}
                    onChange={(e) => setFormData({ ...formData, form: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm"
                    placeholder="e.g., Lyophilized Powder"
                  />
                </div>
              </div>

              {/* Short Description */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Short Description
                </label>
                <textarea
                  value={formData.description_short}
                  onChange={(e) =>
                    setFormData({ ...formData, description_short: e.target.value })
                  }
                  rows={2}
                  className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm resize-none"
                  placeholder="Brief product description"
                />
              </div>

              {/* Full Description */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Full Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm resize-none"
                  placeholder="Detailed product description"
                />
              </div>

              {/* Benefits */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Benefits</label>
                <textarea
                  value={formData.benefits}
                  onChange={(e) => setFormData({ ...formData, benefits: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm resize-none"
                  placeholder="Product benefits"
                />
              </div>

              {/* Mechanism */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Mechanism</label>
                <textarea
                  value={formData.mechanism}
                  onChange={(e) => setFormData({ ...formData, mechanism: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-vital/40 focus:border-transparent text-ink text-sm resize-none"
                  placeholder="How it works"
                />
              </div>

              {/* Featured & Active Toggles — admin-only (visibility/merchandising).
                  Hidden for analytics editors; the API also drops these fields. */}
              {canEdit && (
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.featured}
                    onChange={(e) =>
                      setFormData({ ...formData, featured: e.target.checked })
                    }
                    className="w-4 h-4 text-vital bg-surface border-line rounded focus:ring-vital/40"
                  />
                  <span className="text-sm font-medium text-ink">Featured Product</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="w-4 h-4 text-vital bg-surface border-line rounded focus:ring-vital/40"
                  />
                  <span className="text-sm font-medium text-ink">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title="Offer this product as an upsell add-on in the cart and checkout (e.g. bacteriostatic water).">
                  <input
                    type="checkbox"
                    checked={formData.is_checkout_addon}
                    onChange={(e) => setFormData({ ...formData, is_checkout_addon: e.target.checked })}
                    className="w-4 h-4 text-vital bg-surface border-line rounded focus:ring-vital/40"
                  />
                  <span className="text-sm font-medium text-ink">Checkout add-on</span>
                </label>
              </div>
              )}
              </div>
              {/* ---- end Details tab ---- */}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-6 mt-6 border-t border-line">
              <button
                onClick={() => setShowModal(false)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOrUpdate}
                disabled={saving || uploading}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {editingProduct ? 'Updating…' : 'Creating…'}
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {editingProduct ? 'Update Product' : 'Create Product'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deletingProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-ink">Delete Product</h2>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-ink-muted mb-6">
              Are you sure you want to delete <strong>{deletingProduct.name}</strong>? This
              action cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Product
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restock Notification Confirmation Modal */}
      {restockConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl max-w-md w-full overflow-hidden">
            <div className="flex items-start justify-between p-6 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-vital/10 rounded-lg flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5 text-vital" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-ink leading-tight">Notify waitlist?</h2>
                  <p className="text-xs text-ink-muted mt-0.5 line-clamp-1">{restockConfirm.productName}</p>
                </div>
              </div>
              <button
                onClick={() => !restockSaving && setRestockConfirm(null)}
                className="text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-ink-muted mb-4">
                Restocking this product will email{' '}
                <strong className="text-ink">{restockConfirm.emails.length}</strong>{' '}
                {restockConfirm.emails.length === 1 ? 'person' : 'people'} who asked to be notified:
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-line divide-y divide-line/60 mb-6">
                {restockConfirm.emails.map((em, i) => (
                  <div key={`${em}-${i}`} className="px-3 py-2 text-sm text-ink break-all">
                    {em}
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setRestockConfirm(null)}
                  disabled={restockSaving}
                  className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRestock}
                  disabled={restockSaving}
                  className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {restockSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      Confirm & notify
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price & Stock History Modal */}
      {historyProduct && (() => {
        // Entries come newest-first. Build the active tab's slice and compute,
        // for each entry, how long that value was held — the gap to the next
        // (older) entry, or "current" for the most recent one.
        const tabEntries = historyEntries.filter((e) => e.field === historyTab);
        const now = Date.now();
        // price and vial_price are money; stock is a plain count.
        const isMoney = historyTab !== 'stock_quantity';
        const fmt = (v: number) => (isMoney ? `$${v.toFixed(2)}` : `${v}`);
        const currentValue =
          historyTab === 'price'
            ? historyProduct.price
            : historyTab === 'price_usd'
            ? productUsdPrice(historyProduct, usdRate)
            : historyTab === 'vial_price'
            ? historyProduct.vial_price ?? historyProduct.price / 10
            : historyProduct.stock_quantity;
        const currentLabel =
          historyTab === 'price'
            ? 'price'
            : historyTab === 'price_usd'
            ? 'USD price'
            : historyTab === 'vial_price'
            ? 'vial price'
            : 'stock';
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[55] p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-start justify-between p-5 sm:p-6 border-b border-line">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-vital/10 rounded-lg flex items-center justify-center shrink-0">
                    <History className="w-5 h-5 text-vital" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-ink leading-tight">Change History</h2>
                    <p className="text-xs text-ink-muted mt-0.5 truncate">{historyProduct.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setHistoryProduct(null)}
                  className="text-ink-muted hover:text-ink transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 px-5 sm:px-6 pt-4 border-b border-line">
                {([
                  { key: 'price' as const, label: 'Price (CAD)', icon: DollarSign },
                  { key: 'price_usd' as const, label: 'Price (USD)', icon: DollarSign },
                  { key: 'vial_price' as const, label: 'Vial price', icon: Beaker },
                  { key: 'stock_quantity' as const, label: 'Stock', icon: Package },
                ]).map((t) => {
                  const Icon = t.icon;
                  const active = historyTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setHistoryTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        active
                          ? 'border-vital text-vital'
                          : 'border-transparent text-ink-muted hover:text-ink'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Body */}
              <div className="p-5 sm:p-6 overflow-y-auto">
                {/* Current value summary */}
                <div className="mb-5 flex items-center gap-2 text-sm">
                  <span className="text-ink-muted">Current {currentLabel}:</span>
                  <span className="font-semibold text-ink tabular-nums">{fmt(currentValue)}</span>
                  {historyTab === 'vial_price' && historyProduct.vial_price == null && (
                    <span className="text-[10px] text-ink-muted">(auto: price ÷ 10)</span>
                  )}
                  {historyTab === 'price_usd' && historyProduct.price_usd == null && (
                    <span className="text-[10px] text-ink-muted">(auto: price × rate)</span>
                  )}
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center py-12 text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading history…
                  </div>
                ) : tabEntries.length === 0 ? (
                  <p className="text-sm text-ink-muted text-center py-12">
                    No {currentLabel} changes recorded yet.
                  </p>
                ) : (
                  <ol className="relative border-l border-line ml-2">
                    {tabEntries.map((entry, i) => {
                      const setAt = new Date(entry.created_at).getTime();
                      // Duration held = until the next (older entries are later
                      // in the array, newer earlier). The newest entry (i===0)
                      // is the value still in effect.
                      const heldUntil = i === 0 ? now : new Date(tabEntries[i - 1].created_at).getTime();
                      const isCurrent = i === 0;
                      return (
                        <li key={entry.id} className="ml-5 mb-6 last:mb-0">
                          <span
                            className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-white ${
                              isCurrent ? 'bg-vital' : 'bg-line'
                            }`}
                          />
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-base font-semibold text-ink tabular-nums">
                              {fmt(entry.new_value)}
                            </span>
                            {entry.old_value !== null && (
                              <span className="text-xs text-ink-muted line-through tabular-nums">
                                {fmt(entry.old_value)}
                              </span>
                            )}
                            {isCurrent && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-vital/10 text-vital uppercase tracking-wide">
                                Current
                              </span>
                            )}
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-ink-muted border border-line">
                              {CHANGE_SOURCE_LABEL[entry.change_source]}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                            <span title={new Date(entry.created_at).toLocaleString()}>
                              {new Date(entry.created_at).toLocaleString()}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              held {formatDuration(heldUntil - setAt)}
                              {isCurrent && ' (so far)'}
                            </span>
                            <span>by {entry.changed_by_name}</span>
                          </div>
                          {canEdit && !isCurrent && entry.new_value !== currentValue && (
                            <button
                              onClick={() => revertChange(entry)}
                              disabled={revertingId !== null}
                              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line text-xs font-medium text-ink-muted hover:text-vital hover:border-vital/50 transition-colors disabled:opacity-50"
                              title={`Set ${currentLabel} back to ${fmt(entry.new_value)}`}
                            >
                              {revertingId === entry.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              Revert to this
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* CSV Import Modal — Step 1: File Upload */}
      {showImportModal && importStep === 'upload' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-ink">Import Products from CSV</h2>
              <button onClick={closeImportModal} className="text-ink-muted hover:text-ink transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{formError}</p>
              </div>
            )}

            <div className="mb-5">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="hidden"
                id="csv-import-upload"
              />
              <label
                htmlFor="csv-import-upload"
                className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
              >
                {importFile ? (
                  <>
                    <FileUp className="w-8 h-8 text-vital mb-2" />
                    <p className="text-sm font-medium text-ink">{importFile.name}</p>
                    <p className="text-xs text-ink-muted mt-1">
                      {(importFile.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-ink-muted mb-2" />
                    <p className="text-sm text-ink-muted">Click to upload CSV (max 5 MB)</p>
                    <p className="text-xs text-ink-muted mt-1">
                      Required columns: Code, Product Name, MG, Wholesale Price, CAD Price
                    </p>
                  </>
                )}
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeImportModal}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleImportUpload}
                disabled={!importFile || importLoading}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" />
                    Analyze CSV
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal — Step 2: Preview & Confirm */}
      {showImportModal && importStep === 'preview' && importPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-3xl w-full p-4 sm:p-6 my-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-ink">Confirm Import</h2>
              <button onClick={closeImportModal} className="text-ink-muted hover:text-ink transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary badges */}
            <div className="flex flex-wrap gap-3 mb-5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 text-sm font-medium">
                <Plus className="w-3.5 h-3.5" />
                {importPreview.newProducts.length} New
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vital/10 text-vital text-sm font-medium">
                <Edit2 className="w-3.5 h-3.5" />
                {importPreview.updateProducts.length} Updates
              </span>
              {importPreview.skippedRows > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 text-sm font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {importPreview.skippedRows} Skipped (no Code)
                </span>
              )}
            </div>

            {/* Preview table */}
            <div className="border border-line rounded-xl overflow-hidden mb-6">
              <div className="max-h-80 overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-surface border-b border-line">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        Slug
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        Strength
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {[
                      ...importPreview.newProducts.map((p) => ({ ...p, _status: 'new' as const })),
                      ...importPreview.updateProducts.map((p) => ({ ...p, _status: 'update' as const })),
                    ].map((row) => (
                      <tr key={row.slug} className="hover:bg-surface transition-colors">
                        <td className="px-4 py-2.5">
                          {row._status === 'new' ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-700">
                              New
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-vital/10 text-vital">
                              Update
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-ink-muted font-mono">{row.slug}</td>
                        <td className="px-4 py-2.5 text-ink font-medium">{row.name}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{row.strength || '—'}</td>
                        <td className="px-4 py-2.5 text-ink tabular-nums">${row.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{formError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setImportStep('upload'); setFormError(''); }}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                Back
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={importConfirming}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importConfirming ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Confirm Import
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Report email schedule modal (admin only) */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 my-8">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <Mail className="w-5 h-5 text-vital" /> Stock Report Email
              </h2>
              <button
                onClick={() => !scheduleSaving && !scheduleSending && setShowScheduleModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              Automatically email the Stock Report (no pricing) on a schedule.
            </p>

            {scheduleLoading ? (
              <div className="py-10 flex items-center justify-center text-ink-muted">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Enable toggle */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">Enable scheduled email</span>
                    <span className="block text-xs text-ink-muted">
                      When off, the report is never sent automatically (you can still use “Send now”).
                    </span>
                  </span>
                </label>

                {/* Recipients */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Recipients</label>
                  <input
                    type="text"
                    value={schedule.recipients}
                    onChange={(e) => setSchedule({ ...schedule, recipients: e.target.value })}
                    placeholder="warehouse@aminocan.com, buyer@aminocan.com"
                    className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                  <p className="mt-1 text-xs text-ink-muted">Separate multiple addresses with commas.</p>
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Frequency</label>
                  <div className="inline-flex rounded-lg border border-line bg-surface p-1">
                    {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setSchedule({ ...schedule, frequency: f })}
                        className={`px-3.5 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                          schedule.frequency === f ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Sent around 8am (server time) on the chosen cadence.
                    {schedule.lastSentAt && (
                      <> Last sent {new Date(schedule.lastSentAt).toLocaleString()}.</>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-2">
                  <button
                    onClick={sendScheduleNow}
                    disabled={scheduleSending || scheduleSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors disabled:opacity-50"
                  >
                    {scheduleSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {scheduleSending ? 'Sending…' : 'Send now'}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowScheduleModal(false)}
                      disabled={scheduleSaving || scheduleSending}
                      className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveSchedule}
                      disabled={scheduleSaving || scheduleSending}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50"
                    >
                      {scheduleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {scheduleSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customize Products Report modal — pick summary cards & table columns */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 my-8">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-vital" /> Customize Report
              </h2>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              Choose the pricing source, the sections to include, and how stock is
              shown. Every choice is remembered for next time.
            </p>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
              {/* Pricing source — where the report's price figures come from */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Pricing source</h3>
                <p className="text-xs text-ink-muted mb-2">
                  Price the report from a general price list, a specific customer&apos;s
                  dedicated prices, or an affiliate&apos;s price list. Any product a list
                  doesn&apos;t set keeps its catalog price.
                </p>

                {/* General ↔ Customer ↔ Affiliate toggle — general is the default */}
                <div className="inline-flex w-full rounded-lg border border-line bg-surface p-1 mb-3">
                  {([
                    { value: 'general' as ReportPriceMode, label: 'General', icon: Tag },
                    { value: 'customer' as ReportPriceMode, label: 'Customer', icon: Users },
                    { value: 'affiliate' as ReportPriceMode, label: 'Affiliate', icon: Handshake },
                  ]).map(({ value, label, icon: Icon }) => {
                    const active = reportPriceMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setReportPriceMode(value)}
                        className={`inline-flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    );
                  })}
                </div>

                {pricingSourcesLoading ? (
                  <div className="py-6 text-center text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading price lists…
                    </span>
                  </div>
                ) : reportPriceMode === 'general' ? (
                  <div className="grid grid-cols-1 gap-2">
                    {/* Catalog default — each product's own price */}
                    <button
                      type="button"
                      onClick={() => setReportPricelistId('')}
                      className={`flex items-start justify-between gap-2.5 p-3 rounded-lg border text-left transition-colors ${
                        reportPricelistId === '' ? 'border-vital bg-vital-50' : 'border-line hover:bg-surface'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">Default catalog prices</span>
                        <span className="block text-xs text-ink-muted">Each product&apos;s own price</span>
                      </span>
                      {reportPricelistId === '' && <Check className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />}
                    </button>
                    {reportPricelists.map((pl) => {
                      const selected = reportPricelistId === pl.id;
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => setReportPricelistId(pl.id)}
                          className={`flex items-start justify-between gap-2.5 p-3 rounded-lg border text-left transition-colors ${
                            selected ? 'border-vital bg-vital-50' : 'border-line hover:bg-surface'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-ink truncate">{pl.name}</span>
                              {pl.is_active && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
                                  Active
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-ink-muted truncate">
                              {pl.item_count} product{pl.item_count === 1 ? '' : 's'}
                              {pl.description ? ` · ${pl.description}` : ''}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface border border-line text-ink-muted">
                              {pl.currency === 'USD' ? 'USD' : 'CAD'}
                            </span>
                            {selected && <Check className="w-4 h-4 text-vital" />}
                          </span>
                        </button>
                      );
                    })}
                    {reportPricelists.length === 0 && (
                      <p className="text-xs text-ink-muted px-1">
                        No saved price lists yet — the report uses catalog prices.
                      </p>
                    )}
                  </div>
                ) : reportPriceMode === 'customer' ? (
                  <div>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
                      <input
                        type="text"
                        value={pricingCustomerSearch}
                        onChange={(e) => setPricingCustomerSearch(e.target.value)}
                        placeholder="Search customers…"
                        className="w-full pl-9 pr-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto grid grid-cols-1 gap-2 pr-1">
                      {filteredPricingCustomers.map((c) => {
                        const selected = reportCustomerId === c.id;
                        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setReportCustomerId(c.id)}
                            className={`flex items-start justify-between gap-2.5 p-3 rounded-lg border text-left transition-colors ${
                              selected ? 'border-vital bg-vital-50' : 'border-line hover:bg-surface'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink truncate">{name}</span>
                              <span className="block text-xs text-ink-muted truncate">
                                {c.applied_pricelist ? `Price list: ${c.applied_pricelist.name}` : c.email}
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface border border-line text-ink-muted">
                                {c.price_currency === 'USD' ? 'USD' : 'CAD'}
                              </span>
                              {selected && <Check className="w-4 h-4 text-vital" />}
                            </span>
                          </button>
                        );
                      })}
                      {filteredPricingCustomers.length === 0 && (
                        <p className="text-xs text-ink-muted px-1 py-2">
                          {reportCustomers.length === 0 ? 'No customers found.' : 'No customers match your search.'}
                        </p>
                      )}
                    </div>
                    {!reportCustomerId && (
                      <p className="mt-2 text-xs text-amber-600">
                        Select a customer to price the report from their dedicated list.
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
                      <input
                        type="text"
                        value={pricingAffiliateSearch}
                        onChange={(e) => setPricingAffiliateSearch(e.target.value)}
                        placeholder="Search affiliates…"
                        className="w-full pl-9 pr-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto grid grid-cols-1 gap-2 pr-1">
                      {filteredPricingAffiliates.map((a) => {
                        const selected = reportAffiliateId === a.id;
                        const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => setReportAffiliateId(a.id)}
                            className={`flex items-start justify-between gap-2.5 p-3 rounded-lg border text-left transition-colors ${
                              selected ? 'border-vital bg-vital-50' : 'border-line hover:bg-surface'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink truncate">{name}</span>
                              <span className="block text-xs text-ink-muted truncate">
                                {a.override_count
                                  ? `${a.override_count} custom price${a.override_count === 1 ? '' : 's'}`
                                  : a.email}
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface border border-line text-ink-muted">
                                {a.price_currency === 'USD' ? 'USD' : 'CAD'}
                              </span>
                              {selected && <Check className="w-4 h-4 text-vital" />}
                            </span>
                          </button>
                        );
                      })}
                      {filteredPricingAffiliates.length === 0 && (
                        <p className="text-xs text-ink-muted px-1 py-2">
                          {reportAffiliates.length === 0 ? 'No affiliates found.' : 'No affiliates match your search.'}
                        </p>
                      )}
                    </div>
                    {!reportAffiliateId && (
                      <p className="mt-2 text-xs text-amber-600">
                        Select an affiliate to price the report from their price list.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Report sections — grouped card + column toggles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">Report sections</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setReportGroups(allGroupsSelected(true))}
                      className="text-vital hover:underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportGroups(allGroupsSelected(false))}
                      className="text-ink-muted hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {REPORT_GROUPS.map((g) => (
                    <label
                      key={g.key}
                      className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={reportGroups[g.key]}
                        onChange={(e) =>
                          setReportGroups((prev) => ({ ...prev, [g.key]: e.target.checked }))
                        }
                        className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{g.label}</span>
                        <span className="block text-xs text-ink-muted">{g.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {selectedColumnCount === 0 && (
                  <p className="mt-2 text-xs text-red-600">
                    Select at least one section to download.
                  </p>
                )}
              </div>

              {/* Stock status — limit the report to low / out-of-stock items */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Stock status</h3>
                <p className="text-xs text-ink-muted mb-2">
                  Limit the report to items that are running low or sold out.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {REPORT_STOCK_STATUS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        reportStockStatus === opt.value
                          ? 'border-vital bg-vital-50'
                          : 'border-line hover:bg-surface'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reportStockStatus"
                        checked={reportStockStatus === opt.value}
                        onChange={() => setReportStockStatus(opt.value)}
                        className="mt-0.5 w-4 h-4 border-line text-vital focus:ring-vital/40"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{opt.label}</span>
                        <span className="block text-xs text-ink-muted">{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Stock display — boxes vs vials, applies to all products reports */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">Stock display</h3>
                <p className="text-xs text-ink-muted mb-2">
                  Applies to every report on this page (Products, Stock, Stock Changes).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'boxes' as StockUnit, label: 'Boxes', desc: 'Grouped into boxes' },
                    { value: 'vials' as StockUnit, label: 'Vials', desc: 'Individual vials' },
                  ]).map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        stockUnit === opt.value
                          ? 'border-vital bg-vital-50'
                          : 'border-line hover:bg-surface'
                      }`}
                    >
                      <input
                        type="radio"
                        name="stockUnit"
                        checked={stockUnit === opt.value}
                        onChange={() => setStockUnit(opt.value)}
                        className="mt-0.5 w-4 h-4 border-line text-vital focus:ring-vital/40"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{opt.label}</span>
                        <span className="block text-xs text-ink-muted">{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <label
                  className={`flex items-center gap-2 mt-2 p-2.5 rounded-lg border border-line transition-colors ${
                    stockUnit === 'boxes'
                      ? 'hover:bg-surface cursor-pointer'
                      : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={showRemainder}
                    disabled={stockUnit !== 'boxes'}
                    onChange={(e) => setShowRemainder(e.target.checked)}
                    className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                  />
                  <span className="text-sm text-ink">
                    Show leftover vials in parentheses
                    <span className="text-ink-muted"> (e.g. 24 boxes (3 vials))</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-6 mt-6 border-t border-line">
              <button
                type="button"
                onClick={resetReportConfig}
                className="text-sm text-ink-muted hover:text-ink transition-colors"
              >
                Reset to defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowReportModal(false);
                    downloadReport();
                  }}
                  disabled={downloading || !canDownloadReport}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  Download Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customize Stock Report modal — toggle the cards & on-order note */}
      {showStockReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-md w-full p-6 my-8">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <Package className="w-5 h-5 text-vital" /> Customize Stock Report
              </h2>
              <button
                onClick={() => setShowStockReportModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              Choose what appears on the downloaded Stock Report. Your choices
              are remembered for next time.
            </p>

            {/* Stock display — count in boxes or vials (shared across reports) */}
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-ink mb-1">Stock display</h3>
              <p className="text-xs text-ink-muted mb-2">
                Count stock in boxes or individual vials. Applies to every report
                on this page.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'boxes' as StockUnit, label: 'Boxes', desc: 'Grouped into boxes' },
                  { value: 'vials' as StockUnit, label: 'Vials', desc: 'Individual vials' },
                ]).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      stockUnit === opt.value
                        ? 'border-vital bg-vital-50'
                        : 'border-line hover:bg-surface'
                    }`}
                  >
                    <input
                      type="radio"
                      name="stockReportUnit"
                      checked={stockUnit === opt.value}
                      onChange={() => setStockUnit(opt.value)}
                      className="mt-0.5 w-4 h-4 border-line text-vital focus:ring-vital/40"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{opt.label}</span>
                      <span className="block text-xs text-ink-muted">{opt.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label
                className={`flex items-center gap-2 mt-2 p-2.5 rounded-lg border border-line transition-colors ${
                  stockUnit === 'boxes'
                    ? 'hover:bg-surface cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  checked={showRemainder}
                  disabled={stockUnit !== 'boxes'}
                  onChange={(e) => setShowRemainder(e.target.checked)}
                  className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                />
                <span className="text-sm text-ink">
                  Show leftover vials in parentheses
                  <span className="text-ink-muted"> (e.g. 24 boxes (3 vials))</span>
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={stockShowCards}
                  onChange={(e) => setStockShowCards(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Summary cards</span>
                  <span className="block text-xs text-ink-muted">
                    Products, Stock On Hand, On Order & Need To Order totals
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={stockShowOnOrder}
                  onChange={(e) => setStockShowOnOrder(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">"On Order" explanation footer</span>
                  <span className="block text-xs text-ink-muted">
                    How On Order is calculated + contributing purchase orders
                  </span>
                </span>
              </label>
            </div>

            {/* Column selection — which table columns appear in the report. */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Columns</span>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setStockColumns(allStockColumnsSelected(true))}
                    className="text-vital hover:underline"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockColumns(allStockColumnsSelected(false))}
                    className="text-ink-muted hover:text-ink hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {STOCK_REPORT_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-start gap-2 p-2.5 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={stockColumns[col.key]}
                      onChange={(e) =>
                        setStockColumns((prev) => ({ ...prev, [col.key]: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{col.label}</span>
                      <span className="block text-xs text-ink-muted">{col.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              {STOCK_REPORT_COLUMNS.every((c) => !stockColumns[c.key]) && (
                <p className="mt-2 text-xs text-amber-600">
                  No columns selected — the report will include all columns.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-6 mt-6 border-t border-line">
              <button
                type="button"
                onClick={() => {
                  setStockUnit('boxes');
                  setShowRemainder(true);
                  setStockShowCards(true);
                  setStockShowOnOrder(true);
                  setStockColumns(allStockColumnsSelected(true));
                }}
                className="text-sm text-ink-muted hover:text-ink transition-colors"
              >
                Reset to defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowStockReportModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowStockReportModal(false);
                    downloadStockReport();
                  }}
                  disabled={downloadingStock}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Package className="w-4 h-4" />
                  Download Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Change Report modal — pick a date range (default: this week) */}
      {showChangeReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-md w-full p-6 my-8">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-vital" /> Stock Change Report
              </h2>
              <button
                onClick={() => setShowChangeReportModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              How stock moved over a date range — opening, sold, received, adjustments,
              and closing per product. Defaults to this week.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">From</label>
                <input
                  type="date"
                  value={changeRange.from}
                  max={changeRange.to}
                  onChange={(e) => setChangeRange((r) => ({ ...r, from: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">To</label>
                <input
                  type="date"
                  value={changeRange.to}
                  min={changeRange.from}
                  onChange={(e) => setChangeRange((r) => ({ ...r, to: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>
            </div>

            {/* Quick range presets */}
            <div className="flex flex-wrap gap-2 mt-3">
              {([
                { label: 'This week', range: () => currentWeekRange() },
                {
                  label: 'Last 7 days',
                  range: () => {
                    const to = new Date();
                    const from = new Date();
                    from.setDate(to.getDate() - 6);
                    return { from: toDateInput(from), to: toDateInput(to) };
                  },
                },
                {
                  label: 'Last 30 days',
                  range: () => {
                    const to = new Date();
                    const from = new Date();
                    from.setDate(to.getDate() - 29);
                    return { from: toDateInput(from), to: toDateInput(to) };
                  },
                },
                {
                  label: 'This month',
                  range: () => {
                    const now = new Date();
                    const from = new Date(now.getFullYear(), now.getMonth(), 1);
                    return { from: toDateInput(from), to: toDateInput(now) };
                  },
                },
              ] as const).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setChangeRange(preset.range())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-6 mt-6 border-t border-line">
              <button
                onClick={() => setShowChangeReportModal(false)}
                className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowChangeReportModal(false);
                  downloadChangeReport();
                }}
                disabled={downloadingChanges || !changeRange.from || !changeRange.to}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileText className="w-4 h-4" />
                Download Report
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ProductsManagementPageWrapper() {
  // ProductsManagementPage reads the URL via useSearchParams, which Next
  // requires to sit inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ProductsManagementPage />
    </Suspense>
  );
}
