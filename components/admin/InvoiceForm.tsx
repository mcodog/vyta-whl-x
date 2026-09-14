'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, UserPlus, Briefcase, Search, Plus, Save, X, AlertCircle, Loader2, Trash2, Check, Pencil, Truck, Store, Tag, Package, Info, Printer, Users, FileText, Layers, DollarSign, ChevronDown, Lock,
} from 'lucide-react';
import {
  supabase,
  type Customer,
  type CustomerClient,
  type Invoice,
  type InvoiceCurrency,
  type InvoiceLineItem,
  type InvoiceStatus,
  type Pricelist,
  type Product,
  type SalesPerson,
} from '@/lib/supabase';
import { createInvoice, replaceInvoice } from '@/lib/admin/invoices';
import {
  getCustomerClients,
  updateCustomerClient,
  deleteCustomerClient,
  getCustomerClientUsage,
  ClientInUseError,
  type ClientUsage,
} from '@/lib/admin/customer-clients';
import { searchSalesPersons, createSalesPerson } from '@/lib/admin/sales-persons';
import { MAX_SALES_PEOPLE } from '@/lib/admin/sales-attribution';
import {
  createCustomer,
  updateCustomer,
  getInvoiceShippingReadiness,
  type InvoiceShippingReadiness,
} from '@/lib/admin/api';
import {
  getActivePricelist,
  getPricelists,
  getPricelistPrices,
  getCustomerPriceOverrides,
  DEFAULT_PRICELIST_ID,
  EMPTY_PRICELIST,
  type ActivePricelist,
  type CustomerOverride,
} from '@/lib/admin/pricelists';
import { usdFromCad, cadFromUsd, round2, DEFAULT_USD_RATE } from '@/lib/pricing';
import { rankNameMatches } from '@/lib/admin/searchRank';
import { formatStockInUnit, qtyToVials } from '@/lib/admin/stock-units';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { useToast } from '@/contexts/ToastContext';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import NumberInput from '@/components/admin/NumberInput';
import Tooltip, { InfoHint } from '@/components/Tooltip';
import PrepaidLineSuppliers from '@/components/admin/PrepaidLineSuppliers';

interface DraftLine {
  product_id: string | null;
  description: string;
  qty: number | null;
  unit_price: number | null;
  discount_pct: number | null;
  /** Which catalog price the unit price came from. Defaults to box (pack of 10). */
  price_type: 'box' | 'vial';
  stock_quantity?: number; // from picked product, for stock badge
  /** Prepaid invoices: supplier chosen to procure this line (null = cheapest). */
  preferred_supplier_id?: string | null;
  /**
   * True once the admin/affiliate sets this line's discount by hand. While
   * false, the line adopts the sales person's box/vial discount preset; once
   * touched, presets never overwrite it.
   */
  discount_touched?: boolean;
}

interface Props {
  mode: 'create' | 'edit';
  invoiceId?: string;
  initial?: Invoice;
  /** Render as a prepaid procurement invoice (sets invoice_type = 'prepaid').
   *  On edit this is inferred from the invoice itself. */
  prepaid?: boolean;
}

const NEW_LINE = (): DraftLine => ({
  product_id: null,
  description: '',
  qty: null,
  unit_price: null,
  discount_pct: null,
  price_type: 'box',
});

// One-click discount presets shown next to each line's Disc % field and in the
// "Discount all" bulk control.
const QUICK_DISCOUNTS = [25, 50, 75] as const;

// ---------------------------------------------------------------------------
// Sales team
// ---------------------------------------------------------------------------

/**
 * One seat on the invoice's sales team. `key` is a stable React identity (and
 * the handle the shared search box binds to) so removing a seat never makes an
 * open dropdown jump to its neighbour. An empty seat — `person: null` — is the
 * row currently being searched.
 */
interface SalesSeat {
  key: string;
  person: SalesPerson | null;
  /** Percent this person earns on this invoice. null = not filled in yet. */
  rate: number | null;
}

let seatSeq = 0;
const newSeat = (person: SalesPerson | null = null, rate: number | null = null): SalesSeat => ({
  key: `seat-${++seatSeq}`,
  person,
  rate,
});

/**
 * The team an existing invoice opens with: its stored roster, or — for an
 * invoice raised before rosters existed — its single sales person promoted to a
 * one-seat team. A brand-new invoice starts with one empty seat to type into.
 */
function initialSalesTeam(initial?: Invoice): SalesSeat[] {
  const roster = [...(initial?.sales_people ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  if (roster.length > 0) {
    return roster.map((m) =>
      newSeat(
        // The invoice detail API embeds the whole sales_persons row per seat, so
        // the line-discount presets survive an edit. A payload without it still
        // works — only the id is strictly needed to save the invoice back.
        (m.sales_person ?? { id: m.sales_person_id }) as SalesPerson,
        Number(m.commission_rate) || 0,
      ),
    );
  }
  if (initial?.sales_person) {
    return [
      newSeat(
        initial.sales_person,
        initial.sales_person_commission_rate != null
          ? Number(initial.sales_person_commission_rate)
          : null,
      ),
    ];
  }
  return [newSeat()];
}

export default function InvoiceForm({ mode, invoiceId, initial, prepaid }: Props) {
  const router = useRouter();
  const role = useUserRole();
  const toast = useToast();
  const isAffiliate = role === 'affiliate';
  // A prepaid invoice is a client-prepaid procurement order (drives the Supplier
  // Purchase Orders panel on the invoice page). On edit, honour the saved type.
  const isPrepaid = prepaid ?? initial?.invoice_type === 'prepaid';
  // Affiliates: their customer list is fixed (bound to them) and they are locked
  // in as the sales person on invoices they create.
  const [boundCustomers, setBoundCustomers] = useState<Customer[]>([]);
  const [salesLocked, setSalesLocked] = useState(false);

  // ---- customer state ------------------------------------------------------
  const [customer, setCustomer] = useState<Customer | null>(initial?.customer ?? null);
  const [customerQuery, setCustomerQuery] = useState(initial?.customer_name ?? '');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    shipping_address: '', shipping_city: '', shipping_state: '',
    shipping_postal_code: '', shipping_country: 'CA',
  });
  // Whether the new-customer modal was opened to collect the optional
  // phone + address for a name that looks like a brand-new account (vs the
  // generic "create customer" entry point). Drives the modal's helper copy.
  const [newCustomerIsNewAccount, setNewCustomerIsNewAccount] = useState(false);

  // ---- sales team state ----------------------------------------------------
  // An invoice can credit up to MAX_SALES_PEOPLE people, each on their own
  // commission percentage. Seat 0 is the primary — it is what lands in the
  // invoice's legacy sales_person_id column. Rates are independent, NOT slices
  // of one pot: everyone earns `total x their own rate`.
  const [salesTeam, setSalesTeam] = useState<SalesSeat[]>(() => initialSalesTeam(initial));
  /** Which empty seat currently owns the search box (seats are keyed, not indexed). */
  const [spSeatKey, setSpSeatKey] = useState<string | null>(null);
  const [spQuery, setSpQuery] = useState('');
  const [spResults, setSpResults] = useState<SalesPerson[]>([]);
  const [spOpen, setSpOpen] = useState(false);
  const spBoxRef = useRef<HTMLDivElement>(null);
  const [showSpModal, setShowSpModal] = useState(false);
  const [newSp, setNewSp] = useState({
    first_name: '', last_name: '', email: '', phone: '', commission_rate: 5,
  });
  // The primary drives everything that can only have one answer: the per-line
  // discount presets and the customer's saved default.
  const salesPerson = salesTeam[0]?.person ?? null;
  // When on, saving the invoice remembers the whole sales team on the linked
  // customer so their next invoice auto-fills it. Defaults on; only meaningful
  // when a customer and at least one sales person are set (and not affiliate-locked).
  const [saveSalesPersonToCustomer, setSaveSalesPersonToCustomer] = useState(true);

  // ---- dates / extras ------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  const [issueDate, setIssueDate] = useState(initial?.issue_date ?? today);
  const [dueDate, setDueDate] = useState(initial?.due_date ?? defaultDue.toISOString().slice(0, 10));
  const [taxRate, setTaxRate] = useState<number | null>(
    initial?.tax_rate != null ? Number(initial.tax_rate) : null,
  );
  const [shipping, setShipping] = useState<number | null>(
    initial?.shipping_cost != null ? Number(initial.shipping_cost) : null,
  );
  // Whether this invoice's hosted-checkout payment link charges the shipping
  // fee. Off by default — shipping is usually settled outside the link (already
  // collected, waived, billed elsewhere), so adding it to the checkout charged
  // the customer for it twice. Off sends `shipping_total_cents: 0`.
  const [chargeShippingOnCheckout, setChargeShippingOnCheckout] = useState<boolean>(
    initial?.charge_shipping_on_checkout === true,
  );
  // Flat processing fee, typically charged on self-pickup invoices. The toggle
  // controls whether it's applied to the total and shown on the invoice PDF.
  const [processingFee, setProcessingFee] = useState<number | null>(
    initial?.processing_fee != null ? Number(initial.processing_fee) : null,
  );
  const [showProcessingFee, setShowProcessingFee] = useState<boolean>(
    initial?.show_processing_fee ?? true,
  );
  // Once the admin edits the shipping field by hand we stop auto-filling it from
  // the chosen Easyship rate. Edits start "overridden" so we never clobber a
  // saved value.
  const [shippingOverridden, setShippingOverridden] = useState(mode === 'edit');
  const [fulfillmentType, setFulfillmentType] =
    useState<'shipment' | 'pickup'>(initial?.fulfillment_type ?? 'shipment');
  // Currency the invoice is paid in, and whether the order ships with labels.
  // New invoices default to USD (the business quotes from the USD price list);
  // edits keep the invoice's saved currency.
  const [currency, setCurrency] = useState<InvoiceCurrency>(
    initial?.currency ?? (mode === 'create' ? 'USD' : 'CAD'),
  );
  const [withLabels, setWithLabels] = useState<boolean>(initial?.with_labels ?? true);
  // Shipping destination for the order this invoice creates (shipment only). On
  // edit we seed it from the linked order's saved address so the Easyship
  // readiness check has a destination to price against.
  const [shipAddr, setShipAddr] = useState(() => {
    const o = mode === 'edit' ? initial?.order?.shipping_address ?? null : null;
    return {
      firstName: o?.firstName ?? '',
      lastName: o?.lastName ?? '',
      address: o?.address ?? '',
      city: o?.city ?? '',
      state: o?.state ?? '',
      postalCode: o?.postalCode ?? '',
      country: o?.country ?? 'CA',
      phone: o?.phone ?? '',
      email: (mode === 'edit' ? initial?.customer_email : '') ?? '',
    };
  });
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');
  // "Save Ship to details back to the linked customer" — offered when the
  // customer record is missing address/phone/email the admin just filled in.
  const [savingShipTo, setSavingShipTo] = useState(false);
  const [shipToSaved, setShipToSaved] = useState(false);
  // When shipping to a client, the customer "Ship to" box collapses (the parcel
  // goes to the client instead). Auto-collapsed when the client scenario turns
  // on; the admin can still expand it to edit the customer's own details.
  const [shipToCollapsed, setShipToCollapsed] = useState(false);

  // ---- client shipment (Packing List flow) ---------------------------------
  // When on, this invoice's items ship to the customer's client. The client
  // receives ONLY a Packing List; the shipment goes to the client's address
  // (addressed under the customer). Requires a linked customer + shipment.
  const [shipsToClient, setShipsToClient] = useState<boolean>(initial?.ships_to_client ?? false);
  const [clientList, setClientList] = useState<CustomerClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientMode, setClientMode] = useState<'select' | 'new'>(
    initial?.client_id ? 'select' : 'new',
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initial?.client_id ?? null);
  // Free-text filter over the customer's saved clients (name/address/contact).
  const [clientSearch, setClientSearch] = useState('');
  const emptyClient = {
    first_name: '', last_name: '', address: '', city: '', state: '',
    postal_code: '', country: 'CA', phone: '', email: '',
  };
  const [newClient, setNewClient] = useState({ ...emptyClient });
  // How to fill a new client's blank email/phone: use the customer's contact,
  // or a default. Set via the prompt; consumed when building the payload. The
  // ref mirrors it so resolveNewClient reads the choice synchronously (state
  // updates are async and the prompt submits immediately after choosing).
  const [clientContactChoice, setClientContactChoice] = useState<'customer' | 'default' | null>(null);
  const clientContactChoiceRef = useRef<'customer' | 'default' | null>(null);
  // A submit action waiting on the "which contact?" prompt.
  const [clientContactPrompt, setClientContactPrompt] = useState<'draft' | 'sent' | null>(null);
  const DEFAULT_CLIENT_EMAIL = 'aminoship@proton.me';
  const DEFAULT_CLIENT_PHONE = '16473029495';
  // Inline edit of a SAVED client (the pencil on each row of the picker). Holds
  // the client being edited plus its draft values; saving PATCHes the client
  // record itself, so the correction sticks for every future invoice.
  const [editClient, setEditClient] = useState<
    { id: string; draft: typeof emptyClient } | null
  >(null);
  const [editClientBusy, setEditClientBusy] = useState(false);
  const [editClientError, setEditClientError] = useState<string | null>(null);
  // Delete a SAVED client (the trash icon on each row of the picker). Holds the
  // client awaiting confirmation, plus the invoices that still ship to them —
  // looked up as the modal opens so a client that can't be removed is flagged
  // before the user commits, not after.
  const [deleteClient, setDeleteClient] = useState<CustomerClient | null>(null);
  const [deleteClientBusy, setDeleteClientBusy] = useState(false);
  const [deleteClientError, setDeleteClientError] = useState<string | null>(null);
  const [deleteClientUsage, setDeleteClientUsage] = useState<ClientUsage | null>(null);
  const [deleteClientUsageLoading, setDeleteClientUsageLoading] = useState(false);

  // ---- line items ----------------------------------------------------------
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.line_items?.length
      ? initial.line_items.map((li) => ({
          product_id: li.product_id,
          description: li.description,
          qty: li.qty,
          unit_price: Number(li.unit_price),
          discount_pct: Number(li.discount_pct),
          price_type: li.price_type === 'vial' ? 'vial' : 'box',
          preferred_supplier_id: li.preferred_supplier_id ?? null,
          // Existing lines carry their saved discount — never re-preset them.
          discount_touched: true,
        }))
      : [NEW_LINE()],
  );

  // ---- product catalog (for per-line autocomplete) -------------------------
  const [products, setProducts] = useState<Product[]>([]);
  const [activeLineIdx, setActiveLineIdx] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState('');

  // ---- pricelist selection (drives default line prices) --------------------
  // The pricelist whose prices currently drive the line items. Seeded with the
  // active pricelist on mount; the admin can switch it (including to the catalog
  // "Default" prices) via the Price list selector, which re-prices every
  // product-bound line. `currency` on it tells us whether its prices are stored
  // in USD (shown 1:1 on a USD invoice) or CAD (converted by the rate).
  const [pricelist, setPricelist] = useState<ActivePricelist>({ ...EMPTY_PRICELIST });
  // Every pricelist (for the selector) + which one is the globally active one, so
  // the form can show "Currently active: …" and offer the full list to pick from.
  const [allPricelists, setAllPricelists] = useState<Pricelist[]>([]);
  const [activePricelistId, setActivePricelistId] = useState<string | null>(null);
  // The pricelist the admin picked to price this invoice from. DEFAULT_PRICELIST_ID
  // means "use the catalog price (products table)". Defaults to the active list.
  const [selectedPricelistId, setSelectedPricelistId] = useState<string>(DEFAULT_PRICELIST_ID);
  // True while a picked list's prices are being fetched (the selector shows a
  // spinner; a toast confirms once it's applied).
  const [pricelistLoading, setPricelistLoading] = useState(false);
  // True on first load until the active pricelist + the full list have resolved,
  // so the selector shows a spinner instead of briefly flashing the default.
  const [pricelistsInitializing, setPricelistsInitializing] = useState(true);
  // When true, the linked customer's own price overrides are ignored for this
  // invoice and lines price straight from the selected pricelist instead. Set
  // from the "different pricing" warning when the admin picks the price list.
  const [ignoreCustomerPrices, setIgnoreCustomerPrices] = useState(false);
  // When the linked customer has a dedicated price list (their own overrides),
  // this governs how products their list DOESN'T cover ("gaps") are priced. On
  // (default): gaps fall back to the price list picked in the selector (then the
  // catalog). Off: gaps skip the selected list and use Website Pricing (catalog)
  // directly. The customer's own prices ALWAYS win either way — this only moves
  // the price for uncovered products. Reset to on whenever the customer changes.
  const [fillGapsFromList, setFillGapsFromList] = useState(true);
  // The selected ("active") customer's price overrides — product_id -> { labeled,
  // unlabeled } box price. These are the prices from the price list applied to
  // that customer (admin/pricing → Customer Pricing) and take precedence over the
  // global active pricelist so line prices reflect what this customer is quoted.
  // The values are in the CUSTOMER's own currency (USD for USD-tagged customers,
  // else CAD) — see customerIsUsd.
  const [customerPrices, setCustomerPrices] = useState<Record<string, CustomerOverride>>({});
  // Affiliate/sales-person mode: an affiliate building an invoice always prices
  // its lines from THEIR OWN customer pricing (not the bill-to client's), and
  // products they're priced $0 for — or whose status is Hidden for their own
  // customer record — never appear in the picker. Loaded once on mount.
  const [affiliateOverrides, setAffiliateOverrides] = useState<Record<string, CustomerOverride>>({});
  const [affiliateHiddenIds, setAffiliateHiddenIds] = useState<Set<string>>(() => new Set());
  const [affiliateIsUsd, setAffiliateIsUsd] = useState(false);
  // How the affiliate's prices are sourced, surfaced (read-only) on their invoice
  // form: 'template' — their prices track a shared price list an admin assigned
  // (name in affiliatePricelistName, null = the standard/house list); 'dedicated'
  // — a bespoke price list set for them. Loaded from /api/affiliate/me.
  const [affiliatePricingMode, setAffiliatePricingMode] = useState<'template' | 'dedicated'>('template');
  const [affiliatePricelistName, setAffiliatePricelistName] = useState<string | null>(null);
  // Loaded flags so the locked controls show a spinner instead of flashing a
  // default (e.g. "Standard pricing", or USD) before the real config resolves.
  const [affiliateCurrencyLoaded, setAffiliateCurrencyLoaded] = useState(false);
  const [affiliatePricingLoaded, setAffiliatePricingLoaded] = useState(false);
  // Whether the active customer's stored prices are native USD. When true, their
  // overrides are the exact USD numbers (e.g. from a USD price list) and must NOT
  // be re-converted for a USD invoice — they show 1:1. For affiliates the pricing
  // source is their own record, so its currency (affiliateIsUsd) governs instead.
  const customerIsUsd = isAffiliate ? affiliateIsUsd : customer?.price_currency === 'USD';
  // CAD→USD multiplier from Site Settings. When the invoice is in USD, catalog
  // prices are converted with this rate so the displayed line prices and totals
  // are in the selected currency.
  const [usdRate, setUsdRate] = useState<number>(DEFAULT_USD_RATE);
  // Resolve a product's box unit price for the given currency + label state.
  // Precedence: customer override → global active pricelist → product default.
  // Label: when `labeled` is false the unlabeled price is used where one exists,
  // otherwise it falls back to the labeled price.
  // Currency: customer overrides are stored in the customer's own currency, so a
  // USD-tagged customer's prices are returned as-is for a USD invoice (and
  // divided by the rate for a CAD invoice); all other (CAD-native) sources are
  // multiplied by the rate for a USD invoice.
  const priceForProduct = (
    p: Product,
    cur: InvoiceCurrency = currency,
    overrides: Record<string, CustomerOverride> = customerPrices,
    labeled: boolean = withLabels,
    pl: ActivePricelist = pricelist,
    fillGaps: boolean = fillGapsFromList,
  ): number => {
    // Customer overrides win — unless the admin chose to ignore them for this
    // invoice (the "different pricing" warning) so the selected list drives it.
    const ov = ignoreCustomerPrices ? undefined : overrides[p.id];
    if (ov != null && ov.labeled != null) {
      const native = !labeled && ov.unlabeled != null ? ov.unlabeled : ov.labeled;
      if (customerIsUsd) {
        // Stored in USD: show as-is for USD, convert down for CAD.
        return cur === 'USD' ? round2(native) : cadFromUsd(native, usdRate);
      }
      // Stored in CAD: convert up for USD.
      return cur === 'USD' ? usdFromCad(native, usdRate) : round2(native);
    }
    // Gap: the product isn't covered by the customer's dedicated list. When the
    // customer HAS a dedicated list but the admin opted out of filling gaps from
    // the selected list, skip it and drop straight to the catalog default below.
    const hasDedicatedList = !ignoreCustomerPrices && Object.keys(overrides).length > 0;
    if (!(hasDedicatedList && !fillGaps)) {
      // Fall back to the selected pricelist. Its prices are stored in pl.currency.
      const listedLabeled = pl.prices[p.id];
      if (listedLabeled != null) {
        const listedUnlabeled = pl.unlabeled[p.id];
        const listed = !labeled && listedUnlabeled != null ? listedUnlabeled : listedLabeled;
        if (pl.currency === 'USD') {
          // USD-native list (e.g. USD Wholesale Pricelist): 1:1 for USD, down for CAD.
          return cur === 'USD' ? round2(listed) : cadFromUsd(listed, usdRate);
        }
        // CAD-native list: up for USD.
        return cur === 'USD' ? usdFromCad(listed, usdRate) : round2(listed);
      }
    }
    // Product default (no labeled/unlabeled split at the catalog level).
    const cad = Number(p.price);
    if (cur === 'USD') {
      if (p.price_usd != null) return Number(p.price_usd);
      return usdFromCad(cad, usdRate);
    }
    return cad;
  };
  // Single-vial price. Precedence mirrors the box path: a customer/affiliate
  // per-vial override (stored in their own currency) wins; otherwise the catalog
  // vial_price, falling back to the box price / 10.
  const vialPriceForProduct = (
    p: Product,
    cur: InvoiceCurrency = currency,
    overrides: Record<string, CustomerOverride> = customerPrices,
  ): number => {
    const ov = ignoreCustomerPrices ? undefined : overrides[p.id];
    if (ov?.vial != null) {
      const native = ov.vial;
      if (customerIsUsd) {
        // Stored in USD: show as-is for USD, convert down for CAD.
        return cur === 'USD' ? round2(native) : cadFromUsd(native, usdRate);
      }
      // Stored in CAD: convert up for USD.
      return cur === 'USD' ? usdFromCad(native, usdRate) : round2(native);
    }
    const cad =
      p.vial_price != null && Number(p.vial_price) > 0
        ? Number(p.vial_price)
        : Number(p.price) / 10;
    return cur === 'USD' ? usdFromCad(cad, usdRate) : round2(cad);
  };
  // Resolve the unit price for a product at a given price type + currency + label.
  const priceForType = (
    p: Product,
    type: 'box' | 'vial',
    cur: InvoiceCurrency = currency,
    overrides: Record<string, CustomerOverride> = customerPrices,
    labeled: boolean = withLabels,
    pl: ActivePricelist = pricelist,
    fillGaps: boolean = fillGapsFromList,
  ): number => (type === 'vial' ? vialPriceForProduct(p, cur, overrides) : priceForProduct(p, cur, overrides, labeled, pl, fillGaps));

  // Switch the invoice currency and re-price every product-bound line to the
  // catalog price in the new currency. Manual (unbound) lines keep their price.
  const changeCurrency = (next: InvoiceCurrency) => {
    if (next === currency) return;
    setCurrency(next);
    setLines((prev) =>
      prev.map((l) => {
        if (!l.product_id) return l;
        const p = products.find((pp) => pp.id === l.product_id);
        return p ? { ...l, unit_price: priceForType(p, l.price_type, next) } : l;
      }),
    );
  };

  // True once the admin flips the labels toggle by hand. Distinguishes a manual
  // choice (which we remember on the customer at save time) from the value we
  // silently adopt from the customer's saved preference.
  const labelsTouchedRef = useRef(false);
  // Toggle "with labels" and re-price every product-bound line between the
  // labeled and unlabeled price. Manual (unbound) lines keep their typed price.
  const changeLabels = (next: boolean) => {
    if (next === withLabels) return;
    labelsTouchedRef.current = true;
    setWithLabels(next);
    setLines((prev) =>
      prev.map((l) => {
        if (!l.product_id) return l;
        const p = products.find((pp) => pp.id === l.product_id);
        return p ? { ...l, unit_price: priceForType(p, l.price_type, currency, customerPrices, next) } : l;
      }),
    );
  };

  // Re-price every product-bound line from a freshly-loaded pricelist (used after
  // the admin picks a different list, or when clearing customer overrides). Pass
  // the list + override map explicitly so we don't race the state updates. `cur`
  // lets the caller reprice into a currency it's switching to in the same beat
  // (the paid-in currency follows the picked price list — see changePricelist).
  const repriceLinesFrom = (
    pl: ActivePricelist,
    overrides: Record<string, CustomerOverride> = customerPrices,
    cur: InvoiceCurrency = currency,
    fillGaps: boolean = fillGapsFromList,
  ) => {
    setLines((prev) =>
      prev.map((l) => {
        if (!l.product_id) return l;
        const p = products.find((pp) => pp.id === l.product_id);
        return p
          ? { ...l, unit_price: priceForType(p, l.price_type, cur, overrides, withLabels, pl, fillGaps) }
          : l;
      }),
    );
  };

  // Toggle whether products the customer's dedicated list doesn't cover fall back
  // to the selected price list (on) or straight to Website Pricing (off), then
  // re-price product-bound lines. The customer's own prices are untouched — this
  // only moves the price for products their list doesn't cover.
  const changeFillGaps = (next: boolean) => {
    if (next === fillGapsFromList) return;
    setFillGapsFromList(next);
    repriceLinesFrom(pricelist, customerPrices, currency, next);
  };

  // Switch the pricelist the invoice prices from and re-price product-bound
  // lines. DEFAULT_PRICELIST_ID falls back to the catalog (products table).
  const changePricelist = async (id: string) => {
    setSelectedPricelistId(id);
    setPricelistLoading(true);
    try {
      const next = await getPricelistPrices(id);
      setPricelist(next);
      // The invoice's paid-in currency follows the picked price list: choosing a
      // USD-tagged list flips the invoice to USD (a CAD list back to CAD), unless
      // it's already there. `next.currency` comes from the list's stored currency,
      // falling back to its name (a "…USD…" list reads as USD). The catalog
      // "Website Pricing" (DEFAULT) has no currency of its own, so it leaves the
      // paid-in currency untouched. Reprice lines against the currency we're
      // switching to in the same beat so they don't lag a render behind.
      const nextCurrency = id === DEFAULT_PRICELIST_ID ? currency : next.currency;
      const currencyChanged = nextCurrency !== currency;
      if (currencyChanged) setCurrency(nextCurrency);
      repriceLinesFrom(next, customerPrices, nextCurrency);
      const label =
        id === DEFAULT_PRICELIST_ID
          ? 'Website Pricing'
          : allPricelists.find((pl) => pl.id === id)?.name ?? 'price list';
      const priced = Object.keys(next.prices).length;
      const currencyNote = currencyChanged ? ` · paid in ${nextCurrency}` : '';
      toast.success(
        id === DEFAULT_PRICELIST_ID
          ? 'Now pricing from Website Pricing (catalog price)'
          : `Now pricing from ${label}${priced ? ` · ${priced} product${priced === 1 ? '' : 's'}` : ''}${currencyNote}`,
      );
    } catch {
      setPricelist({ ...EMPTY_PRICELIST });
      toast.error('Could not load that price list — falling back to Website Pricing');
    } finally {
      setPricelistLoading(false);
    }
  };

  // ---- submit state --------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSentAction, setPendingSentAction] = useState<'draft' | 'sent' | null>(null);
  // Email the invoice to the customer once it's created. Opt-IN: creating an
  // invoice never emails the customer unless this is switched on (historically
  // the "Create & Send" button implied a send that never actually fired).
  const [emailOnCreate, setEmailOnCreate] = useState(false);
  // When the backorder dialog offers to override, the admin can force the whole
  // order onto a single invoice (no split, no backorder) despite the shortfall.
  const [overrideBackorder, setOverrideBackorder] = useState(false);

  // ---- save line prices to the customer's price list -----------------------
  // On create, once a customer is linked, offer to persist the prices the admin
  // typed for each product as that customer's custom prices (the per-customer
  // overrides managed under admin/pricing → Customer Pricing). The prompt is a
  // gate on the first save click; the chosen prices are upserted after the
  // invoice is created (non-fatal, like the create-time email).
  const [priceListPrompt, setPriceListPrompt] = useState<'draft' | 'sent' | null>(null);
  // product_id -> whether to save this line's price. Seeded when the prompt opens.
  const [priceSaveSelections, setPriceSaveSelections] = useState<Record<string, boolean>>({});
  // The admin has answered the prompt for this save click — don't re-prompt when
  // requestSubmit re-runs to continue into the remaining gates. A ref so the
  // resolution is read synchronously in the same tick the prompt closes.
  const priceSaveResolvedRef = useRef(false);
  // The prices to upsert after the invoice is created (chosen in the prompt).
  const pendingPriceSavesRef = useRef<Array<{ product_id: string; price: number }>>([]);

  // ---- Easyship shipment opt-in (create + shipment only) -------------------
  // When on, the invoice also spins up an Easyship shipment record for the order
  // it creates. We run a live readiness check (mirroring the order page) so the
  // admin can see — and the confirm dialog can warn — whether it'll actually go
  // through, and pick a courier when it will.
  // Off by default — creating an Easyship shipment record is opt-in on both
  // create and edit, so the admin must explicitly turn it on.
  const [createEasyship, setCreateEasyship] = useState(false);
  const [easyshipReadiness, setEasyshipReadiness] = useState<InvoiceShippingReadiness | null>(null);
  const [easyshipLoading, setEasyshipLoading] = useState(false);
  const [easyshipCourierId, setEasyshipCourierId] = useState('');
  const [easyshipBuyLabel, setEasyshipBuyLabel] = useState(false);
  // Courier processing fee: the global handling-fee markup Settings bakes into
  // every Easyship rate. In the admin invoice form it's opt-IN per invoice —
  // off by default — and its amount can be overridden for this invoice only
  // (never touching the global Settings default). `courierFeeValue` is null
  // until the admin edits it; while null the global amount is used.
  const [applyCourierFee, setApplyCourierFee] = useState(false);
  const [courierFeeValue, setCourierFeeValue] = useState<number | null>(null);
  const [courierFeeType, setCourierFeeType] = useState<'flat' | 'percent'>('flat');
  // The global fee amount, learned from the readiness response — used to prefill
  // the override field the first time the admin turns the fee on.
  const [globalCourierFee, setGlobalCourierFee] = useState<number | null>(null);
  // Courier handover (who hands the parcel over) and insurance opt-in for the
  // shipment this invoice creates. Drop-off is the default.
  const [easyshipHandover, setEasyshipHandover] = useState<'pickup' | 'dropoff'>('dropoff');
  const [easyshipInsured, setEasyshipInsured] = useState(false);
  // The submit action awaiting confirmation in the Easyship dialog.
  const [easyshipPendingAction, setEasyshipPendingAction] = useState<'draft' | 'sent' | null>(null);

  // Errors/busy state scoped to the create-customer / create-salesperson modals
  // so they render inside the dialog rather than behind it.
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  // ---- quick stock edit ----------------------------------------------------
  // Admins can correct a product's on-hand stock without leaving the invoice.
  const isAdmin = role === 'admin';
  // Only admins may set/override a line's UNIT price. Affiliates (and anyone who
  // isn't a full admin) are locked to the price resolved from their assigned
  // price list, and the server re-derives it regardless of what's submitted.
  // Discounts are NOT locked — clients may discount their own price (clamped to
  // 0–100%). See ADR
  // docs/adr/0001-affiliate-invoice-pricing-locked-to-assigned-pricelist.md.
  const canEditLinePrices = isAdmin;

  // ---- price-list panel derivations ----------------------------------------
  // Whether the linked customer carries their own dedicated price list (their
  // per-customer overrides). Drives the "Customer price list" tag's active state
  // and whether the gap-fill toggle is offered. Affiliates price from their own
  // record, not the bill-to client's, so this never applies to them.
  const hasCustomerPricelist =
    !isAffiliate && !!customer && Object.keys(customerPrices).length > 0;
  // Display name of the list currently driving fill-in prices (the selector's
  // choice). DEFAULT is the catalog.
  const selectedListLabel =
    selectedPricelistId === DEFAULT_PRICELIST_ID
      ? 'Website Pricing'
      : allPricelists.find((pl) => pl.id === selectedPricelistId)?.name ?? 'the selected list';
  const customerFullName = customer ? `${customer.first_name} ${customer.last_name}`.trim() : '';

  const [quickStock, setQuickStock] = useState<
    { productId: string; name: string; value: string } | null
  >(null);
  const [quickStockBusy, setQuickStockBusy] = useState(false);
  const [quickStockError, setQuickStockError] = useState<string | null>(null);

  // ---- effects -------------------------------------------------------------
  useEffect(() => {
    supabase.from('products').select('*').eq('active', true).order('name').then(({ data }) => {
      setProducts(data ?? []);
    });
    // Load the globally active pricelist as the default pricing source, plus the
    // full list for the selector. We seed `pricelist` (and the selection) but do
    // NOT re-price here — edit mode must keep the invoice's stored line prices.
    // The selector shows a spinner until both have resolved (pricelistsInitializing).
    setPricelistsInitializing(true);
    Promise.allSettled([
      getActivePricelist().then((active) => {
        setPricelist(active);
        if (active.pricelist) {
          setActivePricelistId(active.pricelist.id);
          setSelectedPricelistId(active.pricelist.id);
        } else {
          setSelectedPricelistId(DEFAULT_PRICELIST_ID);
        }
      }),
      getPricelists().then(setAllPricelists),
    ]).finally(() => setPricelistsInitializing(false));
    // Load the CAD→USD multiplier so USD invoices price their lines correctly.
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rate = Number(data?.usd_exchange_rate);
        if (Number.isFinite(rate) && rate > 0) setUsdRate(rate);
      })
      .catch(() => {/* keep the default rate */});
  }, []);

  // Load the active customer's price overrides (their applied price list) so the
  // per-line catalog prices reflect what that customer is quoted. The prices are
  // layered over the global active pricelist by priceForProduct. When the admin
  // switches customers we also re-price every product-bound line — but never on
  // the initial mount (edit mode must keep the invoice's stored prices).
  const prevCustomerIdRef = useRef<string | null>(initial?.customer?.id ?? null);
  useEffect(() => {
    const cid = customer?.id ?? null;
    let cancelled = false;
    (async () => {
      // Affiliates always price from their OWN pricing (loaded once, below), not
      // the bill-to client's — so ignore the selected client's overrides here.
      const prices = isAffiliate
        ? affiliateOverrides
        : cid
          ? await getCustomerPriceOverrides(cid).catch(() => ({}))
          : {};
      if (cancelled) return;
      setCustomerPrices(prices);
      if (cid !== prevCustomerIdRef.current) {
        // The customer changed — adopt their saved product-label preference
        // (with vs without vial labels) and re-price product-bound lines to
        // their prices. Manual (unbound) lines keep whatever price was typed.
        const nextLabels =
          typeof customer?.default_with_labels === 'boolean'
            ? customer.default_with_labels
            : withLabels;
        // Adopting the customer's preference isn't a manual override, so a plain
        // save shouldn't write it back as a "change".
        labelsTouchedRef.current = false;
        setWithLabels(nextLabels);
        // A fresh customer starts with their own overrides honored again, and
        // their uncovered products defaulting to fill from the selected list.
        setIgnoreCustomerPrices(false);
        setFillGapsFromList(true);
        setLines((prev) =>
          prev.map((l) => {
            if (!l.product_id) return l;
            const p = products.find((pp) => pp.id === l.product_id);
            return p
              ? { ...l, unit_price: priceForType(p, l.price_type, currency, prices, nextLabels, pricelist, true) }
              : l;
          }),
        );
        prevCustomerIdRef.current = cid;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, products, isAffiliate, affiliateOverrides]);

  // Affiliate/sales-person: load THEIR OWN customer pricing + the set of
  // products hidden ($0 price, or status Hidden) for their own record, and lock
  // the invoice to price from it. RLS lets a signed-in user read their own
  // customer_price_overrides and customers rows.
  useEffect(() => {
    if (!isAffiliate) return;
    let cancelled = false;
    (async () => {
     try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid || cancelled) return;
      const [ovRes, meRes] = await Promise.all([
        supabase
          .from('customer_price_overrides')
          .select('product_id, override_price, unlabeled_override_price, vial_override_price, is_visible')
          .eq('customer_id', uid),
        supabase.from('customers').select('price_currency').eq('id', uid).maybeSingle(),
      ]);
      if (cancelled) return;
      const prices: Record<string, CustomerOverride> = {};
      const hidden = new Set<string>();
      for (const o of ovRes.data ?? []) {
        const zero = o.override_price != null && Number(o.override_price) === 0;
        // $0 box price or Hidden status → the product must not appear for them.
        if (o.is_visible === false || zero) hidden.add(o.product_id);
        const boxPresent = o.override_price != null && !zero;
        const vialPresent = o.vial_override_price != null;
        if (boxPresent || vialPresent) {
          prices[o.product_id] = {
            // Box price, or null when they only have a per-vial override (box
            // then falls back to the price list / catalog default).
            labeled: boxPresent ? Number(o.override_price) : null,
            unlabeled: o.unlabeled_override_price != null ? Number(o.unlabeled_override_price) : null,
            // Their own per-vial price; vial lines price from this instead of the
            // catalog vial_price. Null → fall back to the catalog vial price.
            vial: vialPresent ? Number(o.vial_override_price) : null,
          };
        }
      }
      const usd = (meRes.data?.price_currency ?? '') === 'USD';
      setAffiliateOverrides(prices);
      setAffiliateHiddenIds(hidden);
      setAffiliateIsUsd(usd);
      setCustomerPrices(prices);
      // Lock the paid-in currency to the affiliate's own currency (new invoices).
      if (mode === 'create') setCurrency(usd ? 'USD' : 'CAD');
     } finally {
      if (!cancelled) setAffiliateCurrencyLoaded(true);
     }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAffiliate]);

  // Affiliate setup: preload their bound customers and lock them in as the
  // invoice's sales person.
  useEffect(() => {
    if (!isAffiliate) return;
    (async () => {
     try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      const [meRes, custRes] = await Promise.all([
        fetch('/api/affiliate/me', { headers }),
        fetch('/api/admin/customers', { headers }),
      ]);

      if (meRes.ok) {
        const me = await meRes.json();
        if (me.salesPerson) {
          // An affiliate is always the sole seat on their own invoices, at the
          // rate an admin set on their record.
          setSalesTeam([
            newSeat(me.salesPerson as SalesPerson, Number(me.salesPerson.commission_rate ?? 0)),
          ]);
          setSalesLocked(true);
        }
        // Pricing source shown (locked) on the Price List field below.
        setAffiliatePricingMode(me.pricingMode === 'dedicated' ? 'dedicated' : 'template');
        setAffiliatePricelistName(me.appliedPricelist?.name ?? null);
      }
      if (custRes.ok) {
        const { customers: list } = await custRes.json();
        setBoundCustomers((list ?? []).filter((c: Customer) => c.active !== false));
      }
     } finally {
      setAffiliatePricingLoaded(true);
     }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAffiliate]);

  // Customer search debounce
  useEffect(() => {
    if (!customerQuery.trim() || customer) {
      setCustomerResults([]);
      return;
    }
    // Affiliates can only invoice their bound customers — filter the preloaded
    // list locally instead of querying all customers.
    if (isAffiliate) {
      setCustomerResults(rankNameMatches(boundCustomers, customerQuery).slice(0, 8));
      return;
    }
    const t = setTimeout(async () => {
      // Split the query into words and require EACH word to match somewhere
      // (first name, last name, or email). A single ilike on the whole string
      // misses "First Last" queries — e.g. "Mark C" lives across
      // first_name="Mark" and last_name="C", so `%Mark C%` matches no single
      // column and the row never reaches the client-side ranker. Per-word
      // AND-of-OR fixes that while still letting a lone word match broadly.
      const tokens = customerQuery
        .trim()
        .split(/\s+/)
        // Strip PostgREST-significant characters so a stray comma/paren can't
        // break the .or() filter string.
        .map((w) => w.replace(/[(),]/g, ''))
        .filter(Boolean);
      // Pull a wider candidate set than we display, then rank locally so the
      // best matches (name/prefix) win the 8 visible slots rather than an
      // arbitrary set of substring/email matches the DB happens to return first.
      let query = supabase.from('customers').select('*').eq('active', true);
      for (const tok of tokens) {
        const like = `%${tok}%`;
        // Chained .or() calls are combined with AND, so this becomes
        // (first|last|email ~ word1) AND (first|last|email ~ word2) ...
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`);
      }
      const { data } = await query.limit(50);
      setCustomerResults(rankNameMatches(data ?? [], customerQuery).slice(0, 8));
    }, 220);
    return () => clearTimeout(t);
  }, [customerQuery, customer, isAffiliate, boundCustomers]);

  // Sales person search debounce. Anyone already seated is filtered out of the
  // results — one person can't earn twice on the same invoice.
  useEffect(() => {
    if (!spQuery.trim() || !spSeatKey) {
      setSpResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const found = await searchSalesPersons(spQuery);
      const taken = new Set(salesTeam.map((seat) => seat.person?.id).filter(Boolean));
      setSpResults(found.filter((s) => !taken.has(s.id)));
    }, 220);
    return () => clearTimeout(t);
  }, [spQuery, spSeatKey, salesTeam]);

  // Outside-click handlers
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!customerBoxRef.current?.contains(e.target as Node)) setCustomerOpen(false);
      if (!spBoxRef.current?.contains(e.target as Node)) setSpOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ---- derived totals ------------------------------------------------------
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (l.qty ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_pct ?? 0) / 100), 0),
    [lines],
  );
  const taxTotal = useMemo(() => subtotal * ((taxRate ?? 0) / 100), [subtotal, taxRate]);
  // The processing fee only applies to self-pickup invoices, and only when its
  // "show on invoice" toggle is on.
  const effectiveProcessingFee = useMemo(
    () => (fulfillmentType === 'pickup' && showProcessingFee ? Number(processingFee || 0) : 0),
    [fulfillmentType, showProcessingFee, processingFee],
  );
  const total = useMemo(
    () => subtotal + taxTotal + Number(shipping || 0) + effectiveProcessingFee,
    [subtotal, taxTotal, shipping, effectiveProcessingFee],
  );
  /** What each seated person earns, and the sum of it. */
  const seatCommission = useCallback(
    (seat: SalesSeat) => total * ((seat.rate ?? 0) / 100),
    [total],
  );
  const commissionAmount = useMemo(
    () => salesTeam.reduce((sum, seat) => sum + (seat.person ? total * ((seat.rate ?? 0) / 100) : 0), 0),
    [total, salesTeam],
  );
  const seatedTeam = useMemo(() => salesTeam.filter((seat) => seat.person), [salesTeam]);

  // ---- eligible price-list saves ------------------------------------------
  // Product-bound lines whose entered price can become a per-customer override.
  // Overrides store a single box (pack-of-10) price per product in the CUSTOMER's
  // own currency (USD for a USD-tagged customer, CAD otherwise), so we offer
  // box-priced lines and convert the entered price into that currency. When the
  // same product appears on several lines the last one wins (upsert semantics).
  const custPriceCurrency: InvoiceCurrency = customerIsUsd ? 'USD' : 'CAD';
  const eligiblePriceSaves = useMemo(() => {
    // The save-back writes the labeled box override_price. Skip it when labels
    // are off (the typed price is the unlabeled one, not the labeled one — and a
    // labeled-only override row is what the pricing logic reads back), and for
    // affiliates — their lines price from their own pricing, which must never be
    // written onto the bill-to client's price list.
    if (mode !== 'create' || !customer || !withLabels || isAffiliate) return [];
    // Convert the entered price (shown in the invoice currency) into the
    // currency the customer's overrides are stored in.
    const toCustomerCurrency = (v: number): number =>
      currency === custPriceCurrency
        ? round2(v)
        : custPriceCurrency === 'USD'
          ? usdFromCad(v, usdRate)
          : cadFromUsd(v, usdRate);
    const byProduct = new Map<
      string,
      { product_id: string; name: string; entered: number; price: number; def: number }
    >();
    for (const l of lines) {
      if (!l.product_id || l.price_type !== 'box') continue;
      if (l.unit_price == null || l.unit_price <= 0) continue;
      // A fully discounted line is a giveaway — the entered price isn't what this
      // customer actually pays, so never record it to their price list.
      if ((l.discount_pct ?? 0) >= 100) continue;
      const p = products.find((pp) => pp.id === l.product_id);
      if (!p) continue;
      // The catalog default this customer would otherwise be quoted, in their
      // currency — so the prompt can flag which entered prices actually change
      // anything (mirrors priceForProduct's catalog-default branch).
      const def =
        custPriceCurrency === 'USD'
          ? p.price_usd != null
            ? round2(Number(p.price_usd))
            : usdFromCad(Number(p.price), usdRate)
          : round2(Number(p.price));
      byProduct.set(l.product_id, {
        product_id: l.product_id,
        name: p.strength ? `${p.name} — ${p.strength}` : p.name,
        entered: l.unit_price,
        price: toCustomerCurrency(l.unit_price),
        def,
      });
    }
    return Array.from(byProduct.values());
    // `lines` covers discount_pct changes; listed here for clarity.
  }, [mode, customer, customerIsUsd, custPriceCurrency, withLabels, lines, products, currency, usdRate]);
  // Some product lines are priced per vial — the price list only holds box
  // prices, so those can't be saved. Surface the count in the prompt.
  const vialLineCount = useMemo(
    () =>
      mode === 'create' && customer
        ? lines.filter((l) => l.product_id && l.price_type === 'vial').length
        : 0,
    [mode, customer, lines],
  );

  // Editing the customer, lines, or currency after answering the prompt should
  // let it reappear for the changed prices on the next save click.
  useEffect(() => {
    priceSaveResolvedRef.current = false;
  }, [lines, customer, currency]);

  // ---- stock validation ---------------------------------------------------
  const stockErrors = useMemo(() => {
    // Stock is counted in vials, so sum each product's demand in vials too:
    // box lines multiply their qty by vials_per_box, vial lines count as-is.
    const byProduct: Record<string, number> = {};
    for (const l of lines) {
      if (!l.product_id) continue;
      const vpb = products.find((p) => p.id === l.product_id)?.vials_per_box;
      byProduct[l.product_id] =
        (byProduct[l.product_id] ?? 0) + qtyToVials(l.qty ?? 0, vpb, l.price_type);
    }
    const errs: Record<string, string> = {};
    for (const l of lines) {
      if (!l.product_id) continue;
      const stock = l.stock_quantity ?? products.find((p) => p.id === l.product_id)?.stock_quantity ?? 0;
      if (byProduct[l.product_id] > stock) {
        errs[l.product_id] = `Only ${stock} vials in stock — will backorder`;
      }
    }
    return errs;
  }, [lines, products]);
  const hasStockError = Object.keys(stockErrors).length > 0;

  // The client-shipment scenario is only active with a linked customer and a
  // shipment. Guest/pickup invoices can't ship to a saved client.
  const clientScenarioActive = shipsToClient && !!customer && fulfillmentType === 'shipment';
  // The saved (or in-progress new) client this invoice ships to, when the
  // scenario is active. Drives both the Easyship readiness destination and the
  // collapsed customer Ship-to box. Null until a client is chosen/entered.
  const activeClient: CustomerClient | typeof newClient | null = clientScenarioActive
    ? clientMode === 'select'
      ? clientList.find((c) => c.id === selectedClientId) ?? null
      : newClient
    : null;

  // Collapse the customer "Ship to" box when the shipment is bound for a client
  // (the parcel goes to the client, not the customer), and restore it when it
  // isn't. Only re-runs on the scenario flipping, so a manual expand sticks.
  useEffect(() => {
    setShipToCollapsed(clientScenarioActive);
  }, [clientScenarioActive]);

  // ---- Easyship readiness (debounced) -------------------------------------
  // Re-check whenever the toggle, destination, or line items change so the
  // ready/not-ready badge and courier options stay live as the admin types.
  // The linked order already has an Easyship shipment — creating another is a
  // no-op, so we hide the opt-in and manage the existing one from the order.
  const hasExistingShipment = !!initial?.order?.easyship_shipment_id;
  // Available for any shipment invoice without an existing shipment — on create
  // and on edit (the edit path creates the record for the already-linked order).
  const easyshipEligible = fulfillmentType === 'shipment' && !hasExistingShipment;
  const easyshipActive = createEasyship && easyshipEligible;
  useEffect(() => {
    if (!easyshipActive) {
      setEasyshipReadiness(null);
      setEasyshipLoading(false);
      return;
    }
    let cancelled = false;
    setEasyshipLoading(true);
    const t = setTimeout(async () => {
      const items = lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          quantity: l.qty ?? 0,
          declaredValue: Number(((l.qty ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_pct ?? 0) / 100)).toFixed(2)),
        }));
      // For a client shipment the parcel — and the Easyship record — go to the
      // CLIENT's address under the client's name/contact (falling back to the
      // customer, then the house default), mirroring the server's
      // buildClientShipAddress. Price readiness against that real destination
      // rather than the (often empty) customer Ship-to fields.
      const destination = activeClient
        ? {
            firstName: (activeClient.first_name || '').trim() || customer?.first_name || '',
            lastName: (activeClient.last_name || '').trim() || customer?.last_name || '',
            address: activeClient.address || '',
            city: activeClient.city || '',
            state: activeClient.state || '',
            postalCode: activeClient.postal_code || '',
            country: activeClient.country || 'CA',
            phone: (activeClient.phone || '').trim() || customer?.phone || DEFAULT_CLIENT_PHONE,
            email: (activeClient.email || '').trim() || customer?.email || DEFAULT_CLIENT_EMAIL,
          }
        : {
            firstName: shipAddr.firstName || customer?.first_name || '',
            lastName: shipAddr.lastName || customer?.last_name || '',
            address: shipAddr.address,
            city: shipAddr.city,
            state: shipAddr.state,
            postalCode: shipAddr.postalCode,
            country: shipAddr.country || 'CA',
            phone: shipAddr.phone || customer?.phone || '',
            email: shipAddr.email || customer?.email || '',
          };
      const res = await getInvoiceShippingReadiness({
        destination,
        items,
        applyProcessingFee: applyCourierFee,
        processingFeeValue: courierFeeValue,
      });
      if (cancelled) return;
      if (res.success && res.data) {
        setEasyshipReadiness(res.data);
        // Learn the global fee amount/type so the override field can prefill.
        if (res.data.handlingFee) {
          setGlobalCourierFee(res.data.handlingFee.value);
          setCourierFeeType(res.data.handlingFee.type);
        }
        // Never auto-pick a courier — the admin must choose one explicitly.
      }
      setEasyshipLoading(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easyshipActive, shipAddr, lines, customer, applyCourierFee, courierFeeValue, activeClient]);

  // Prefill the per-invoice fee override with the global amount the first time
  // the admin turns the fee on (only while they haven't typed their own value).
  useEffect(() => {
    if (applyCourierFee && courierFeeValue == null && globalCourierFee != null) {
      setCourierFeeValue(globalCourierFee);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCourierFee, globalCourierFee]);

  // Editing the Ship to fields after a save clears the confirmation so the
  // save/update prompt can reappear if the details diverge again.
  useEffect(() => {
    setShipToSaved(false);
  }, [shipAddr]);

  // Load the linked customer's saved clients (for the client-shipment picker).
  // Reset selection when there's no customer to attach clients to.
  useEffect(() => {
    setClientSearch('');
    // Any open edit belongs to the previous customer's address book.
    setEditClient(null);
    if (!customer) {
      setClientList([]);
      return;
    }
    let cancelled = false;
    setClientsLoading(true);
    getCustomerClients(customer.id)
      .then((list) => {
        if (cancelled) return;
        setClientList(list);
        // Default to picking from an existing client when the customer has any
        // and none is chosen yet (fresh create); otherwise keep the new-client
        // form for an empty address book.
        if (list.length > 0 && !selectedClientId) setClientMode('select');
        else if (list.length === 0) setClientMode('new');
      })
      .catch(() => { if (!cancelled) setClientList([]); })
      .finally(() => { if (!cancelled) setClientsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  // A new client's blank email/phone was resolved (or edited) — clear the
  // stored choice so a later change re-prompts.
  useEffect(() => {
    setClientContactChoice(null);
    clientContactChoiceRef.current = null;
  }, [newClient.email, newClient.phone]);

  const easyshipReady = easyshipActive && !!easyshipReadiness?.ready;
  const selectedCourier =
    easyshipReadiness?.rates.find((r) => r.courierId === easyshipCourierId) ?? null;

  // Auto-fill the invoice shipping fee from the chosen courier's rate (which
  // already bundles the processing fee). This only seeds OUR invoice/DB figure —
  // Easyship still bills whatever it calculates. The admin can override it; once
  // they do, we leave it alone.
  useEffect(() => {
    if (!easyshipActive || shippingOverridden || !selectedCourier) return;
    setShipping(selectedCourier.cost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easyshipActive, shippingOverridden, selectedCourier?.courierId, selectedCourier?.cost]);

  // Offer to save the typed Ship to details back to the linked customer when
  // they differ from what's on file — covers both a missing record (nothing
  // saved yet) and an edited one (address/phone changed). Compared on the
  // substantive fields (street, postal, phone) to avoid noise from the country
  // default. Saving updates address + phone only (never the login email).
  const norm = (s?: string | null) => (s ?? '').trim();
  const shipDiffersFromCustomer =
    !!customer &&
    ((!!norm(shipAddr.address) && norm(shipAddr.address) !== norm(customer.shipping_address)) ||
      (!!norm(shipAddr.postalCode) && norm(shipAddr.postalCode) !== norm(customer.shipping_postal_code)) ||
      (!!norm(shipAddr.phone) && norm(shipAddr.phone) !== norm(customer.phone)));
  const customerHadShipOnFile =
    !!customer && (!!norm(customer.shipping_address) || !!norm(customer.phone));

  // ---- sales-person line-item discount presets ----------------------------
  // The invoice's sales person can carry default per-line discounts (set on the
  // Sales People page): one for box lines, one for vial lines. They pre-fill a
  // line's Disc % when it's added or its product/type is chosen — until the
  // admin/affiliate edits that line's discount by hand (discount_touched). A
  // preset of 0 means "no preset" (leave the line's discount blank).
  const boxDiscountPreset = Math.min(100, Math.max(0, Number(salesPerson?.default_box_discount_pct) || 0));
  const vialDiscountPreset = Math.min(100, Math.max(0, Number(salesPerson?.default_vial_discount_pct) || 0));
  const presetDiscountFor = (type: 'box' | 'vial'): number | null =>
    (type === 'vial' ? vialDiscountPreset : boxDiscountPreset) || null;

  // ---- line operations ----------------------------------------------------
  const addLine = () =>
    setLines((prev) => [...prev, { ...NEW_LINE(), discount_pct: presetDiscountFor('box') }]);
  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length === 1 ? [NEW_LINE()] : prev.filter((_, i) => i !== idx)));
  };
  const patchLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  // Prepaid: record the supplier chosen to procure a line (null = use cheapest).
  const assignLineSupplier = (idx: number, supplierId: string | null) =>
    patchLine(idx, { preferred_supplier_id: supplierId });
  const pickProductForLine = (idx: number, p: Product) => {
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              product_id: p.id,
              description: p.strength ? `${p.name} — ${p.strength}` : p.name,
              // New lines default to the box (pack of 10) price.
              unit_price: priceForType(p, 'box'),
              price_type: 'box',
              stock_quantity: p.stock_quantity,
              // Adopt the sales person's box discount preset unless this line's
              // discount was already set by hand.
              discount_pct: l.discount_touched ? l.discount_pct : presetDiscountFor('box'),
            }
          : l,
      ),
    );
    setActiveLineIdx(null);
    setProductSearch('');
  };
  // Toggle a line between box and vial pricing, re-pricing from the catalog
  // when the line is bound to a product (manual lines just keep their price).
  const setLinePriceType = (idx: number, type: 'box' | 'vial') => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const p = l.product_id ? products.find((pr) => pr.id === l.product_id) : undefined;
        return {
          ...l,
          price_type: type,
          unit_price: p ? priceForType(p, type) : l.unit_price,
          // Follow the matching type's discount preset unless the line's
          // discount was set by hand.
          discount_pct: l.discount_touched ? l.discount_pct : presetDiscountFor(type),
        };
      }),
    );
  };
  // Set a line's discount, clamped to 0–100% (a negative would inflate the
  // total). Clients may discount even though they can't touch the unit price.
  // A manual edit marks the line touched so presets no longer overwrite it.
  const setLineDiscount = (idx: number, pct: number | null) =>
    patchLine(idx, {
      discount_pct: pct == null ? null : Math.min(100, Math.max(0, pct)),
      discount_touched: true,
    });
  // Apply one discount to every line at once — the "Discount all" quick control.
  const applyDiscountToAll = (pct: number) =>
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        discount_pct: Math.min(100, Math.max(0, pct)),
        discount_touched: true,
      })),
    );

  // When the invoice's sales person changes, refresh the pre-filled discount on
  // every line the admin hasn't touched — so the first line, an affiliate's own
  // presets (loaded after mount), and a freshly-picked sales person all take
  // effect. Touched lines keep their hand-set discount.
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) =>
        l.discount_touched ? l : { ...l, discount_pct: presetDiscountFor(l.price_type) },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxDiscountPreset, vialDiscountPreset]);

  // ---- quick stock edit ----------------------------------------------------
  const openQuickStock = (productId: string, name: string, current: number) => {
    setQuickStockError(null);
    setQuickStock({ productId, name, value: String(current) });
  };
  const submitQuickStock = async () => {
    if (!quickStock) return;
    const val = parseInt(quickStock.value, 10);
    if (Number.isNaN(val) || val < 0) {
      setQuickStockError('Enter a valid stock quantity (0 or more)');
      return;
    }
    setQuickStockBusy(true);
    setQuickStockError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/products/${quickStock.productId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ stock_quantity: val }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to update stock');
      }
      // Reflect the new stock in the catalog and on every line using this
      // product so the stock badges and backorder validation refresh.
      setProducts((prev) =>
        prev.map((p) => (p.id === quickStock.productId ? { ...p, stock_quantity: val } : p)),
      );
      setLines((prev) =>
        prev.map((l) => (l.product_id === quickStock.productId ? { ...l, stock_quantity: val } : l)),
      );
      setQuickStock(null);
    } catch (e: any) {
      setQuickStockError(e.message ?? 'Failed to update stock');
    } finally {
      setQuickStockBusy(false);
    }
  };

  // ---- product filter ------------------------------------------------------
  // Products offered in the line picker. For affiliates, drop the ones hidden
  // for their own record (status Hidden or a $0 price) so they never appear.
  const pickerProducts = useMemo(
    () => (isAffiliate ? products.filter((p) => !affiliateHiddenIds.has(p.id)) : products),
    [isAffiliate, products, affiliateHiddenIds],
  );
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return pickerProducts.slice(0, 12);
    const q = productSearch.toLowerCase();
    return pickerProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.slug ?? '').toLowerCase().includes(q) ||
          (p.strength ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [pickerProducts, productSearch]);

  // Saved clients narrowed by the picker's search box. Matches on name,
  // address parts, and contact so admins can find one in a long list.
  const filteredClientList = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientList;
    return clientList.filter((c) =>
      [
        c.first_name, c.last_name, c.address, c.city, c.state,
        c.postal_code, c.country, c.email, c.phone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [clientList, clientSearch]);

  // Open the edit modal for a saved client, seeded with its current values.
  const openEditClient = (c: CustomerClient) => {
    setEditClientError(null);
    setEditClient({
      id: c.id,
      draft: {
        first_name: c.first_name ?? '',
        last_name: c.last_name ?? '',
        address: c.address ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        postal_code: c.postal_code ?? '',
        country: c.country ?? 'CA',
        phone: c.phone ?? '',
        email: c.email ?? '',
      },
    });
  };

  const patchEditClient = (patch: Partial<typeof emptyClient>) =>
    setEditClient((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  // Save the edited client back to the customer's address book. The updated
  // record replaces its entry in clientList, so the picker row, the collapsed
  // Ship-to summary and the Easyship readiness check all pick it up at once.
  const submitEditClient = async () => {
    if (!editClient || !customer) return;
    const d = editClient.draft;
    if (!d.address.trim()) {
      setEditClientError('Client address is required');
      return;
    }
    setEditClientBusy(true);
    setEditClientError(null);
    try {
      const saved = await updateCustomerClient(customer.id, editClient.id, {
        first_name: d.first_name.trim() || null,
        last_name: d.last_name.trim() || null,
        address: d.address.trim(),
        city: d.city.trim() || null,
        state: d.state.trim() || null,
        postal_code: d.postal_code.trim() || null,
        country: d.country.trim() || null,
        phone: d.phone.trim() || null,
        email: d.email.trim() || null,
      });
      setClientList((list) => list.map((c) => (c.id === saved.id ? saved : c)));
      setEditClient(null);
      const name = [saved.first_name, saved.last_name].filter(Boolean).join(' ') || 'Client';
      toast.success(`${name} updated`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the client';
      setEditClientError(msg);
      toast.error(msg);
    } finally {
      setEditClientBusy(false);
    }
  };

  // Count the invoices that still ship to a client. A failed lookup is left
  // silent — the delete stays available and the server-side guard still has the
  // last word, so a hiccup here costs the warning, not the action.
  const loadDeleteClientUsage = useCallback(
    async (clientId: string) => {
      if (!customer) return;
      setDeleteClientUsageLoading(true);
      try {
        const usage = await getCustomerClientUsage(customer.id, clientId);
        setDeleteClientUsage(usage);
      } catch {
        setDeleteClientUsage(null);
      } finally {
        setDeleteClientUsageLoading(false);
      }
    },
    [customer],
  );

  // Look the usage up as the confirmation opens, so the modal can warn before
  // the user commits rather than failing them on submit.
  useEffect(() => {
    if (!deleteClient) return;
    setDeleteClientUsage(null);
    loadDeleteClientUsage(deleteClient.id);
  }, [deleteClient, loadDeleteClientUsage]);

  // Remove a saved client from the customer's address book. The modal already
  // warns when invoices ship to them, so a refusal here is the race — an
  // invoice took this client between the warning and the click. Show it and
  // refresh the usage so the modal catches up instead of just erroring.
  const submitDeleteClient = async () => {
    if (!deleteClient || !customer) return;
    setDeleteClientBusy(true);
    setDeleteClientError(null);
    try {
      await deleteCustomerClient(customer.id, deleteClient.id);
      const remaining = clientList.filter((c) => c.id !== deleteClient.id);
      setClientList(remaining);
      // The deleted client can't stay picked, and with an empty address book
      // the picker has nothing to show — fall back to the new-client form.
      if (selectedClientId === deleteClient.id) setSelectedClientId(null);
      if (remaining.length === 0) setClientMode('new');
      toast.success(`${clientName(deleteClient)} deleted`);
      setDeleteClient(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not delete the client';
      setDeleteClientError(msg);
      toast.error(msg);
      if (e instanceof ClientInUseError) setDeleteClientUsage(e.usage);
    } finally {
      setDeleteClientBusy(false);
    }
  };

  // ---- new vs existing account detection ----------------------------------
  // When the admin types a bare name (no customer linked yet), figure out
  // whether an account with that exact name (or, for an email-style query,
  // that exact email) already exists. We scan the already-fetched search
  // candidates rather than firing another query. Multiple people can share a
  // name, so this returns ALL exact matches — the UI lets the admin pick the
  // right one instead of guessing.
  const trimmedCustomerQuery = customerQuery.trim();
  const exactMatches = useMemo<Customer[]>(() => {
    if (customer || !trimmedCustomerQuery) return [];
    const q = trimmedCustomerQuery.toLowerCase();
    const isEmail = /@/.test(trimmedCustomerQuery);
    return customerResults.filter((c) =>
      isEmail
        ? (c.email ?? '').toLowerCase() === q
        : `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim().toLowerCase() === q,
    );
  }, [customer, trimmedCustomerQuery, customerResults]);

  // ---- customer / salesperson selection -----------------------------------
  const pickCustomer = (c: Customer) => {
    setCustomer(c);
    setCustomerQuery(`${c.first_name} ${c.last_name}`.trim());
    setCustomerOpen(false);
    setShipToSaved(false);
    // Prefill the shipping destination from the customer's saved address so a
    // shipment order/label can be created without re-typing it.
    setShipAddr((prev) => ({
      firstName: c.first_name || prev.firstName,
      lastName: c.last_name || prev.lastName,
      address: c.shipping_address || prev.address,
      city: c.shipping_city || prev.city,
      state: c.shipping_state || prev.state,
      postalCode: c.shipping_postal_code || prev.postalCode,
      country: c.shipping_country || prev.country || 'CA',
      phone: c.phone || prev.phone,
      email: c.email || prev.email,
    }));
    // The invoice is billed in the customer's configured currency: selecting a
    // customer switches this invoice to their CAD/USD tag and re-prices every
    // product-bound line into it. The tag wins — no prompt. (An admin can still
    // flip the currency by hand afterwards via the Paid In toggle.) Affiliates
    // are excluded: they're locked to their OWN currency (set once on mount),
    // never the bill-to client's, so we don't touch the currency for them.
    if (!isAffiliate) {
      changeCurrency(c.price_currency === 'USD' ? 'USD' : 'CAD');
    }
    // Auto-fill the sales team saved on this customer (from a prior invoice's
    // "save to customer" opt-in). Create flow only, and never overrides a team
    // already chosen or the affiliate's own locked-in attribution.
    if (mode === 'create' && !salesLocked && !salesPerson) {
      autofillSalesTeamFromCustomer(c);
    }
  };
  /**
   * Load the customer's saved sales team and seat it, each person on the rate
   * stored for THIS customer. Falls back to their single default sales person
   * for a customer saved before teams existed. Best-effort — a lookup failure
   * just leaves the team blank for manual entry.
   */
  const autofillSalesTeamFromCustomer = async (c: Customer) => {
    const { data: roster } = await supabase
      .from('customer_sales_persons')
      .select('commission_rate, position, sales_person:sales_persons (*)')
      .eq('customer_id', c.id)
      .order('position', { ascending: true });

    const seats = ((roster as any[]) ?? [])
      .filter((r) => r.sales_person && r.sales_person.active !== false)
      .map((r) => newSeat(r.sales_person as SalesPerson, Number(r.commission_rate) || 0));
    if (seats.length > 0) {
      setSalesTeam(seats);
      return;
    }

    if (!c.default_sales_person_id) return;
    const { data } = await supabase
      .from('sales_persons')
      .select('*')
      .eq('id', c.default_sales_person_id)
      .eq('active', true)
      .maybeSingle();
    if (data) setSalesTeam([newSeat(data as SalesPerson, Number((data as SalesPerson).commission_rate) || 0)]);
  };
  const clearCustomer = () => {
    setCustomer(null);
    setCustomerQuery('');
    setShipToSaved(false);
  };

  // Persist the Ship to address/phone back onto the linked customer so it's on
  // file next time. Scoped to address + phone (never touches login email).
  const saveShipToCustomer = async () => {
    if (!customer) return;
    setSavingShipTo(true);
    const res = await updateCustomer(customer.id, {
      phone: shipAddr.phone.trim() || undefined,
      shipping_address: shipAddr.address.trim() || undefined,
      shipping_city: shipAddr.city.trim() || undefined,
      shipping_state: shipAddr.state.trim() || undefined,
      shipping_postal_code: shipAddr.postalCode.trim() || undefined,
      shipping_country: shipAddr.country.trim() || undefined,
    });
    setSavingShipTo(false);
    if (res.success && res.customer) {
      setCustomer(res.customer);
      setShipToSaved(true);
    }
  };
  // Remember the label choice on the linked customer so future invoices default
  // to it. Only writes when the admin actually flipped the toggle and the value
  // differs from what's stored — a plain save never mutates the preference.
  // Non-fatal: a failure here must not block the invoice save.
  const rememberLabelPreference = async () => {
    if (!customer || !labelsTouchedRef.current) return;
    const stored = customer.default_with_labels !== false;
    if (stored === withLabels) return;
    await updateCustomer(customer.id, { default_with_labels: withLabels }).catch(() => {});
  };
  // Remember the invoice's whole sales team on the linked customer so their
  // future invoices auto-fill it, each person at the rate used here. Runs only
  // when the admin left the opt-in checked and both a customer and at least one
  // sales person are set (never for an affiliate's own locked-in attribution).
  // Non-fatal: a failure here must not block the invoice save.
  const rememberSalesPersonPreference = async () => {
    if (salesLocked || !saveSalesPersonToCustomer) return;
    if (!customer || seatedTeam.length === 0) return;
    await updateCustomer(customer.id, {
      sales_people: seatedTeam.map((seat) => ({
        sales_person_id: seat.person!.id,
        commission_rate: seat.rate ?? 0,
      })),
    }).catch(() => {});
  };
  // Upsert the chosen line prices as the customer's per-customer overrides
  // (admin/pricing → Customer Pricing). Prices are labeled box prices in the
  // customer's own currency. Returns the number that failed so the caller can
  // surface a non-fatal notice.
  const savePricesToCustomer = async (
    customerId: string,
    prices: Array<{ product_id: string; price: number }>,
  ): Promise<number> => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
    const results = await Promise.all(
      prices.map((p) =>
        fetch('/api/admin/price-overrides', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customer_id: customerId,
            product_id: p.product_id,
            override_price: p.price,
          }),
        })
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    return results.filter((ok) => !ok).length;
  };

  const openNewCustomerModal = (opts?: { isNewAccount?: boolean }) => {
    const parts = customerQuery.trim().split(/\s+/);
    const looksLikeEmail = /@/.test(customerQuery);
    setNewCustomer({
      first_name: looksLikeEmail ? '' : parts[0] ?? '',
      last_name: looksLikeEmail ? '' : parts.slice(1).join(' '),
      email: looksLikeEmail ? customerQuery : '',
      phone: '',
      shipping_address: '', shipping_city: '', shipping_state: '',
      shipping_postal_code: '', shipping_country: 'CA',
    });
    setNewCustomerIsNewAccount(!!opts?.isNewAccount);
    setModalError(null);
    setShowCustomerModal(true);
  };
  const submitNewCustomer = async () => {
    setModalError(null);
    if (!newCustomer.first_name.trim() && !newCustomer.last_name.trim() && !newCustomer.email.trim()) {
      setModalError('Enter a name or email for the new customer');
      return;
    }
    // The customers table has no INSERT policy for authenticated clients, so we
    // create the guest customer through the service-role admin API.
    setModalBusy(true);
    const result = await createCustomer({
      first_name: newCustomer.first_name,
      last_name: newCustomer.last_name,
      email: newCustomer.email,
      phone: newCustomer.phone,
      shipping_address: newCustomer.shipping_address,
      shipping_city: newCustomer.shipping_city,
      shipping_state: newCustomer.shipping_state,
      shipping_postal_code: newCustomer.shipping_postal_code,
      shipping_country: newCustomer.shipping_country,
    });
    setModalBusy(false);
    if (!result.success || !result.customer) {
      // The email is already an affiliate — they're invoiceable directly, so
      // point the user at the picker instead of minting a duplicate.
      if (result.conflict?.type === 'affiliate') {
        const name =
          [result.conflict.first_name, result.conflict.last_name].filter(Boolean).join(' ') ||
          result.conflict.email;
        setModalError(
          `This email already belongs to affiliate ${name}. Close this and search for them in the customer list — affiliates can be invoiced directly.`,
        );
        return;
      }
      setModalError(result.error ?? 'Could not create customer');
      return;
    }
    pickCustomer(result.customer);
    setShowCustomerModal(false);
  };

  /** Seat a person, defaulting their rate to the one on their own record. */
  const pickSalesPerson = (seatKey: string, s: SalesPerson) => {
    setSalesTeam((prev) =>
      prev.map((seat) =>
        seat.key === seatKey ? { ...seat, person: s, rate: Number(s.commission_rate) || 0 } : seat,
      ),
    );
    setSpQuery('');
    setSpOpen(false);
    setSpSeatKey(null);
  };
  /** Empty a seat back to its search box, keeping its place in the order. */
  const clearSalesSeat = (seatKey: string) => {
    setSalesTeam((prev) =>
      prev.map((seat) => (seat.key === seatKey ? { ...seat, person: null, rate: null } : seat)),
    );
    setSpQuery('');
    setSpSeatKey(seatKey);
    setSpOpen(true);
  };
  /** Drop a seat entirely. The last one is emptied rather than removed, so the
   *  card never collapses to nothing to click on. */
  const removeSalesSeat = (seatKey: string) => {
    setSalesTeam((prev) =>
      prev.length <= 1 ? [newSeat()] : prev.filter((seat) => seat.key !== seatKey),
    );
    if (spSeatKey === seatKey) {
      setSpSeatKey(null);
      setSpQuery('');
    }
  };
  const addSalesSeat = () => {
    if (salesTeam.length >= MAX_SALES_PEOPLE) return;
    const seat = newSeat();
    setSalesTeam((prev) => [...prev, seat]);
    setSpSeatKey(seat.key);
    setSpQuery('');
    setSpOpen(true);
  };
  const setSeatRate = (seatKey: string, rate: number | null) => {
    setSalesTeam((prev) => prev.map((seat) => (seat.key === seatKey ? { ...seat, rate } : seat)));
  };
  const openNewSpModal = () => {
    const parts = spQuery.trim().split(/\s+/);
    setNewSp({
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      email: '',
      phone: '',
      commission_rate: 5,
    });
    setModalError(null);
    setShowSpModal(true);
  };
  const submitNewSp = async () => {
    setModalError(null);
    if (!newSp.first_name.trim() || !newSp.last_name.trim()) {
      setModalError('First and last name are required for the salesperson');
      return;
    }
    setModalBusy(true);
    try {
      const s = await createSalesPerson({
        first_name: newSp.first_name.trim(),
        last_name: newSp.last_name.trim(),
        email: newSp.email || null,
        phone: newSp.phone || null,
        commission_rate: newSp.commission_rate,
        notes: null,
        active: true,
      });
      // The modal is only reachable from a seat's own search box.
      if (spSeatKey) pickSalesPerson(spSeatKey, s);
      setShowSpModal(false);
    } catch (e: any) {
      setModalError(e.message ?? 'Could not create salesperson');
    } finally {
      setModalBusy(false);
    }
  };

  // ---- submit --------------------------------------------------------------
  // Drafts always allow over-stock (you might be invoicing arriving stock).
  // Sent invoices warn-and-confirm rather than hard-blocking so backorders
  // are an explicit decision instead of a quiet override.
  // (clientScenarioActive is defined above, near the Easyship readiness check.)

  // Resolve a new client's contact, filling blanks from the chosen fallback
  // (the customer's info, or the default client contact).
  const resolveNewClient = () => {
    const choice = clientContactChoiceRef.current;
    const email =
      newClient.email.trim() ||
      (choice === 'customer'
        ? (customer?.email ?? '')
        : choice === 'default'
          ? DEFAULT_CLIENT_EMAIL
          : '');
    const phone =
      newClient.phone.trim() ||
      (choice === 'customer'
        ? (customer?.phone ?? '')
        : choice === 'default'
          ? DEFAULT_CLIENT_PHONE
          : '');
    return {
      first_name: newClient.first_name.trim() || null,
      last_name: newClient.last_name.trim() || null,
      address: newClient.address.trim(),
      city: newClient.city.trim() || null,
      state: newClient.state.trim() || null,
      postal_code: newClient.postal_code.trim() || null,
      country: newClient.country.trim() || 'CA',
      phone: phone || null,
      email: email || null,
    };
  };

  const requestSubmit = (action: 'draft' | 'sent') => {
    setError(null);
    if (lines.every((l) => !l.description.trim())) {
      setError('Add at least one line item');
      return;
    }
    // Offer to save the entered prices to the linked customer's price list.
    // First gate on the save click; once answered we fall through to the
    // remaining gates. Skipped when there's nothing to save.
    if (!priceSaveResolvedRef.current && eligiblePriceSaves.length > 0) {
      setPriceSaveSelections(
        Object.fromEntries(eligiblePriceSaves.map((e) => [e.product_id, true])),
      );
      setPriceListPrompt(action);
      return;
    }
    // Client shipment gating: require a selection or a valid new client, and
    // prompt for a contact fallback when a new client's email/phone is blank.
    if (clientScenarioActive) {
      if (clientMode === 'select' && !selectedClientId) {
        setError('Select a client to ship to, or add a new one');
        return;
      }
      if (clientMode === 'new') {
        if (!newClient.address.trim()) {
          setError('Client address is required');
          return;
        }
        const needsContact = !newClient.email.trim() || !newClient.phone.trim();
        if (needsContact && !clientContactChoice) {
          setClientContactPrompt(action);
          return;
        }
      }
    }
    // When the admin opted into an Easyship shipment, always confirm first — the
    // dialog spells out whether a record will be created (and offers a label),
    // and folds in the backorder warning so there's a single gate, not two.
    if (easyshipActive) {
      // Never auto-pick a courier: when live rates are offered, one must be
      // chosen explicitly before a shipment can be created.
      if (easyshipReady && (easyshipReadiness?.rates.length ?? 0) > 0 && !easyshipCourierId) {
        setError('Select a courier for the Easyship shipment before submitting.');
        return;
      }
      setEasyshipPendingAction(action);
      return;
    }
    const sendsImmediately =
      action === 'sent' || (mode === 'edit' && initial?.status !== 'draft');
    if (hasStockError && sendsImmediately) {
      setPendingSentAction(action);
      return;
    }
    void submit(action);
  };

  const submit = async (action: 'draft' | 'sent') => {
    setError(null);
    // Snapshot the override choice before we reset the dialog state below.
    const overrideBackorderNow = overrideBackorder;
    setPendingSentAction(null);
    setEasyshipPendingAction(null);
    setClientContactPrompt(null);
    setPriceListPrompt(null);
    setOverrideBackorder(false);
    setSubmitting(true);
    try {
      const payload = {
        customer_id: customer?.id ?? null,
        customer_name: customer
          ? null
          : customerQuery.trim() || null,
        // For a guest (no linked customer) fall back to the Ship to email/phone
        // so the order — and the Easyship shipment built from it — carries the
        // recipient's contact details a courier requires.
        customer_email: customer?.email ?? (shipAddr.email.trim() || null),
        customer_phone: customer?.phone ?? (shipAddr.phone.trim() || null),
        issue_date: issueDate,
        due_date: dueDate,
        tax_rate: taxRate ?? 0,
        shipping_cost: Number(shipping) || 0,
        // Whether the payment link's hosted checkout charges that shipping fee.
        // Off means the hand-off sends `shipping_total_cents: 0`.
        charge_shipping_on_checkout: chargeShippingOnCheckout,
        // Processing fee is a pickup-only charge; never send one for a shipment.
        processing_fee: fulfillmentType === 'pickup' ? Number(processingFee) || 0 : 0,
        show_processing_fee: showProcessingFee,
        status: (mode === 'create' ? action : (initial?.status ?? 'draft')) as InvoiceStatus,
        invoice_type: isPrepaid ? 'prepaid' : 'standard',
        currency,
        with_labels: withLabels,
        fulfillment_type: fulfillmentType,
        shipping_address:
          mode === 'create' && fulfillmentType === 'shipment' ? shipAddr : null,
        notes: notes || null,
        // The full roster (up to five), primary first. The legacy single-person
        // pair still rides along so an older API build keeps working.
        sales_people: seatedTeam.map((seat) => ({
          sales_person_id: seat.person!.id,
          commission_rate: seat.rate ?? 0,
        })),
        sales_person_id: seatedTeam[0]?.person?.id ?? null,
        sales_person_commission_rate: seatedTeam[0]?.rate ?? 0,
        // Only ask the server to create the shipment when the live check says
        // it's ready — an unready opt-in resolves to "invoice only".
        create_easyship_shipment: easyshipReady,
        easyship_courier_id: easyshipReady ? (easyshipCourierId || null) : null,
        easyship_buy_label: easyshipReady ? easyshipBuyLabel : false,
        easyship_insured: easyshipReady ? easyshipInsured : false,
        easyship_handover: easyshipReady ? easyshipHandover : null,
        // Client shipment (Packing List flow): ship to a saved or new client.
        ships_to_client: clientScenarioActive,
        client_id: clientScenarioActive && clientMode === 'select' ? selectedClientId : null,
        client: clientScenarioActive && clientMode === 'new' ? resolveNewClient() : null,
        // Force the whole order onto one invoice, skipping the backorder split,
        // when the admin overrode the shortfall in the backorder dialog.
        override_backorder: overrideBackorderNow,
        line_items: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            product_id: l.product_id,
            description: l.description.trim(),
            qty: Math.max(1, l.qty ?? 1),
            unit_price: l.unit_price ?? 0,
            discount_pct: l.discount_pct ?? 0,
            price_type: l.price_type,
            // Only meaningful for prepaid invoices; harmless (null) otherwise.
            preferred_supplier_id: isPrepaid ? (l.preferred_supplier_id ?? null) : null,
          })),
      };

      if (mode === 'create') {
        const result = await createInvoice(payload);
        // Remember the label choice on the customer for next time (non-fatal).
        await rememberLabelPreference();
        // Remember the sales person on the customer for next time (non-fatal).
        await rememberSalesPersonPreference();
        // Persist the entered line prices to the customer's price list when the
        // admin opted in. Non-fatal — the invoice already exists, so a failure
        // surfaces a notice rather than blocking navigation.
        if (customer && pendingPriceSavesRef.current.length > 0) {
          const failed = await savePricesToCustomer(customer.id, pendingPriceSavesRef.current);
          if (failed > 0) {
            alert(
              `Invoice created, but ${failed} price${failed !== 1 ? 's' : ''} could not be saved to ${customer.first_name ?? 'the customer'}'s price list.`,
            );
          }
          pendingPriceSavesRef.current = [];
        }
        // Opt-in email: only when the admin ticked "Email to customer" and this
        // is a finalized (non-draft) invoice. Failures here are non-fatal — the
        // invoice already exists, so we surface a notice rather than block.
        let mailError: string | null = null;
        if (emailOnCreate && action === 'sent') {
          const recipient = (customer?.email ?? shipAddr.email ?? '').trim();
          try {
            if (!recipient) throw new Error('no recipient email on file');
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`/api/admin/invoices/${result.invoice.id}/email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({ to: recipient }),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              throw new Error(d.error || `send failed (${res.status})`);
            }
          } catch (mailErr: any) {
            mailError = mailErr?.message ?? 'Could not email the invoice';
          }
        }
        if (mailError) {
          // Non-fatal: the invoice exists, only the email failed. Tell the admin
          // before navigating so they can resend from the invoice page.
          alert(`Invoice created, but the email could not be sent: ${mailError}`);
        }
        if (result.split && result.backorder_invoice) {
          // Some quantities exceeded stock: the order was split into an in-stock
          // invoice and a backorder invoice. Send the admin to the Backorders tab
          // where the exceeding-qty invoice now appears for fulfilment.
          router.push('/admin/backorders');
        } else {
          router.push(`/admin/invoices/${result.invoice.id}`);
        }
      } else if (invoiceId) {
        await replaceInvoice(invoiceId, payload);
        // Remember the label choice on the customer for next time (non-fatal).
        await rememberLabelPreference();
        // Remember the sales person on the customer for next time (non-fatal).
        await rememberSalesPersonPreference();
        router.push(`/admin/invoices/${invoiceId}`);
      }
    } catch (e: any) {
      setError(e.message ?? 'Could not save');
      setSubmitting(false);
    }
  };

  // ---- render -------------------------------------------------------------
  const fld = 'w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40';

  return (
    <div className="grid lg:grid-cols-3 gap-6 items-start">
      {/* LEFT (2 cols) */}
      <div className="lg:col-span-2 space-y-6">
        {/* Invoice details */}
        <Card title="Invoice Details" icon={User}>
          <div className="space-y-4">
            {/* Customer picker */}
            <div ref={customerBoxRef}>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Customer</label>
              {customer ? (
                <div className="flex items-center justify-between gap-3 p-3 bg-vital/5 border border-vital/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-vital/10 text-vital flex items-center justify-center">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        {customer.first_name} {customer.last_name}
                      </div>
                      <div className="text-xs text-ink-muted">{customer.email}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                      Linked
                    </span>
                  </div>
                  <button onClick={clearCustomer} className="text-xs text-ink-muted hover:text-ink">Change</button>
                </div>
              ) : (
                <div>
                  {/* Keep the icon + input + dropdown in their own relative box
                      so the icon's top-1/2 centering references the input only,
                      not the taller container that also holds the hint below. */}
                  <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="text"
                    value={customerQuery}
                    onFocus={() => setCustomerOpen(true)}
                    onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                    placeholder="Search customers or type a name for a guest invoice..."
                    className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                  {customerOpen && (customerResults.length > 0 || customerQuery.trim()) && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-72 overflow-auto">
                      {customerResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => pickCustomer(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-surface text-sm border-b border-line/50 last:border-0"
                        >
                          <div className="font-medium text-ink">{c.first_name} {c.last_name}</div>
                          <div className="text-xs text-ink-muted">{c.email}</div>
                        </button>
                      ))}
                      {customerQuery.trim() && (
                        <button
                          onClick={() => openNewCustomerModal()}
                          className="w-full text-left px-4 py-2.5 hover:bg-vital/5 text-sm flex items-center gap-2 text-vital border-t border-line/50"
                        >
                          <UserPlus className="w-4 h-4" /> Create new customer "{customerQuery.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                  </div>
                  {trimmedCustomerQuery && !customer && (
                    exactMatches.length === 1 ? (
                      // Exactly one account with this name/email already exists —
                      // nudge the admin to reuse it instead of spawning a duplicate.
                      <div className="mt-1.5 flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs">
                        <User className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
                        <div className="text-emerald-800">
                          An account for{' '}
                          <span className="font-semibold">
                            {exactMatches[0].first_name} {exactMatches[0].last_name}
                          </span>{' '}
                          already exists{customerEmailHint(exactMatches[0])}.{' '}
                          <button
                            type="button"
                            onClick={() => pickCustomer(exactMatches[0])}
                            className="font-semibold text-emerald-700 underline hover:text-emerald-900"
                          >
                            Use existing record
                          </button>
                        </div>
                      </div>
                    ) : exactMatches.length > 1 ? (
                      // Several people share this exact name — don't guess. List
                      // them so the admin links the right one.
                      <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                        <div className="flex items-start gap-2 text-amber-800">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                          <div>
                            <span className="font-semibold">{exactMatches.length} accounts</span>{' '}
                            named &quot;{trimmedCustomerQuery}&quot; already exist — pick the right one:
                          </div>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {exactMatches.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => pickCustomer(c)}
                              className="w-full text-left px-2 py-1 rounded bg-white border border-amber-200 hover:border-amber-400"
                            >
                              <span className="font-medium text-ink">{c.first_name} {c.last_name}</span>
                              <span className="text-ink-muted">
                                {' '}— {c.email && !c.email.endsWith('@aminocan.local') ? c.email : 'no email'}
                                {c.phone ? ` · ${c.phone}` : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      // No match — this looks like a brand-new account. Offer to
                      // capture the optional phone + address up front.
                      <div className="mt-1.5 flex items-start gap-2 px-3 py-2 bg-vital/5 border border-vital/20 rounded-lg text-xs">
                        <UserPlus className="w-4 h-4 mt-0.5 flex-shrink-0 text-vital" />
                        <div className="text-ink-muted">
                          <span className="text-ink">&quot;{trimmedCustomerQuery}&quot;</span>{' '}
                          looks like a new account — it&apos;ll be saved as a guest customer.{' '}
                          <button
                            type="button"
                            onClick={() => openNewCustomerModal({ isNewAccount: true })}
                            className="font-semibold text-vital underline hover:text-vital/80"
                          >
                            Add phone &amp; address (optional)
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Issue Date">
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className={fld}
                />
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={fld}
                />
              </Field>
            </div>

            {/* Fulfillment method — tells the warehouse whether to ship or hold
                for pickup. */}
            <Field label="Fulfillment">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'shipment', label: 'Shipment', icon: Truck },
                  { value: 'pickup', label: 'Self-Pickup', icon: Store },
                ] as const).map(({ value, label, icon: Icon }) => {
                  const active = fulfillmentType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFulfillmentType(value)}
                      className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-ink text-white border-ink'
                          : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                      }`}
                    >
                      <Icon className="w-4 h-4" /> {label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Price list — which list drives the line prices. Defaults to the
                globally active list; "Website Pricing" falls back to the catalog
                (products table). Switching re-prices every product-bound line.
                Hidden for affiliates — their lines always price from their own
                customer pricing. */}
            {!isAffiliate && (
            <Field
              label="Price List"
              hint={
                <InfoHint
                  side="right"
                  content={
                    <span className="block space-y-1.5">
                      <span className="block font-semibold">Pricing priority</span>
                      <span className="block leading-relaxed">
                        1. The customer&rsquo;s dedicated price list<br />
                        2. The price list selected here<br />
                        3. Website Pricing (catalog default)
                      </span>
                      <span className="block pt-1.5 border-t border-white/15 text-white/80 leading-relaxed">
                        Line items are saved as a snapshot on this invoice — editing a
                        product&rsquo;s catalog price or a price list later won&rsquo;t change
                        anything already on it.
                      </span>
                    </span>
                  }
                />
              }
            >
              {/* 70 / 30 control row: the selector on the left, the gap-fill
                  toggle on the right. The toggle only appears when the customer
                  has a dedicated list AND a real list is picked to fill gaps from
                  (Website Pricing has nothing to fill); otherwise the selector
                  takes the full width. Its "gaps" explanation lives in the hover
                  tooltip so the row stays clean. */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative sm:flex-[7] min-w-0">
                  <Layers className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <select
                    value={selectedPricelistId}
                    onChange={(e) => void changePricelist(e.target.value)}
                    disabled={pricelistsInitializing || pricelistLoading}
                    className="w-full appearance-none pl-9 pr-9 py-2.5 rounded-lg text-sm font-medium border border-line bg-surface text-ink hover:border-ink/20 focus:border-vital focus:outline-none disabled:opacity-60 disabled:cursor-wait"
                  >
                    <option value={DEFAULT_PRICELIST_ID}>
                      Website Pricing (default catalog price)
                    </option>
                    {allPricelists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                        {pl.currency === 'USD' ? ' · USD' : ''}
                        {pl.id === activePricelistId ? ' · Active' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted text-xs">
                    {pricelistsInitializing || pricelistLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '▾'}
                  </span>
                </div>
                {hasCustomerPricelist &&
                  !pricelistsInitializing &&
                  selectedPricelistId !== DEFAULT_PRICELIST_ID && (
                  <div className="sm:flex-[3] min-w-0">
                    <Tooltip
                      side="top"
                      className="w-full"
                      content={
                        <span>
                          Gaps — products{' '}
                          <span className="font-semibold">{customerFullName || 'the customer'}</span>&rsquo;s list
                          doesn&rsquo;t price —{' '}
                          {fillGapsFromList ? (
                            <>fill from <span className="font-semibold">{selectedListLabel}</span>.</>
                          ) : (
                            <>use <span className="font-semibold">Website Pricing (catalog)</span>.</>
                          )}{' '}
                          Their own prices always win.
                        </span>
                      }
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={fillGapsFromList}
                        aria-label="Fill gaps from the selected price list"
                        onClick={() => changeFillGaps(!fillGapsFromList)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                          fillGapsFromList
                            ? 'bg-vital/5 text-ink border-vital/40'
                            : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Layers className={`w-4 h-4 flex-shrink-0 ${fillGapsFromList ? 'text-vital' : 'text-ink-muted'}`} />
                          <span className="truncate">Fill gaps</span>
                        </span>
                        <span
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                            fillGapsFromList ? 'bg-vital' : 'bg-line'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              fillGapsFromList ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
              {/* Status row: the list currently filling prices, plus compact
                  tags. The "Customer price list" tag is active (vital) when the
                  linked customer has their own list, greyed otherwise; the detail
                  lives in its hover tooltip so the panel stays uncluttered. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                {pricelistsInitializing ? (
                  <span className="inline-flex items-center gap-1 text-ink-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading price lists…
                  </span>
                ) : pricelistLoading ? (
                  <span className="inline-flex items-center gap-1 text-ink-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading prices…
                  </span>
                ) : (
                  <>
                    <span className="text-ink-muted">
                      Fills from{' '}
                      <span className="font-medium text-ink">{selectedListLabel}</span>
                    </span>
                    {customer && (
                      <Tooltip
                        side="top"
                        content={
                          hasCustomerPricelist ? (
                            <span>
                              <span className="font-semibold">{customerFullName}</span> has a dedicated
                              price list — those prices take priority. The list above only fills in
                              products their list doesn&rsquo;t price.
                            </span>
                          ) : (
                            <span>
                              <span className="font-semibold">{customerFullName}</span> has no dedicated
                              price list, so every line prices from the selected list, then Website
                              Pricing (catalog).
                            </span>
                          )
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border cursor-help transition-colors ${
                            hasCustomerPricelist
                              ? 'bg-vital/10 text-vital border-vital/30'
                              : 'bg-surface text-ink-muted/60 border-line'
                          }`}
                        >
                          <Tag className="w-3 h-3" />
                          Customer price list
                          {hasCustomerPricelist && <Check className="w-3 h-3" />}
                        </span>
                      </Tooltip>
                    )}
                    {selectedPricelistId !== DEFAULT_PRICELIST_ID &&
                      selectedPricelistId === activePricelistId && (
                        <Tooltip
                          side="top"
                          content={
                            <span className="block space-y-1.5">
                              <span className="block font-semibold">Why this is preselected</span>
                              <span className="block leading-relaxed">
                                It&rsquo;s the <span className="font-semibold">active price list</span> — the
                                default for new invoices. Change which list is active under{' '}
                                <span className="font-semibold">Pricing → Price Lists</span>. Pick another list
                                above to use it for this invoice only.
                              </span>
                            </span>
                          }
                        >
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-help">
                            <Check className="w-3 h-3" /> Active
                          </span>
                        </Tooltip>
                      )}
                    {pricelist.currency === 'USD' && selectedPricelistId !== DEFAULT_PRICELIST_ID && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <DollarSign className="w-3 h-3" /> USD as-is
                      </span>
                    )}
                  </>
                )}
              </div>
            </Field>
            )}

            {/* Affiliate: the price list is shown but LOCKED — their lines
                always price from the list an admin assigned them. A badge marks
                whether that's a shared template or a dedicated list. */}
            {isAffiliate && (
            <Field
              label="Price List"
              hint={
                <InfoHint
                  side="right"
                  content={
                    <span className="block space-y-1.5">
                      <span className="block font-semibold">How your invoices are priced</span>
                      <span className="block leading-relaxed">
                        Every line prices from the price list an admin assigned you. You
                        can apply a discount, but the unit price is locked.
                      </span>
                      <span className="block pt-1.5 border-t border-white/15 text-white/80 leading-relaxed">
                        Line items are saved as a snapshot on this invoice — a later price
                        change won&rsquo;t change anything already on it.
                      </span>
                    </span>
                  }
                />
              }
            >
              {!affiliatePricingLoaded ? (
                <>
                  <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-line bg-surface text-ink-muted">
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    <span>Loading price list…</span>
                    <span className="ml-auto h-4 w-16 rounded-full bg-line/60 animate-pulse" />
                  </div>
                  <p className="mt-1 h-3 w-2/3 rounded bg-line/50 animate-pulse" />
                </>
              ) : (
                <>
                  <div
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-line bg-surface cursor-not-allowed"
                    title="Your prices come from the price list an admin assigned you. This can’t be changed here."
                  >
                    <Layers className="w-4 h-4 text-ink-muted flex-shrink-0" />
                    <span className="font-medium text-ink truncate">
                      {affiliatePricingMode === 'dedicated'
                        ? 'Dedicated price list'
                        : affiliatePricelistName ?? 'Standard pricing'}
                    </span>
                    {affiliatePricingMode === 'dedicated' ? (
                      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-vital/10 text-vital">
                        <Tag className="w-3 h-3" /> Dedicated
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">
                        <Layers className="w-3 h-3" /> Template
                      </span>
                    )}
                    <Lock className="w-3.5 h-3.5 text-ink-muted flex-shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {affiliatePricingMode === 'dedicated' ? (
                      'Your invoices use a dedicated price list set for your account. Prices are locked and set by an admin.'
                    ) : affiliatePricelistName ? (
                      <>
                        Your invoices follow the{' '}
                        <span className="font-medium text-ink">{affiliatePricelistName}</span> template.
                        Prices are locked and set by an admin.
                      </>
                    ) : (
                      'Your invoices use the standard price list. Prices are locked and set by an admin.'
                    )}
                  </p>
                </>
              )}
            </Field>
            )}

            {/* Currency + labels markings ----------------------------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Currency — which currency the invoice is paid in. Switching
                  re-prices product-bound lines to the catalog price in that
                  currency (CAD base, or CAD × rate / product USD price). Hidden
                  for affiliates — locked to their own record's currency. */}
              {!isAffiliate && (
              <Field label="Paid In">
                <div className="grid grid-cols-2 gap-2">
                  {(['CAD', 'USD'] as const).map((cur) => {
                    const active = currency === cur;
                    return (
                      <button
                        key={cur}
                        type="button"
                        onClick={() => changeCurrency(cur)}
                        aria-pressed={active}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          active
                            ? 'bg-ink text-white border-ink'
                            : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                        }`}
                      >
                        <span className="font-semibold">$</span> {cur}
                      </button>
                    );
                  })}
                </div>
              </Field>
              )}

              {/* Affiliate: currency is shown but LOCKED to their account's
                  configured currency — they can't switch what they're paid in. */}
              {isAffiliate && (
              <Field label="Paid In">
                {/* Only new invoices flash (currency defaults to USD then locks
                    to the affiliate's own); edits already know it from initial. */}
                {mode === 'create' && !affiliateCurrencyLoaded ? (
                  <>
                    <div className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-line bg-surface text-ink-muted">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Loading currency…</span>
                    </div>
                    <p className="mt-1 h-3 w-1/2 rounded bg-line/50 animate-pulse" />
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {(['CAD', 'USD'] as const).map((cur) => {
                        const active = currency === cur;
                        return (
                          <div
                            key={cur}
                            title="Locked to your account currency — set by an admin."
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border cursor-not-allowed ${
                              active
                                ? 'bg-ink text-white border-ink'
                                : 'bg-surface text-ink-muted/50 border-line'
                            }`}
                          >
                            <span className="font-semibold">$</span> {cur}
                            {active && <Lock className="w-3 h-3" />}
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Locked to your account currency.
                    </p>
                  </>
                )}
              </Field>
              )}

              {/* Labels — with/without labels. Also switches product lines
                  between the labeled and unlabeled price (unlabeled falls back to
                  the labeled price when a product has no separate unlabeled one). */}
              <Field label="Labels">
                <button
                  type="button"
                  role="switch"
                  aria-checked={withLabels}
                  onClick={() => changeLabels(!withLabels)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    withLabels
                      ? 'bg-vital/5 text-ink border-vital/40'
                      : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Tag className={`w-4 h-4 ${withLabels ? 'text-vital' : 'text-ink-muted'}`} />
                    {withLabels ? 'With labels' : 'Without labels'}
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                      withLabels ? 'bg-vital' : 'bg-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        withLabels ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
                <p className="mt-1 text-xs text-ink-muted">
                  Switches product lines between the labeled and unlabeled price.
                  Manually edited prices aren&apos;t changed.
                </p>
                {/* Warn when "Without labels" is selected but the chosen price
                    list carries no separate unlabeled prices — lines keep the
                    labeled price. (The USD Wholesale Pricelist has none.) */}
                {!withLabels && Object.keys(pricelist.unlabeled).length === 0 && (
                  <p
                    className="mt-1 text-xs text-amber-700 flex items-start gap-1.5"
                    title="This price list has no separate unlabeled prices. Each line keeps its labeled price until an unlabeled price is added to the list."
                  >
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      This price list has no unlabeled prices — lines use the
                      labeled price as-is.
                    </span>
                  </p>
                )}
              </Field>
            </div>

            {/* Shipping destination — seeds the order created from this invoice
                so a shipping label can be generated. Shown for shipments only. */}
            {mode === 'create' && fulfillmentType === 'shipment' && (
              <div className="rounded-lg border border-line bg-surface/50 p-3 space-y-3">
                {/* Header — clickable to collapse/expand only while shipping to a
                    client, where these fields become customer-only (the parcel
                    goes to the client instead). A hover tooltip explains that. */}
                <button
                  type="button"
                  onClick={() => clientScenarioActive && setShipToCollapsed((v) => !v)}
                  title={
                    clientScenarioActive
                      ? 'This order ships to the selected client, so these fields aren’t used for the shipment — they’re just for viewing or editing the customer’s own contact details on file.'
                      : undefined
                  }
                  className={`w-full flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted ${
                    clientScenarioActive ? 'cursor-help' : 'cursor-default'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    Ship to
                    {clientScenarioActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-vital/10 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-vital">
                        <Info className="w-2.5 h-2.5" /> Customer details only
                      </span>
                    )}
                  </span>
                  {clientScenarioActive && (
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 transition-transform ${shipToCollapsed ? '-rotate-90' : ''}`}
                    />
                  )}
                </button>
                {clientScenarioActive && shipToCollapsed && (
                  <p className="text-[11px] text-ink-muted">
                    Shipment goes to the selected client. Expand to view or edit the
                    customer&apos;s own details on file.
                  </p>
                )}
                {!(clientScenarioActive && shipToCollapsed) && (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={shipAddr.firstName} onChange={(e) => setShipAddr({ ...shipAddr, firstName: e.target.value })} placeholder="First name" className={fld} />
                  <input value={shipAddr.lastName} onChange={(e) => setShipAddr({ ...shipAddr, lastName: e.target.value })} placeholder="Last name" className={fld} />
                </div>
                <AddressAutocomplete
                  value={shipAddr.address}
                  onChange={(street) => setShipAddr((d) => ({ ...d, address: street }))}
                  onSelect={(addr) => setShipAddr((d) => ({
                    ...d,
                    address: addr.line1 || d.address,
                    city: addr.city || d.city,
                    state: addr.state || d.state,
                    postalCode: addr.postalCode || d.postalCode,
                    country: addr.country || d.country,
                  }))}
                  placeholder="Start typing the address…"
                  className={fld}
                />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input value={shipAddr.city} onChange={(e) => setShipAddr({ ...shipAddr, city: e.target.value })} placeholder="City" className={fld} />
                  <input value={shipAddr.state} onChange={(e) => setShipAddr({ ...shipAddr, state: e.target.value })} placeholder="Prov/State" className={fld} />
                  <input value={shipAddr.postalCode} onChange={(e) => setShipAddr({ ...shipAddr, postalCode: e.target.value })} placeholder="Postal" className={fld} />
                  <input value={shipAddr.country} onChange={(e) => setShipAddr({ ...shipAddr, country: e.target.value })} placeholder="Country" className={fld} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={shipAddr.phone} onChange={(e) => setShipAddr({ ...shipAddr, phone: e.target.value })} placeholder="Phone (for the courier)" className={fld} />
                  <input type="email" value={shipAddr.email} onChange={(e) => setShipAddr({ ...shipAddr, email: e.target.value })} placeholder="Email (for tracking)" className={fld} />
                </div>
                <p className="text-[11px] text-ink-muted">
                  Optional now — you can complete it later from the order&apos;s Shipping Label panel.
                  {' '}Phone &amp; email are optional; a house default is used for the Easyship label
                  when they&apos;re left blank.
                </p>

                {/* Offer to save the Ship to details onto the customer profile
                    — backfilling an empty record or updating a changed one. */}
                {customer && shipDiffersFromCustomer && !shipToSaved && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-vital/5 border border-vital/20 rounded-lg text-xs">
                    <span className="text-ink-muted">
                      {customerHadShipOnFile ? (
                        <>
                          This differs from{' '}
                          <span className="text-ink font-medium">{customer.first_name}</span>&apos;s
                          saved details. Update their profile?
                        </>
                      ) : (
                        <>
                          <span className="text-ink font-medium">{customer.first_name}</span> has no
                          address/phone on file. Save these for next time?
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={saveShipToCustomer}
                      disabled={savingShipTo}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-vital/10 text-vital font-medium hover:bg-vital/20 disabled:opacity-50"
                    >
                      {savingShipTo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {customerHadShipOnFile ? 'Update profile' : 'Save to profile'}
                    </button>
                  </div>
                )}
                {shipToSaved && (
                  <p className="text-[11px] text-emerald-600 inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Saved to {customer?.first_name ?? 'customer'}&apos;s profile.
                  </p>
                )}
                </>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Ships to a client — this order's items ship to the customer's client,
            who receives only a Packing List. Shipment only (create + edit).
            Not available to affiliates. */}
        {fulfillmentType === 'shipment' && !isAffiliate && (
          <Card title="Ships to a Client" icon={Users}>
            <div className="space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={shipsToClient}
                onClick={() => setShipsToClient((v) => !v)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  shipsToClient
                    ? 'bg-vital/5 text-ink border-vital/40'
                    : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                }`}
              >
                <span className="flex items-center gap-2 text-left">
                  <Users className={`w-4 h-4 flex-shrink-0 ${shipsToClient ? 'text-vital' : 'text-ink-muted'}`} />
                  <span>
                    Items ship to the customer&apos;s client
                    <span className="block text-[11px] font-normal text-ink-muted">
                      The client gets a Packing List (no pricing); the customer is still billed.
                    </span>
                  </span>
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    shipsToClient ? 'bg-vital' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      shipsToClient ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              {shipsToClient && !customer && (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>Link a customer first — clients are saved per customer.</span>
                </div>
              )}

              {shipsToClient && customer && (
                <div className="rounded-lg border border-line bg-surface/50 p-3 space-y-3">
                  {/* Mode switch — only offer "existing" when the customer has
                      saved clients. */}
                  {clientList.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: 'select', label: 'Saved client', icon: Users },
                        { value: 'new', label: 'New client', icon: UserPlus },
                      ] as const).map(({ value, label, icon: Icon }) => {
                        const active = clientMode === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setClientMode(value)}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-ink text-white border-ink'
                                : 'bg-white text-ink-muted border-line hover:border-ink/20'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {clientsLoading && (
                    <p className="text-xs text-ink-muted inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading clients…
                    </p>
                  )}

                  {/* Existing client picker */}
                  {clientMode === 'select' && clientList.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                        <input
                          type="text"
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Search saved clients…"
                          className="w-full pl-10 pr-4 py-2 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                      </div>
                      <div className="space-y-1.5 max-h-56 overflow-auto">
                        {filteredClientList.map((c) => {
                          const selected = selectedClientId === c.id;
                          const name = clientName(c);
                          return (
                            <div
                              key={c.id}
                              className={`flex items-stretch gap-1 w-full rounded-lg border text-sm transition-colors ${
                                selected
                                  ? 'border-vital bg-vital/5'
                                  : 'border-line bg-white hover:border-ink/20'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedClientId(c.id)}
                                className="flex-1 min-w-0 text-left px-3 py-2 rounded-l-lg"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-ink">{name}</span>
                                  {selected && <Check className="w-4 h-4 text-vital flex-shrink-0" />}
                                </div>
                                <div className="text-xs text-ink-muted">
                                  {[c.address, c.city, c.state, c.postal_code].filter(Boolean).join(', ')}
                                </div>
                                <div className="text-[11px] text-ink-muted">
                                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                                </div>
                              </button>
                              {/* Fix a saved client in place — the edit is written
                                  to their address book, not just this invoice. */}
                              <button
                                type="button"
                                onClick={() => openEditClient(c)}
                                title={`Edit ${name}`}
                                aria-label={`Edit ${name}`}
                                className="flex-shrink-0 self-start mt-1.5 ml-1.5 p-1.5 rounded-md text-ink-muted hover:text-vital hover:bg-vital/10 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {/* Drop a client from the address book (a duplicate
                                  or a typo'd row). Confirmed in a modal, and the
                                  API refuses while an invoice still ships to them. */}
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteClientError(null);
                                  setDeleteClient(c);
                                }}
                                title={`Delete ${name}`}
                                aria-label={`Delete ${name}`}
                                className="flex-shrink-0 self-start mt-1.5 mr-1.5 ml-0.5 p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {filteredClientList.length === 0 && (
                          <p className="text-xs text-ink-muted px-1 py-2">
                            No saved clients match “{clientSearch.trim()}”.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* New client form — address required */}
                  {clientMode === 'new' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input value={newClient.first_name} onChange={(e) => setNewClient({ ...newClient, first_name: e.target.value })} placeholder="First name" className={fld} />
                        <input value={newClient.last_name} onChange={(e) => setNewClient({ ...newClient, last_name: e.target.value })} placeholder="Last name" className={fld} />
                      </div>
                      <AddressAutocomplete
                        value={newClient.address}
                        onChange={(street) => setNewClient((c) => ({ ...c, address: street }))}
                        onSelect={(addr) => setNewClient((c) => ({
                          ...c,
                          address: addr.line1 || c.address,
                          city: addr.city || c.city,
                          state: addr.state || c.state,
                          postal_code: addr.postalCode || c.postal_code,
                          country: addr.country || c.country,
                        }))}
                        placeholder="Client address (required)…"
                        className={fld}
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <input value={newClient.city} onChange={(e) => setNewClient({ ...newClient, city: e.target.value })} placeholder="City" className={fld} />
                        <input value={newClient.state} onChange={(e) => setNewClient({ ...newClient, state: e.target.value })} placeholder="Prov/State" className={fld} />
                        <input value={newClient.postal_code} onChange={(e) => setNewClient({ ...newClient, postal_code: e.target.value })} placeholder="Postal" className={fld} />
                        <input value={newClient.country} onChange={(e) => setNewClient({ ...newClient, country: e.target.value })} placeholder="Country" className={fld} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} placeholder="Phone (optional)" className={fld} />
                        <input type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} placeholder="Email (optional)" className={fld} />
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        Only the address is required. If phone or email is blank we&apos;ll ask whether
                        to use the customer&apos;s contact or a default when you save.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Sales team — up to five people, each on their own commission rate.
            Rates are independent, not slices of one pot: everyone earns
            `total x their own rate`. Seat 0 is the primary and is what lands in
            the invoice's sales_person_id. */}
        <Card title={salesTeam.length > 1 ? 'Sales People' : 'Sales Person'} icon={Briefcase}>
          <div ref={spBoxRef} className="space-y-2.5">
            {salesTeam.map((seat, index) => {
              const searching = spSeatKey === seat.key;
              const amount = seatCommission(seat);
              return (
                <div key={seat.key} className="rounded-lg border border-line bg-surface/40 p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {seat.person ? (
                        <div className="flex items-center justify-between gap-3 p-2.5 bg-purple-50 border border-purple-200 rounded-lg">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                              <Briefcase className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-ink truncate">
                                {seat.person.first_name} {seat.person.last_name}
                                {index === 0 && salesTeam.length > 1 && (
                                  <span className="ml-1.5 text-[10px] font-medium text-purple-600 uppercase tracking-wide">
                                    primary
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-purple-600 tabular-nums">
                                Commission ${amount.toFixed(2)} ({seat.rate ?? 0}%)
                              </div>
                            </div>
                          </div>
                          {salesLocked ? (
                            <span className="text-xs text-purple-600 font-medium shrink-0">You</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => clearSalesSeat(seat.key)}
                              className="text-xs text-ink-muted hover:text-ink shrink-0"
                            >
                              Change
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                          <input
                            type="text"
                            value={searching ? spQuery : ''}
                            onFocus={() => { setSpSeatKey(seat.key); setSpOpen(true); }}
                            onChange={(e) => {
                              setSpSeatKey(seat.key);
                              setSpQuery(e.target.value);
                              setSpOpen(true);
                            }}
                            placeholder={index === 0 ? 'Search salespeople...' : 'Search another salesperson...'}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                          />
                          {searching && spOpen && (spResults.length > 0 || spQuery.trim()) && (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-72 overflow-auto">
                              {spResults.map((sp) => (
                                <button
                                  key={sp.id}
                                  type="button"
                                  onClick={() => pickSalesPerson(seat.key, sp)}
                                  className="w-full text-left px-4 py-2.5 hover:bg-surface text-sm border-b border-line/50 last:border-0"
                                >
                                  <div className="font-medium text-ink">{sp.first_name} {sp.last_name}</div>
                                  <div className="text-xs text-ink-muted">{sp.email ?? '—'} · {sp.commission_rate}%</div>
                                </button>
                              ))}
                              {spQuery.trim() && (
                                <button
                                  type="button"
                                  onClick={openNewSpModal}
                                  className="w-full text-left px-4 py-2.5 hover:bg-purple-50 text-sm flex items-center gap-2 text-purple-600 border-t border-line/50"
                                >
                                  <Plus className="w-4 h-4" /> Create new salesperson &quot;{spQuery.trim()}&quot;
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Remove this seat. Hidden while the attribution is locked
                        to the affiliate, and on a lone empty seat (there'd be
                        nothing left to type into). */}
                    {!salesLocked && (salesTeam.length > 1 || seat.person) && (
                      <button
                        type="button"
                        onClick={() => removeSalesSeat(seat.key)}
                        title="Remove this sales person"
                        aria-label="Remove this sales person"
                        className="mt-2 p-1.5 rounded-lg text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                    <Field label="Commission %">
                      <NumberInput
                        min={0}
                        max={100}
                        step="0.01"
                        placeholder="0"
                        value={seat.rate}
                        onChange={(v) => setSeatRate(seat.key, v)}
                        disabled={salesLocked}
                        readOnly={salesLocked}
                        title={salesLocked ? 'Your commission rate is set by an administrator and cannot be changed.' : undefined}
                        className={`${fld}${salesLocked ? ' bg-surface text-ink-muted cursor-not-allowed' : ''}`}
                      />
                      {salesLocked && (
                        <p className="mt-1 text-[11px] text-ink-muted">Set by your administrator.</p>
                      )}
                    </Field>
                    <Field label="Commission $">
                      <div className="px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted tabular-nums">
                        ${amount.toFixed(2)}
                      </div>
                    </Field>
                  </div>
                </div>
              );
            })}

            {/* Add another. Capped at five — the same cap the database enforces. */}
            {!salesLocked && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={addSalesSeat}
                  disabled={salesTeam.length >= MAX_SALES_PEOPLE}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-line text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" /> Add sales person
                </button>
                <span className="text-[11px] text-ink-muted">
                  {salesTeam.length >= MAX_SALES_PEOPLE
                    ? `Maximum ${MAX_SALES_PEOPLE} sales people per invoice.`
                    : `Up to ${MAX_SALES_PEOPLE}. Each earns their own % of the invoice total.`}
                </span>
              </div>
            )}

            {seatedTeam.length > 1 && (
              <div className="flex items-baseline justify-between gap-3 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200">
                <span className="text-xs font-medium text-ink">
                  Total commission · {seatedTeam.length} people
                </span>
                <span className="text-sm font-bold text-purple-600 tabular-nums">
                  ${commissionAmount.toFixed(2)}
                </span>
              </div>
            )}

            {/* Remember this sales team on the customer so their next invoice
                auto-fills it. Only offered when a customer + at least one sales
                person are both selected and the attribution isn't affiliate-locked. */}
            {customer && seatedTeam.length > 0 && !salesLocked && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveSalesPersonToCustomer}
                  onChange={(e) => setSaveSalesPersonToCustomer(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line text-purple-600 focus:ring-purple-500/40"
                />
                <span className="text-xs text-ink-muted leading-relaxed">
                  Save {seatedTeam.length > 1 ? 'these sales people' : 'this sales person'} (and their
                  commission {seatedTeam.length > 1 ? 'rates' : 'rate'}) to{' '}
                  <span className="font-medium text-ink">{customer.first_name} {customer.last_name}</span>
                  {' '}so their future invoices auto-fill{' '}
                  {seatedTeam.length > 1 ? 'them' : 'it'}. Replaces the sales team currently saved on
                  the customer.
                </span>
              </label>
            )}
          </div>
        </Card>

        {/* Line items */}
        <Card title="Line Items">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap -mt-1">
              <div className="text-xs text-ink-muted">
                {isAffiliate ? (
                  <>Prices come from <span className="font-medium text-vital">your assigned price list</span> (set by an admin in Pricing). You can apply a discount, but not change the unit price.</>
                ) : customer && Object.keys(customerPrices).length > 0 ? (
                  <>Prices default from <span className="font-medium text-vital">{customer.first_name} {customer.last_name}</span>&rsquo;s price list (editable per line).</>
                ) : pricelist.pricelist ? (
                  <>Prices default from active pricelist <span className="font-medium text-vital">{pricelist.pricelist.name}</span> (editable per line).</>
                ) : (
                  <>No active pricelist — using product default prices.</>
                )}
              </div>
              {/* Bulk discount: apply one % to every line at once. */}
              {lines.length > 1 && (
                <div className="flex items-center gap-1 text-[11px] text-ink-muted">
                  <span className="uppercase tracking-wide mr-0.5">Discount all</span>
                  {QUICK_DISCOUNTS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => applyDiscountToAll(d)}
                      className="px-1.5 py-0.5 rounded border border-line bg-white font-medium text-ink hover:border-vital hover:text-vital"
                    >
                      {d}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => applyDiscountToAll(0)}
                    className="px-1.5 py-0.5 rounded border border-line bg-white font-medium text-ink-muted hover:border-ink/30"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {lines.map((line, idx) => {
              const stock = line.stock_quantity ??
                (line.product_id ? products.find((p) => p.id === line.product_id)?.stock_quantity : undefined);
              const lineVialsPerBox = line.product_id
                ? products.find((p) => p.id === line.product_id)?.vials_per_box
                : undefined;
              const stockBadge =
                stock === undefined ? null : stock <= 0
                  ? 'bg-red-500/10 text-red-600'
                  : stock < 5
                    ? 'bg-amber-500/10 text-amber-600'
                    : 'bg-emerald-500/10 text-emerald-600';
              // Stock is stored in vials; show it in the line's chosen unit so the
              // figure lines up with the box/vial toggle and the qty below it.
              const stockLabel =
                stock === undefined ? '' : formatStockInUnit(stock, lineVialsPerBox, line.price_type);
              const stockErr = line.product_id ? stockErrors[line.product_id] : undefined;
              // Price-source warning: a real price list is selected but it doesn't
              // carry this product (box lines only — lists store box prices), and
              // no customer override covers it, so the price fell back to Website
              // Pricing (the catalog default). Surface that with a tooltip. Skipped
              // when the admin has deliberately opted out of filling gaps from the
              // selected list (uncovered products use the catalog on purpose then —
              // explained by the note under the Price List selector).
              const usingPricelistFallback =
                !!line.product_id &&
                line.price_type === 'box' &&
                selectedPricelistId !== DEFAULT_PRICELIST_ID &&
                fillGapsFromList &&
                pricelist.prices[line.product_id] == null &&
                !(!ignoreCustomerPrices && customerPrices[line.product_id]);
              const selectedPricelistName =
                allPricelists.find((pl) => pl.id === selectedPricelistId)?.name ?? 'the selected price list';
              return (
                <div key={idx} className="border border-line rounded-lg p-3 bg-surface space-y-2.5">
                  {/* Product / description on its own row with a label, so its
                      input lines up with the numeric fields below (the box/vial
                      toggle used to sit under it and skew the alignment). */}
                  <div className="relative">
                    <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                      Product / description
                    </label>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => {
                        patchLine(idx, { description: e.target.value, product_id: null, stock_quantity: undefined });
                        setActiveLineIdx(idx);
                        setProductSearch(e.target.value);
                      }}
                      onFocus={() => { setActiveLineIdx(idx); setProductSearch(line.description); }}
                      placeholder="Search products or type a description…"
                      className="w-full bg-white border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                    />
                    {activeLineIdx === idx && filteredProducts.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-60 overflow-auto">
                        {filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickProductForLine(idx, p); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface border-b border-line/50 last:border-0"
                          >
                            <div className="text-ink">
                              {p.name}
                              {p.sku && <span className="ml-1.5 font-mono text-xs text-ink-muted">{p.sku}</span>}
                            </div>
                            <div className="text-xs text-ink-muted">
                              {p.strength ?? ''} · ${priceForProduct(p).toFixed(2)} {currency} · stock {p.stock_quantity} vials
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Meta row: box/vial toggle + stock + price-source note.
                      Kept on its own line so it never shifts the field grid. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {/* Box vs vial price toggle. Defaults to box (pack of 10);
                        switching re-prices from the applicable price source. */}
                    <div className="inline-flex rounded-md border border-line overflow-hidden text-[11px]">
                      {(['box', 'vial'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setLinePriceType(idx, t)}
                          className={`px-2.5 py-1 font-medium transition-colors ${
                            line.price_type === t
                              ? t === 'vial'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-ink text-white'
                              : 'bg-white text-ink-muted hover:text-ink'
                          }`}
                          title={t === 'vial' ? 'Price per single vial' : 'Price per pack of 10 (box)'}
                        >
                          {t === 'vial' ? 'Vial' : 'Box'}
                        </button>
                      ))}
                    </div>
                    {stockBadge && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded ${stockBadge}`}>stock: {stockLabel}</span>
                        {stockErr && <span className="text-amber-600">{stockErr}</span>}
                        {isAdmin && line.product_id && (
                          <button
                            type="button"
                            onClick={() => openQuickStock(line.product_id as string, line.description || 'Product', stock ?? 0)}
                            className="inline-flex items-center gap-0.5 text-vital hover:text-vital/80 font-medium"
                            title="Quick edit stock"
                          >
                            <Pencil className="w-3 h-3" /> Quick edit
                          </button>
                        )}
                      </div>
                    )}
                    {usingPricelistFallback && (
                      <div
                        className="inline-flex items-start gap-1.5 text-[11px] text-amber-700 cursor-help"
                        title={`This product isn't in ${selectedPricelistName}. Its price falls back to Website Pricing (the catalog default). Add it to the price list to quote a list price.`}
                      >
                        <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                        <span>Not in {selectedPricelistName} — using Website Pricing</span>
                      </div>
                    )}
                  </div>

                  {/* Numeric row: Qty · Unit $ · Disc % (+ quick chips) · Total.
                      Two columns on mobile so the discount field has room. */}
                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">Qty</label>
                      <NumberInput
                        min={1}
                        placeholder="0"
                        value={line.qty}
                        onChange={(v) => patchLine(idx, { qty: v })}
                        className={`w-full bg-white border ${stockErr ? 'border-amber-400 ring-1 ring-amber-300' : 'border-line'} rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-vital/40`}
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">Unit $</label>
                      <NumberInput
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={line.unit_price}
                        onChange={(v) => patchLine(idx, { unit_price: v })}
                        readOnly={!canEditLinePrices}
                        title={canEditLinePrices ? undefined : 'Only admins can change the unit price. This price comes from your assigned price list.'}
                        className={`w-full border border-line rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-vital/40 ${canEditLinePrices ? 'bg-white' : 'bg-surface text-ink-muted cursor-not-allowed'}`}
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-5">
                      <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">Disc %</label>
                      <div className="flex items-center gap-1.5">
                        <NumberInput
                          min={0}
                          max={100}
                          placeholder="0"
                          value={line.discount_pct}
                          onChange={(v) => setLineDiscount(idx, v)}
                          className="w-14 flex-shrink-0 bg-white border border-line rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                        {/* One-click discount presets. */}
                        <div className="flex items-center gap-1">
                          {QUICK_DISCOUNTS.map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setLineDiscount(idx, d)}
                              title={`Set ${d}% discount`}
                              className={`px-1.5 py-1 rounded border text-[11px] font-medium transition-colors ${
                                (line.discount_pct ?? 0) === d
                                  ? 'border-vital bg-vital/10 text-vital'
                                  : 'border-line bg-white text-ink-muted hover:border-vital hover:text-vital'
                              }`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-ink-muted sm:hidden">Total</span>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">
                          ${((line.qty ?? 0) * (line.unit_price ?? 0) * (1 - (line.discount_pct ?? 0) / 100)).toFixed(2)}
                        </div>
                        <button
                          onClick={() => removeLine(idx)}
                          className="text-ink-muted hover:text-red-500"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              onClick={addLine}
              className="w-full py-2 border border-dashed border-line rounded-lg text-sm text-ink-muted hover:text-vital hover:border-vital flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add another item
            </button>
          </div>
        </Card>

        {/* Prepaid: route each product line to a supplier (cheapest auto, with
            per-line override). The choice is saved with the invoice and drives
            the Supplier Purchase Orders panel on the invoice page. */}
        {isPrepaid && (
          <PrepaidLineSuppliers
            lines={lines}
            products={products}
            currency={currency}
            disabled={submitting}
            onAssign={assignLineSupplier}
          />
        )}

        {/* Notes */}
        <Card title="Notes">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes shown on the invoice (optional)"
            className={fld}
          />
        </Card>
      </div>

      {/* RIGHT (1 col) */}
      <div className="space-y-6">
        {/* Easyship shipment opt-in — sits above the Summary so the chosen
            courier's rate flows straight into the shipping fee below. Shown for
            any shipment invoice that doesn't already have a shipment (pickups
            never ship; an existing shipment is managed from the order's panel).
            Available on create and edit. */}
        {easyshipEligible && (
          <Card title="Easyship Shipment" icon={Package} tight>
            <div className="space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={createEasyship}
                onClick={() => setCreateEasyship((v) => !v)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  createEasyship
                    ? 'bg-vital/5 text-ink border-vital/40'
                    : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                }`}
              >
                <span className="flex items-center gap-2 text-left">
                  <Truck className={`w-4 h-4 flex-shrink-0 ${createEasyship ? 'text-vital' : 'text-ink-muted'}`} />
                  <span>
                    Create shipment record
                    <span className="block text-[11px] font-normal text-ink-muted">
                      Shipment + tracking for this order.
                    </span>
                  </span>
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    createEasyship ? 'bg-vital' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      createEasyship ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              {createEasyship && (
                <div className="rounded-lg border border-line bg-surface/50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                      Readiness
                    </span>
                    {easyshipLoading && !easyshipReadiness ? (
                      <span className="text-xs text-ink-muted inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
                      </span>
                    ) : (
                      // Badge shows ready/not-ready only; the full checklist lives
                      // in a hover tooltip to keep the form uncluttered.
                      <div className="relative group">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium cursor-help ${
                            easyshipReady
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-amber-500/10 text-amber-600'
                          }`}
                        >
                          {easyshipReady ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          {easyshipReady ? 'Ready' : 'Not ready'}
                          <Info className="w-3 h-3 opacity-70" />
                        </span>
                        <div className="hidden group-hover:block absolute right-0 z-30 mt-1 w-64 bg-white border border-line rounded-lg shadow-xl p-3">
                          <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1.5">
                            Easyship checklist
                          </p>
                          {easyshipReadiness ? (
                            <EasyshipChecklist checks={easyshipReadiness.checks} />
                          ) : (
                            <p className="text-[11px] text-ink-muted">Checking…</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-ink-muted">
                    {easyshipReady
                      ? 'All set — a shipment record will be created when you submit.'
                      : 'Hover the badge to see what’s missing. You can still submit; no record is created until it’s ready.'}
                  </p>

                  {/* Courier choice — only once the invoice is Easyship-ready.
                      The chosen rate seeds the shipping fee below. */}
                  {easyshipReady && (
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">
                        Courier (UPS / FedEx)
                      </label>
                      {easyshipReadiness && easyshipReadiness.rates.length > 0 ? (
                        <select
                          value={easyshipCourierId}
                          onChange={(e) => setEasyshipCourierId(e.target.value)}
                          className={fld}
                        >
                          <option value="">Select a courier…</option>
                          {easyshipReadiness.rates.map((r) => (
                            <option key={r.courierId} value={r.courierId}>
                              {r.courier} — ${r.cost.toFixed(2)} {r.currency}
                              {r.minDays && r.maxDays ? ` · ${r.minDays}-${r.maxDays} days` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-[11px] text-ink-muted break-words whitespace-pre-wrap">
                          {easyshipLoading
                            ? 'Loading courier rates…'
                            : easyshipReadiness?.ratesNote ||
                              'No live UPS/FedEx rates — Easyship will pick a courier automatically.'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Processing fee — the global handling-fee markup baked into
                      every courier rate. Opt-IN per invoice (off by default),
                      with an amount that can be overridden for this invoice only. */}
                  {easyshipReady && (
                    <div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={applyCourierFee}
                        onClick={() => setApplyCourierFee((v) => !v)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          applyCourierFee
                            ? 'bg-vital/5 text-ink border-vital/40'
                            : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-left">
                          <Tag className={`w-4 h-4 flex-shrink-0 ${applyCourierFee ? 'text-vital' : 'text-ink-muted'}`} />
                          <span>
                            Add processing fee
                            <span className="block text-[11px] font-normal text-ink-muted">
                              {applyCourierFee
                                ? 'Added on top of the courier rate.'
                                : 'Courier rate charged with no markup.'}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                            applyCourierFee ? 'bg-vital' : 'bg-line'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              applyCourierFee ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>
                      {applyCourierFee && (
                        <div className="mt-2">
                          <label className="block text-[11px] font-medium text-ink-muted mb-1">
                            Processing fee for this invoice{' '}
                            {courierFeeType === 'percent' ? '(%)' : '($)'}
                          </label>
                          <NumberInput
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            value={courierFeeValue}
                            onChange={(v) => setCourierFeeValue(v)}
                            className={fld}
                          />
                          <p className="mt-1 text-[11px] text-ink-muted">
                            Overrides the default fee for this invoice only. Rates above
                            update as you edit.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Courier handover + insurance — offered once ready. */}
                  {easyshipReady && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-medium text-ink-muted mb-1">
                          Handover
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: 'dropoff', label: 'We drop off' },
                            { value: 'pickup', label: 'Courier pickup' },
                          ] as const).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setEasyshipHandover(opt.value)}
                              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                easyshipHandover === opt.value
                                  ? 'bg-vital/5 text-ink border-vital/40'
                                  : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={easyshipInsured}
                        onClick={() => setEasyshipInsured((v) => !v)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          easyshipInsured
                            ? 'bg-vital/5 text-ink border-vital/40'
                            : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-left">
                          <Package className={`w-4 h-4 flex-shrink-0 ${easyshipInsured ? 'text-vital' : 'text-ink-muted'}`} />
                          <span>
                            Insure shipment
                            <span className="block text-[11px] font-normal text-ink-muted">
                              Cover the parcel&apos;s declared value.
                            </span>
                          </span>
                        </span>
                        <span
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                            easyshipInsured ? 'bg-vital' : 'bg-line'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              easyshipInsured ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        <Card title="Summary" tight>
          <Field label="Tax Rate (%)">
            <NumberInput
              min={0}
              step="0.01"
              placeholder="0"
              value={taxRate}
              onChange={(v) => setTaxRate(v)}
              className={fld}
            />
          </Field>
          <Field label="Shipping ($)">
            <NumberInput
              min={0}
              step="0.01"
              placeholder="0.00"
              value={shipping}
              onChange={(v) => {
                setShipping(v);
                setShippingOverridden(true);
              }}
              className={fld}
            />
            {easyshipActive && selectedCourier && !shippingOverridden && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Auto-filled from {selectedCourier.courier} (
                {applyCourierFee ? 'rate + processing fee' : 'rate, no processing fee'}). Editable.
              </p>
            )}
            {shippingOverridden && easyshipActive && selectedCourier && (
              <button
                type="button"
                onClick={() => setShippingOverridden(false)}
                className="mt-1 text-[11px] text-vital hover:text-vital/80"
              >
                Reset to {selectedCourier.courier} rate (${selectedCourier.cost.toFixed(2)})
              </button>
            )}
            {/* Whether the card payment link collects this shipping fee. Off by
                default: shipping is usually settled outside the link, so adding
                it to the hosted checkout charged the customer for it twice. */}
            <button
              type="button"
              role="switch"
              aria-checked={chargeShippingOnCheckout}
              onClick={() => setChargeShippingOnCheckout((v) => !v)}
              className={`mt-2 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                chargeShippingOnCheckout
                  ? 'bg-vital/5 text-ink border-vital/40'
                  : 'bg-surface text-ink-muted border-line hover:border-ink/20'
              }`}
            >
              <span className="flex items-center gap-1.5 text-left">
                <Truck
                  className={`w-4 h-4 ${chargeShippingOnCheckout ? 'text-vital' : 'text-ink-muted'}`}
                />
                {chargeShippingOnCheckout
                  ? 'Charged on the card payment link'
                  : 'Not charged on the card payment link'}
              </span>
              <span
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  chargeShippingOnCheckout ? 'bg-vital' : 'bg-line'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    chargeShippingOnCheckout ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
            <p className="mt-1 text-[11px] text-ink-muted">
              {chargeShippingOnCheckout
                ? `The Visa / Mastercard checkout adds $${Number(shipping || 0).toFixed(2)} shipping to the items.`
                : 'The Visa / Mastercard checkout charges the items only — shipping stays on the invoice.'}
            </p>
          </Field>
          {/* Processing fee — a flat charge for self-pickup invoices. The toggle
              controls whether it's applied to the total and shown on the PDF. */}
          {fulfillmentType === 'pickup' && (
            <Field label="Processing Fee ($)">
              <NumberInput
                min={0}
                step="0.01"
                placeholder="0.00"
                value={processingFee}
                onChange={(v) => setProcessingFee(v)}
                className={fld}
              />
              <button
                type="button"
                role="switch"
                aria-checked={showProcessingFee}
                onClick={() => setShowProcessingFee((v) => !v)}
                className={`mt-2 w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  showProcessingFee
                    ? 'bg-vital/5 text-ink border-vital/40'
                    : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                }`}
              >
                <span className="flex items-center gap-1.5 text-left">
                  <Tag className={`w-4 h-4 ${showProcessingFee ? 'text-vital' : 'text-ink-muted'}`} />
                  {showProcessingFee ? 'Shown on invoice' : 'Hidden (not charged)'}
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    showProcessingFee ? 'bg-vital' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      showProcessingFee ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
            </Field>
          )}
          <div className="pt-3 border-t border-line space-y-1.5 text-sm">
            <Row label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
            <Row label={`Tax (${taxRate || 0}%)`} value={`$${taxTotal.toFixed(2)}`} />
            <Row label="Shipping" value={`$${Number(shipping || 0).toFixed(2)}`} />
            {effectiveProcessingFee > 0 && (
              <Row label="Processing Fee" value={`$${effectiveProcessingFee.toFixed(2)}`} />
            )}
            <Row label="Total" value={`$${total.toFixed(2)} ${currency}`} bold />
          </div>
        </Card>

        <div className="space-y-2">
          {mode === 'create' ? (
            <>
              {/* Email opt-in — creating an invoice does NOT email the customer
                  unless this is switched on. */}
              {(() => {
                const recipient = (customer?.email ?? shipAddr.email ?? '').trim();
                const hasRecipient = recipient.length > 0;
                return (
                  <div className="rounded-xl border border-line bg-surface/50 p-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={emailOnCreate && hasRecipient}
                      disabled={!hasRecipient}
                      onClick={() => setEmailOnCreate((v) => !v)}
                      className={`w-full flex items-center justify-between gap-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                        emailOnCreate && hasRecipient ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-left">
                        <FileText className={`w-4 h-4 ${emailOnCreate && hasRecipient ? 'text-vital' : 'text-ink-muted'}`} />
                        Email invoice to customer
                      </span>
                      <span
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          emailOnCreate && hasRecipient ? 'bg-vital' : 'bg-line'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            emailOnCreate && hasRecipient ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </span>
                    </button>
                    <p className="mt-1.5 text-xs text-ink-muted">
                      {hasRecipient
                        ? emailOnCreate
                          ? `The invoice PDF will be emailed to ${recipient} after it's created.`
                          : 'Off — the invoice is created without notifying the customer.'
                        : 'Add a customer or Ship-to email to enable emailing.'}
                    </p>
                  </div>
                );
              })()}
              <button
                onClick={() => requestSubmit('sent')}
                disabled={submitting}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {emailOnCreate ? 'Create & Send' : 'Create Invoice'}
              </button>
              <button
                onClick={() => requestSubmit('draft')}
                disabled={submitting}
                className="w-full bg-white border border-line hover:border-ink/20 text-ink rounded-xl py-3 text-sm font-medium disabled:opacity-50"
              >
                Save as Draft
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => requestSubmit('sent')}
                disabled={submitting}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
              <button
                onClick={() => router.push(`/admin/invoices/${invoiceId}`)}
                className="w-full bg-white border border-line text-ink-muted hover:text-ink rounded-xl py-3 text-sm"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* New customer modal */}
      {showCustomerModal && (
        <Modal title="New Customer" accent="emerald" onClose={() => setShowCustomerModal(false)}>
          {newCustomerIsNewAccount && (
            <p className="text-sm text-ink-muted mb-3">
              This looks like a brand-new account. Phone and address are{' '}
              <span className="font-medium text-ink">optional</span> — fill in
              what you have now, or skip and complete it later.
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="First name *">
              <input value={newCustomer.first_name} onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })} className={fld} />
            </Field>
            <Field label="Last name *">
              <input value={newCustomer.last_name} onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })} className={fld} />
            </Field>
            <Field label="Email">
              <input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} className={fld} />
            </Field>
            <Field label="Phone">
              <input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} className={fld} />
            </Field>
          </div>

          {/* Optional address — seeds the customer record (and prefills the
              invoice's shipping destination when they're picked). */}
          <div className="mt-1 rounded-lg border border-line bg-surface/50 p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Address <span className="font-normal normal-case text-ink-muted/80">(optional)</span>
            </div>
            <AddressAutocomplete
              value={newCustomer.shipping_address}
              onChange={(street) => setNewCustomer((c) => ({ ...c, shipping_address: street }))}
              onSelect={(addr) => setNewCustomer((c) => ({
                ...c,
                shipping_address: addr.line1 || c.shipping_address,
                shipping_city: addr.city || c.shipping_city,
                shipping_state: addr.state || c.shipping_state,
                shipping_postal_code: addr.postalCode || c.shipping_postal_code,
                shipping_country: addr.country || c.shipping_country,
              }))}
              placeholder="Start typing the address…"
              className={fld}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <input value={newCustomer.shipping_city} onChange={(e) => setNewCustomer({ ...newCustomer, shipping_city: e.target.value })} placeholder="City" className={fld} />
              <input value={newCustomer.shipping_state} onChange={(e) => setNewCustomer({ ...newCustomer, shipping_state: e.target.value })} placeholder="Prov/State" className={fld} />
              <input value={newCustomer.shipping_postal_code} onChange={(e) => setNewCustomer({ ...newCustomer, shipping_postal_code: e.target.value })} placeholder="Postal" className={fld} />
              <input value={newCustomer.shipping_country} onChange={(e) => setNewCustomer({ ...newCustomer, shipping_country: e.target.value })} placeholder="Country" className={fld} />
            </div>
          </div>
          <ModalError message={modalError} />
          <ModalActions
            primaryLabel="Create Customer"
            primaryClass="bg-emerald-600 hover:bg-emerald-700"
            onPrimary={submitNewCustomer}
            onCancel={() => setShowCustomerModal(false)}
            busy={modalBusy}
          />
        </Modal>
      )}

      {/* New salesperson modal */}
      {showSpModal && (
        <Modal title="New Salesperson" accent="purple" onClose={() => setShowSpModal(false)}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="First name *">
              <input value={newSp.first_name} onChange={(e) => setNewSp({ ...newSp, first_name: e.target.value })} className={fld} />
            </Field>
            <Field label="Last name *">
              <input value={newSp.last_name} onChange={(e) => setNewSp({ ...newSp, last_name: e.target.value })} className={fld} />
            </Field>
            <Field label="Email">
              <input type="email" value={newSp.email} onChange={(e) => setNewSp({ ...newSp, email: e.target.value })} className={fld} />
            </Field>
            <Field label="Phone">
              <input value={newSp.phone} onChange={(e) => setNewSp({ ...newSp, phone: e.target.value })} className={fld} />
            </Field>
            <Field label="Commission %">
              <NumberInput min={0} max={100} step="0.01" placeholder="0" value={newSp.commission_rate} onChange={(v) => setNewSp({ ...newSp, commission_rate: v ?? 0 })} className={fld} />
            </Field>
          </div>
          <ModalError message={modalError} />
          <ModalActions
            primaryLabel="Create Salesperson"
            primaryClass="bg-purple-600 hover:bg-purple-700"
            onPrimary={submitNewSp}
            onCancel={() => setShowSpModal(false)}
            busy={modalBusy}
          />
        </Modal>
      )}

      {/* Quick stock edit */}
      {quickStock && (
        <Modal title="Quick edit stock" accent="emerald" onClose={() => setQuickStock(null)}>
          <p className="text-sm text-ink-muted mb-3">
            Update on-hand stock for <span className="font-medium text-ink">{quickStock.name}</span>,
            counted in vials. This changes the product&apos;s inventory immediately.
          </p>
          <Field label="Stock quantity (vials)">
            <input
              type="number"
              min={0}
              value={quickStock.value}
              autoFocus
              onChange={(e) => setQuickStock({ ...quickStock, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitQuickStock(); }}
              className={fld}
            />
          </Field>
          <ModalError message={quickStockError} />
          <ModalActions
            primaryLabel="Save stock"
            primaryClass="bg-emerald-600 hover:bg-emerald-700"
            onPrimary={submitQuickStock}
            onCancel={() => setQuickStock(null)}
            busy={quickStockBusy}
          />
        </Modal>
      )}

      {/* Stock / backorder confirm */}
      {pendingSentAction && (
        <Modal
          title="Backorder confirmation"
          accent="emerald"
          onClose={() => {
            setPendingSentAction(null);
            setOverrideBackorder(false);
          }}
        >
          <p className="text-sm text-ink mb-3">
            One or more line items exceed available stock.{' '}
            {overrideBackorder
              ? 'The whole order will be placed on a single invoice — no backorder will be created.'
              : 'Sending this invoice now will create a backorder.'}
          </p>
          <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
            {lines
              .filter((l) => l.product_id && stockErrors[l.product_id])
              .map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.description || 'Item'}</span>
                  {' — '}
                  {stockErrors[l.product_id as string]}
                </li>
              ))}
          </ul>

          {/* Override: force everything onto one invoice, skipping the split. */}
          <button
            type="button"
            role="switch"
            aria-checked={overrideBackorder}
            onClick={() => setOverrideBackorder((v) => !v)}
            className={`mt-3 w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              overrideBackorder
                ? 'bg-emerald-50 text-ink border-emerald-300'
                : 'bg-surface text-ink-muted border-line hover:border-ink/20'
            }`}
          >
            <span className="flex items-center gap-2">
              <AlertCircle className={`w-4 h-4 ${overrideBackorder ? 'text-emerald-600' : 'text-ink-muted'}`} />
              Override — invoice everything now, don&apos;t backorder
            </span>
            <span
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                overrideBackorder ? 'bg-emerald-500' : 'bg-line'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  overrideBackorder ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>

          <ModalActions
            primaryLabel={overrideBackorder ? 'Send without backorder' : 'Send and backorder'}
            primaryClass="bg-ink hover:bg-ink/90"
            onPrimary={() => void submit(pendingSentAction)}
            onCancel={() => {
              setPendingSentAction(null);
              setOverrideBackorder(false);
            }}
            busy={submitting}
          />
        </Modal>
      )}

      {/* Easyship shipment confirmation — the single submit gate when the
          shipment opt-in is on. Explains whether a record will be created,
          offers a label, and folds in the backorder warning. */}
      {easyshipPendingAction && (
        <Modal
          title={easyshipReady ? 'Create Easyship shipment?' : 'Not ready for Easyship'}
          accent="emerald"
          onClose={() => setEasyshipPendingAction(null)}
        >
          {easyshipReady ? (
            <>
              <p className="text-sm text-ink mb-3">
                The invoice will be {mode === 'edit' ? 'saved' : 'created'} and an{' '}
                <span className="font-medium">Easyship shipment record</span> generated for its order
                {selectedCourier ? (
                  <> via <span className="font-medium">{selectedCourier.courier}</span></>
                ) : null}
                .
              </p>
              {clientScenarioActive && (
                <p className="text-xs text-ink-muted mb-3 -mt-1.5">
                  Ships to{' '}
                  <span className="font-medium text-ink">
                    {[activeClient?.first_name, activeClient?.last_name].filter(Boolean).join(' ') ||
                      'the customer’s client'}
                  </span>
                  {' '}— the shipment uses the client&apos;s address &amp; contact (phone/email fall
                  back to a house default when blank).
                </p>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={easyshipBuyLabel}
                onClick={() => setEasyshipBuyLabel((v) => !v)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  easyshipBuyLabel
                    ? 'bg-emerald-50 text-ink border-emerald-300'
                    : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Printer className={`w-4 h-4 ${easyshipBuyLabel ? 'text-emerald-600' : 'text-ink-muted'}`} />
                  Also buy &amp; print the shipping label
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    easyshipBuyLabel ? 'bg-emerald-500' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      easyshipBuyLabel ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
              <p className="mt-2 text-[11px] text-ink-muted">
                The shipment is created right after the invoice. You can manage the label any time from
                the order&apos;s Shipping Label panel.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-ink mb-3">
                This invoice <span className="font-medium">isn&apos;t ready</span> for an Easyship
                shipment record, so <span className="font-medium">none will be created</span>. You can
                create one later from the order&apos;s Shipping Label panel.
              </p>
              {easyshipReadiness && (
                <div className="bg-surface/60 border border-line rounded-lg p-3 max-h-44 overflow-y-auto">
                  <EasyshipChecklist checks={easyshipReadiness.checks} />
                </div>
              )}
            </>
          )}

          {hasStockError &&
            (easyshipPendingAction === 'sent' || (mode === 'edit' && initial?.status !== 'draft')) && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Some line items exceed available stock — sending now will also create a backorder.</span>
              </div>
            )}

          <ModalActions
            primaryLabel={
              mode === 'edit'
                ? easyshipReady
                  ? 'Save invoice & shipment'
                  : 'Save invoice anyway'
                : easyshipReady
                  ? 'Create invoice & shipment'
                  : 'Create invoice anyway'
            }
            primaryClass="bg-ink hover:bg-ink/90"
            onPrimary={() => void submit(easyshipPendingAction)}
            onCancel={() => setEasyshipPendingAction(null)}
            busy={submitting}
          />
        </Modal>
      )}

      {/* Save prices to the customer's price list — offered on create once a
          customer is linked. Ticks default on; the chosen prices are upserted as
          per-customer overrides right after the invoice is created. */}
      {priceListPrompt && customer && (() => {
        const action = priceListPrompt;
        const selectedCount = eligiblePriceSaves.filter(
          (e) => priceSaveSelections[e.product_id],
        ).length;
        const resolve = (save: boolean) => {
          pendingPriceSavesRef.current = save
            ? eligiblePriceSaves
                .filter((e) => priceSaveSelections[e.product_id])
                .map((e) => ({ product_id: e.product_id, price: e.price }))
            : [];
          priceSaveResolvedRef.current = true;
          setPriceListPrompt(null);
          requestSubmit(action);
        };
        return (
          <Modal
            title={`Save prices to ${customer.first_name ?? 'customer'}'s price list?`}
            accent="emerald"
            onClose={() => setPriceListPrompt(null)}
          >
            <p className="text-sm text-ink-muted mb-4">
              Save the prices you entered as{' '}
              <span className="font-medium text-ink">
                {customer.first_name} {customer.last_name}
              </span>
              &apos;s custom prices? They&apos;ll apply to future orders and appear under{' '}
              <span className="font-medium text-ink">Pricing → Customer Pricing</span>.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {eligiblePriceSaves.map((e) => {
                const checked = !!priceSaveSelections[e.product_id];
                const changesExisting = round2(e.price) !== round2(e.def);
                return (
                  <label
                    key={e.product_id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      checked ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-surface'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(ev) =>
                        setPriceSaveSelections((prev) => ({
                          ...prev,
                          [e.product_id]: ev.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-line text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink truncate">{e.name}</div>
                      <div className="text-[11px] text-ink-muted">
                        {changesExisting ? (
                          <>Default ${e.def.toFixed(2)} {custPriceCurrency}</>
                        ) : (
                          <>Matches default price</>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-ink tabular-nums">
                        ${e.price.toFixed(2)} {custPriceCurrency}
                      </div>
                      {currency !== custPriceCurrency && (
                        <div className="text-[11px] text-ink-muted tabular-nums">
                          from ${e.entered.toFixed(2)} {currency}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {vialLineCount > 0 && (
              <p className="mt-3 text-[11px] text-ink-muted">
                {vialLineCount} vial-priced line{vialLineCount !== 1 ? 's are' : ' is'} not shown —
                price lists store the box (pack of 10) price only.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => resolve(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
              >
                Skip, don&apos;t save
              </button>
              <button
                onClick={() => resolve(true)}
                disabled={submitting || selectedCount === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Tag className="w-4 h-4" />
                Save {selectedCount} price{selectedCount !== 1 ? 's' : ''} &amp; continue
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* Edit a saved client — writes straight to the customer's address book,
          so the correction applies to this invoice and every future one. */}
      {editClient && (
        <Modal title="Edit client" accent="vital" onClose={() => setEditClient(null)}>
          <p className="text-sm text-ink-muted mb-4">
            Updates {customer ? `${customer.first_name} ${customer.last_name}` : 'the customer'}
            &apos;s saved client. Only the address is required.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="First name">
              <input
                value={editClient.draft.first_name}
                onChange={(e) => patchEditClient({ first_name: e.target.value })}
                className={fld}
              />
            </Field>
            <Field label="Last name">
              <input
                value={editClient.draft.last_name}
                onChange={(e) => patchEditClient({ last_name: e.target.value })}
                className={fld}
              />
            </Field>
          </div>
          <Field label="Address *">
            <AddressAutocomplete
              value={editClient.draft.address}
              onChange={(street) => patchEditClient({ address: street })}
              onSelect={(addr) => setEditClient((e) => e && {
                ...e,
                draft: {
                  ...e.draft,
                  address: addr.line1 || e.draft.address,
                  city: addr.city || e.draft.city,
                  state: addr.state || e.draft.state,
                  postal_code: addr.postalCode || e.draft.postal_code,
                  country: addr.country || e.draft.country,
                },
              })}
              placeholder="Client address (required)…"
              className={fld}
            />
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input
              value={editClient.draft.city}
              onChange={(e) => patchEditClient({ city: e.target.value })}
              placeholder="City"
              className={fld}
            />
            <input
              value={editClient.draft.state}
              onChange={(e) => patchEditClient({ state: e.target.value })}
              placeholder="Prov/State"
              className={fld}
            />
            <input
              value={editClient.draft.postal_code}
              onChange={(e) => patchEditClient({ postal_code: e.target.value })}
              placeholder="Postal"
              className={fld}
            />
            <input
              value={editClient.draft.country}
              onChange={(e) => patchEditClient({ country: e.target.value })}
              placeholder="Country"
              className={fld}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <input
              value={editClient.draft.phone}
              onChange={(e) => patchEditClient({ phone: e.target.value })}
              placeholder="Phone (optional)"
              className={fld}
            />
            <input
              type="email"
              value={editClient.draft.email}
              onChange={(e) => patchEditClient({ email: e.target.value })}
              placeholder="Email (optional)"
              className={fld}
            />
          </div>
          <ModalError message={editClientError} />
          <ModalActions
            primaryLabel="Save client"
            primaryClass="bg-vital hover:bg-vital/90"
            onPrimary={submitEditClient}
            onCancel={() => setEditClient(null)}
            busy={editClientBusy}
          />
        </Modal>
      )}

      {/* Delete a saved client — removes them from the customer's address book
          for good, so confirm before firing. Invoices read their ship-to
          through this record, so the modal checks for invoices that still use
          it and blocks the delete rather than blanking their destination. */}
      {deleteClient && (() => {
        const used = deleteClientUsage?.count ?? 0;
        const inUse = used > 0;
        const listed = deleteClientUsage?.invoices.length ?? 0;
        // Built here rather than inline: JSX would fold the line break between
        // the verb and its plural suffix into a stray space.
        const usedSentence =
          `${used} invoice${used === 1 ? '' : 's'} still ` +
          `${used === 1 ? 'ships' : 'ship'} to this client, so it can’t be deleted.`;
        return (
          <Modal title="Delete client" accent="vital" onClose={() => setDeleteClient(null)}>
            <p className="text-sm text-ink mb-1">
              Remove <span className="font-semibold">{clientName(deleteClient)}</span> from{' '}
              {customer ? `${customer.first_name} ${customer.last_name}` : 'the customer'}
              &apos;s saved clients?
            </p>
            <p className="text-sm text-ink-muted">
              {[
                deleteClient.address, deleteClient.city, deleteClient.state, deleteClient.postal_code,
              ].filter(Boolean).join(', ')}
            </p>

            {deleteClientUsageLoading && (
              <p className="mt-3 text-sm text-ink-muted inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking which invoices ship to this client…
              </p>
            )}

            {!deleteClientUsageLoading && inUse && (
              <ModalWarning>
                <p className="font-medium">{usedSentence}</p>
                <p className="mt-1">
                  Their address is what those invoices ship to and what the packing list is
                  addressed to — deleting the client would leave them with no destination.
                  Point them at a different client first.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {deleteClientUsage?.invoices.map((inv) => (
                    <a
                      key={inv.id}
                      href={`/admin/invoices/${inv.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-0.5 rounded-md bg-white border border-amber-300 font-mono text-[11px] text-amber-800 hover:border-amber-500"
                    >
                      {inv.invoice_number}
                    </a>
                  ))}
                  {used > listed && (
                    <span className="px-2 py-0.5 text-[11px]">+{used - listed} more</span>
                  )}
                </div>
              </ModalWarning>
            )}

            {!deleteClientUsageLoading && !inUse && (
              <p className="text-sm text-ink-muted mt-3">
                No invoice ships to this client, so nothing else is affected. This can&apos;t
                be undone.
              </p>
            )}

            <ModalError message={deleteClientError} />
            <ModalActions
              primaryLabel="Delete client"
              primaryClass="bg-red-600 hover:bg-red-700"
              onPrimary={submitDeleteClient}
              onCancel={() => setDeleteClient(null)}
              busy={deleteClientBusy}
              disabled={deleteClientUsageLoading || inUse}
              cancelLabel={inUse ? 'Close' : 'Cancel'}
            />
          </Modal>
        );
      })()}

      {/* Client contact fallback — the new client's phone/email is blank; ask
          whether to use the customer's contact or a default. */}
      {clientContactPrompt && (
        <Modal title="Client contact details" accent="emerald" onClose={() => setClientContactPrompt(null)}>
          <p className="text-sm text-ink mb-1">
            This client has no {[
              !newClient.email.trim() ? 'email' : null,
              !newClient.phone.trim() ? 'phone' : null,
            ].filter(Boolean).join(' or ')}.
          </p>
          <p className="text-sm text-ink-muted mb-4">
            The packing list and courier need a contact. Which should we use for the blank field(s)?
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                const action = clientContactPrompt;
                clientContactChoiceRef.current = 'customer';
                setClientContactChoice('customer');
                setClientContactPrompt(null);
                void submit(action);
              }}
              className="w-full text-left px-4 py-3 rounded-lg border border-line hover:border-vital/40 hover:bg-vital/5 transition-colors"
            >
              <div className="text-sm font-medium text-ink flex items-center gap-2">
                <User className="w-4 h-4 text-vital" /> Use the customer&apos;s contact
              </div>
              <div className="text-xs text-ink-muted mt-0.5">
                {[customer?.email, customer?.phone].filter(Boolean).join(' · ') || 'No contact on the customer record'}
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                const action = clientContactPrompt;
                clientContactChoiceRef.current = 'default';
                setClientContactChoice('default');
                setClientContactPrompt(null);
                void submit(action);
              }}
              className="w-full text-left px-4 py-3 rounded-lg border border-line hover:border-vital/40 hover:bg-vital/5 transition-colors"
            >
              <div className="text-sm font-medium text-ink flex items-center gap-2">
                <FileText className="w-4 h-4 text-vital" /> Use the default contact
              </div>
              <div className="text-xs text-ink-muted mt-0.5">
                {DEFAULT_CLIENT_EMAIL} · {DEFAULT_CLIENT_PHONE}
              </div>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setClientContactPrompt(null)}
              disabled={submitting}
              className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- helpers --------------------------------------------------------------
// Render a customer's email parenthetical, hiding the synthetic placeholder
// address (guest+…@aminocan.local) given to guest records with no real email.
function customerEmailHint(c: Customer): string {
  return c.email && !c.email.endsWith('@aminocan.local') ? ` (${c.email})` : '';
}

function Card({
  title, children, icon: Icon, tight,
}: { title: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; tight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-line ${tight ? 'p-4' : 'p-5'}`}>
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
        {Icon && <Icon className="w-4 h-4 text-vital" />} {title}
      </h3>
      {children}
    </div>
  );
}

// Compact Easyship checklist — reused in the readiness tooltip and the
// not-ready confirm dialog. Passes/fails each requirement with an inline hint.
function EasyshipChecklist({ checks }: { checks: InvoiceShippingReadiness['checks'] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          <span
            className={`mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${
              c.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-500'
            }`}
          >
            {c.ok ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
          </span>
          <span className="text-[11px] leading-tight">
            <span className={c.ok ? 'text-ink-muted' : 'text-ink font-medium'}>{c.label}</span>
            {!c.ok && c.hint && (
              <span className="block text-[10px] text-ink-muted/80">{c.hint}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  /** Optional help affordance rendered next to the label (e.g. an InfoHint). */
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1">
        <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</label>
        {hint}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'pt-2 border-t border-line text-base font-semibold text-ink' : 'text-ink-muted'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Display name for a saved client — falls back when both names are blank. */
function clientName(c: Pick<CustomerClient, 'first_name' | 'last_name'>): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client';
}

function Modal({
  title, children, accent, onClose,
}: { title: string; children: React.ReactNode; accent: 'emerald' | 'purple' | 'vital'; onClose: () => void }) {
  const accentText =
    accent === 'emerald' ? 'text-emerald-600' : accent === 'vital' ? 'text-vital' : 'text-purple-600';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-lg p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-base font-bold ${accentText}`}>{title}</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  primaryLabel, primaryClass, onPrimary, onCancel, busy, disabled, cancelLabel = 'Cancel',
}: {
  primaryLabel: string; primaryClass: string; onPrimary: () => void; onCancel: () => void;
  busy?: boolean;
  /** Block the primary action without the busy spinner (e.g. a failed precondition). */
  disabled?: boolean;
  cancelLabel?: string;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">{cancelLabel}</button>
      <button
        onClick={onPrimary}
        disabled={busy || disabled}
        className={`px-4 py-2 ${primaryClass} text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {primaryLabel}
      </button>
    </div>
  );
}

/** A blocking-but-not-broken notice: the action is refused for a known reason. */
function ModalWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ModalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-4 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
