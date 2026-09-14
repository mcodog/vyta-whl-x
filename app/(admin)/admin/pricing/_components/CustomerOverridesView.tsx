'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, X, Search, Edit2, Trash2, Save, AlertCircle, Users, ArrowLeft, ArrowRight, Upload, User, Package, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';
import ProductToggleSelector from '@/components/admin/ProductToggleSelector';
import NumericStepper from '@/components/admin/NumericStepper';
import PriceListImportModal from './PriceListImportModal';

// Attach the current session's bearer token (the price-overrides API is
// role-scoped; affiliates only see/manage their bound customers).
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface PriceOverride {
  id: string;
  customer_id: string;
  product_id: string;
  override_price: number;
  created_at: string;
  updated_at: string;
  customers: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
  products: {
    id: string;
    name: string;
    slug: string;
    price: number;
  };
}

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  price_currency?: 'CAD' | 'USD';
}

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
}

const getCustomerName = (customer: { first_name: string | null; last_name: string | null; email: string }) => {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
  return name || customer.email;
};

export default function CustomerOverridesView() {
  const { userRole, canCreate, canEdit, canDelete } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Affiliates may manage pricing too — the price-overrides API scopes every
  // read/write to the customers bound to them, so enabling the UI is safe.
  const isAffiliate = userRole === 'affiliate';
  const mayCreate = canCreate || isAffiliate;
  const mayEdit = canEdit || isAffiliate;
  const mayDelete = canDelete || isAffiliate;
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  // Seed the search from the URL so opening a customer/product and hitting Back
  // keeps it. Merge-write only our own keys so the parent's `view` is preserved.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingOverride, setEditingOverride] = useState<PriceOverride | null>(null);
  const [formData, setFormData] = useState({
    customer_ids: [] as string[],
    product_id: '',
    override_price: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Grouped card view: toggle between grouping overrides by customer or by
  // product, paginated a page at a time.
  const [viewMode, setViewMode] = useState<'customer' | 'product'>(
    () => (searchParams.get('mode') === 'product' ? 'product' : 'customer'),
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (searchQuery) params.set('q', searchQuery);
    else params.delete('q');
    if (viewMode !== 'customer') params.set('mode', viewMode);
    else params.delete('mode');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, viewMode, pathname, router]);
  // Which customer's billing-currency tag is mid-save (for the per-card toggle).
  const [togglingCurrency, setTogglingCurrency] = useState<string | null>(null);

  // Bulk edit state
  const [showBulkFlow, setShowBulkFlow] = useState(false);
  const [bulkStep, setBulkStep] = useState<1 | 2 | 3>(1);
  const [selectedCustomersForBulk, setSelectedCustomersForBulk] = useState<string[]>([]);
  const [bulkPrices, setBulkPrices] = useState<Record<string, string>>({});
  const [savingBulk, setSavingBulk] = useState(false);
  // Refs to the per-row price inputs in bulk step 2, for arrow-key navigation.
  const bulkInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch overrides (role-scoped)
      const response = await fetch('/api/admin/price-overrides', { headers: await authHeaders() });
      const { overrides: data } = await response.json();
      // This view manages custom prices only — drop visibility-only rows (rows
      // with no custom price) so price displays don't hit a null override_price.
      setOverrides((data || []).filter((o: any) => o.override_price != null));

      // Fetch customers via the scoped admin API (affiliates get only their own).
      const custRes = await fetch('/api/admin/customers', { headers: await authHeaders() });
      const { customers: customersData } = custRes.ok ? await custRes.json() : { customers: [] };
      setCustomers(
        (customersData || []).map((c: any) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          price_currency: c.price_currency === 'USD' ? 'USD' : 'CAD',
        })),
      );

      // Fetch products
      const { data: productsData } = await supabase
        .from('products')
        .select('id, name, slug, price')
        .eq('active', true)
        .order('name');
      setProducts(productsData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load data');
    }
    setLoading(false);
  };

  const handleCreateOrUpdate = async () => {
    setError('');
    setSuccess('');

    // For editing mode, we use single customer (legacy behavior)
    if (editingOverride) {
      if (!formData.customer_ids[0] || !formData.product_id || !formData.override_price) {
        setError('All fields are required');
        return;
      }

      const overridePrice = parseFloat(formData.override_price);
      if (isNaN(overridePrice) || overridePrice < 0) {
        setError('Invalid price');
        return;
      }

      try {
        const response = await fetch('/api/admin/price-overrides', {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            customer_id: formData.customer_ids[0],
            product_id: formData.product_id,
            override_price: overridePrice,
          }),
        });

        if (response.ok) {
          setSuccess('Price override updated successfully');
          setShowModal(false);
          setFormData({ customer_ids: [], product_id: '', override_price: '' });
          setEditingOverride(null);
          fetchData();
        } else {
          const { error: errorMsg } = await response.json();
          setError(errorMsg || 'Failed to update price override');
        }
      } catch (error) {
        console.error('Error updating price override:', error);
        setError('Failed to update price override');
      }
      return;
    }

    // For creating new overrides, support multiple customers
    if (formData.customer_ids.length === 0 || !formData.product_id || !formData.override_price) {
      setError('All fields are required');
      return;
    }

    const overridePrice = parseFloat(formData.override_price);
    if (isNaN(overridePrice) || overridePrice < 0) {
      setError('Invalid price');
      return;
    }

    try {
      // Create override for each selected customer
      const headers = await authHeaders({ 'Content-Type': 'application/json' });
      const promises = formData.customer_ids.map((customerId) =>
        fetch('/api/admin/price-overrides', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customer_id: customerId,
            product_id: formData.product_id,
            override_price: overridePrice,
          }),
        })
      );

      const responses = await Promise.all(promises);
      const failedCount = responses.filter((r) => !r.ok).length;

      if (failedCount === 0) {
        setSuccess(`Price override${formData.customer_ids.length > 1 ? 's' : ''} created successfully`);
        setShowModal(false);
        setFormData({ customer_ids: [], product_id: '', override_price: '' });
        fetchData();
      } else if (failedCount === responses.length) {
        setError('Failed to create price overrides');
      } else {
        setSuccess(`${responses.length - failedCount} override(s) created, ${failedCount} failed`);
        setShowModal(false);
        setFormData({ customer_ids: [], product_id: '', override_price: '' });
        fetchData();
      }
    } catch (error) {
      console.error('Error creating price overrides:', error);
      setError('Failed to create price overrides');
    }
  };

  const handleDelete = async (override: PriceOverride) => {
    if (!confirm(`Delete price override for ${getCustomerName(override.customers)}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/price-overrides?id=${override.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });

      if (response.ok) {
        setSuccess('Price override deleted successfully');
        fetchData();
      } else {
        setError('Failed to delete price override');
      }
    } catch (error) {
      console.error('Error deleting price override:', error);
      setError('Failed to delete price override');
    }
  };

  // Open the create modal, optionally pre-filled for a specific customer or
  // product (the "Add override" buttons on the grouped cards use this).
  const openCreateModal = (preset?: { customerId?: string; productId?: string }) => {
    setFormData({
      customer_ids: preset?.customerId ? [preset.customerId] : [],
      product_id: preset?.productId ?? '',
      override_price: '',
    });
    setEditingOverride(null);
    setShowModal(true);
    setError('');
  };

  const openEditModal = (override: PriceOverride) => {
    setFormData({
      customer_ids: [override.customer_id],
      product_id: override.product_id,
      override_price: override.override_price.toString(),
    });
    setEditingOverride(override);
    setShowModal(true);
    setError('');
  };

  const openBulkFlow = () => {
    setShowBulkFlow(true);
    setBulkStep(1);
    setSelectedCustomersForBulk([]);
    setBulkPrices({});
    setError('');
    setSuccess('');
  };

  const closeBulkFlow = () => {
    setShowBulkFlow(false);
    setBulkStep(1);
    setSelectedCustomersForBulk([]);
    setBulkPrices({});
  };

  const proceedToBulkStep2 = () => {
    if (selectedCustomersForBulk.length === 0) {
      setError('Please select at least one customer');
      return;
    }

    // Pre-fill existing overrides for selected customers
    const initialPrices: Record<string, string> = {};

    selectedCustomersForBulk.forEach((customerId) => {
      products.forEach((product) => {
        const existingOverride = overrides.find(
          (o) => o.customer_id === customerId && o.product_id === product.id
        );
        if (existingOverride) {
          initialPrices[`${customerId}_${product.id}`] = existingOverride.override_price.toFixed(2);
        }
      });
    });

    setBulkPrices(initialPrices);
    setBulkStep(2);
    setError('');
  };

  const handleBulkPriceChange = (productId: string, value: string) => {
    // Update price for all selected customers
    const updated = { ...bulkPrices };
    selectedCustomersForBulk.forEach((customerId) => {
      const key = `${customerId}_${productId}`;
      if (value === '') {
        delete updated[key];
      } else {
        updated[key] = value;
      }
    });
    setBulkPrices(updated);
  };

  // The actual set of override changes the bulk entries would apply — a change
  // is only counted when the entered price differs from what's already saved.
  // Used both for the Step 3 review summary and the save itself.
  const getBulkUpdates = (): Array<{ customer_id: string; product_id: string; override_price: number }> => {
    const updates: Array<{ customer_id: string; product_id: string; override_price: number }> = [];
    Object.entries(bulkPrices).forEach(([key, value]) => {
      const [customerId, productId] = key.split('_');
      const price = parseFloat(value);
      if (!isNaN(price) && price >= 0) {
        const existing = overrides.find(
          (o) => o.customer_id === customerId && o.product_id === productId,
        );
        if (!existing || existing.override_price !== price) {
          updates.push({ customer_id: customerId, product_id: productId, override_price: price });
        }
      }
    });
    return updates;
  };

  const proceedToBulkStep3 = () => {
    if (getBulkUpdates().length === 0) {
      setError('No changes to review — enter at least one new price');
      return;
    }
    setError('');
    setBulkStep(3);
  };

  const handleBulkSave = async () => {
    setError('');
    setSuccess('');
    setSavingBulk(true);

    try {
      const updates = getBulkUpdates();

      if (updates.length === 0) {
        setError('No changes to save');
        setSavingBulk(false);
        return;
      }

      // Batch save all updates
      const bulkHeaders = await authHeaders({ 'Content-Type': 'application/json' });
      const promises = updates.map((update) =>
        fetch('/api/admin/price-overrides', {
          method: 'POST',
          headers: bulkHeaders,
          body: JSON.stringify(update),
        })
      );

      const responses = await Promise.all(promises);
      const failedCount = responses.filter((r) => !r.ok).length;

      if (failedCount === 0) {
        setSuccess(`Successfully saved ${updates.length} price override${updates.length > 1 ? 's' : ''}`);
        closeBulkFlow();
        fetchData();
      } else if (failedCount === responses.length) {
        setError('Failed to save price overrides');
      } else {
        setSuccess(`${responses.length - failedCount} override(s) saved, ${failedCount} failed`);
        closeBulkFlow();
        fetchData();
      }
    } catch (error) {
      console.error('Error saving bulk prices:', error);
      setError('Failed to save price overrides');
    }

    setSavingBulk(false);
  };

  // How many override lines to preview per card before the "See all" link takes
  // over, and how many cards per page for each grouping.
  const PREVIEW_LINES = 4;
  const CUSTOMER_PAGE_SIZE = 10;
  const PRODUCT_PAGE_SIZE = 6;

  // Toggle a customer's billing-currency tag (CAD ⇄ USD) and persist it. Only
  // admins can write this (the customers API is admin-scoped); the update is
  // optimistic and rolls back on failure.
  const toggleCustomerCurrency = async (cust: { id: string; price_currency?: 'CAD' | 'USD' }) => {
    const previous = cust.price_currency === 'USD' ? 'USD' : 'CAD';
    const next = previous === 'USD' ? 'CAD' : 'USD';
    setTogglingCurrency(cust.id);
    setCustomers((prev) => prev.map((c) => (c.id === cust.id ? { ...c, price_currency: next } : c)));
    try {
      const res = await fetch(`/api/admin/customers/${cust.id}`, {
        method: 'PUT',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ price_currency: next }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      setCustomers((prev) => prev.map((c) => (c.id === cust.id ? { ...c, price_currency: previous } : c)));
      setError('Failed to update billing currency');
    } finally {
      setTogglingCurrency(null);
    }
  };

  // Group by customer — every customer is listed (not just those with overrides)
  // so overrides can be added to anyone. Customers with overrides sort first,
  // then alphabetically.
  const customerGroups = useMemo(() => {
    const byCustomer = new Map<string, PriceOverride[]>();
    for (const o of overrides) {
      const arr = byCustomer.get(o.customer_id) ?? [];
      arr.push(o);
      byCustomer.set(o.customer_id, arr);
    }
    return customers
      .map((c) => ({
        customer: c as PriceOverride['customers'] & { price_currency?: 'CAD' | 'USD' },
        overrides: byCustomer.get(c.id) ?? [],
      }))
      .sort((a, b) => {
        if ((b.overrides.length > 0 ? 1 : 0) !== (a.overrides.length > 0 ? 1 : 0)) {
          return (b.overrides.length > 0 ? 1 : 0) - (a.overrides.length > 0 ? 1 : 0);
        }
        return getCustomerName(a.customer).localeCompare(getCustomerName(b.customer));
      });
  }, [overrides, customers]);

  const productGroups = useMemo(() => {
    const map = new Map<string, { product: PriceOverride['products']; overrides: PriceOverride[] }>();
    for (const o of overrides) {
      const g = map.get(o.product_id) ?? { product: o.products, overrides: [] };
      g.overrides.push(o);
      map.set(o.product_id, g);
    }
    return Array.from(map.values()).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [overrides]);

  const filteredCustomerGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return customerGroups;
    return customerGroups.filter(
      (g) =>
        getCustomerName(g.customer).toLowerCase().includes(q) ||
        g.customer.email.toLowerCase().includes(q) ||
        g.overrides.some((o) => o.products.name.toLowerCase().includes(q)),
    );
  }, [customerGroups, searchQuery]);

  const filteredProductGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return productGroups;
    return productGroups.filter(
      (g) =>
        g.product.name.toLowerCase().includes(q) ||
        g.overrides.some(
          (o) =>
            getCustomerName(o.customers).toLowerCase().includes(q) ||
            o.customers.email.toLowerCase().includes(q),
        ),
    );
  }, [productGroups, searchQuery]);

  const pageSize = viewMode === 'customer' ? CUSTOMER_PAGE_SIZE : PRODUCT_PAGE_SIZE;
  const totalGroups = viewMode === 'customer' ? filteredCustomerGroups.length : filteredProductGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedCustomerGroups = filteredCustomerGroups.slice(pageStart, pageStart + pageSize);
  const pagedProductGroups = filteredProductGroups.slice(pageStart, pageStart + pageSize);

  // Reset to the first page whenever the search or grouping changes so we never
  // land on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, viewMode]);

  const discountPct = (defaultPrice: number, override: number) =>
    defaultPrice > 0 ? ((defaultPrice - override) / defaultPrice) * 100 : 0;

  // Step 3 review: the changes grouped by product (each price applies to the
  // listed customers), plus the affected customer objects.
  const bulkUpdates = useMemo(getBulkUpdates, [bulkPrices, overrides]);
  const bulkSummaryByProduct = useMemo(() => {
    const map = new Map<string, { product: Product | undefined; price: number; count: number }>();
    for (const u of bulkUpdates) {
      const g = map.get(u.product_id) ?? {
        product: products.find((p) => p.id === u.product_id),
        price: u.override_price,
        count: 0,
      };
      g.count += 1;
      map.set(u.product_id, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.product?.name ?? '').localeCompare(b.product?.name ?? ''),
    );
  }, [bulkUpdates, products]);
  const bulkSelectedCustomers = useMemo(
    () => selectedCustomersForBulk
      .map((id) => customers.find((c) => c.id === id))
      .filter((c): c is Customer => !!c),
    [selectedCustomersForBulk, customers],
  );

  return (
    <>
      {/* Header — the page shell owns the H1/subtitle; this row carries the actions. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 mb-6">
        {mayCreate && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface border border-line text-ink rounded-lg hover:border-ink/30 transition-all font-medium text-sm"
            >
              <Upload className="w-4 h-4" />
              Import CSV
            </button>
            <button
              onClick={openBulkFlow}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white rounded-lg hover:bg-bronze/90 transition-all font-medium text-sm"
            >
              <Users className="w-4 h-4" />
              Bulk Edit Pricing
            </button>
            <button
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Price Override
            </button>
          </div>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-800">{error}</p>
          </div>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-emerald-800">{success}</p>
          </div>
          <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by customer or product..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
          />
        </div>
      </div>

      {/* Grouping toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-line bg-surface p-1">
          {([
            { value: 'customer', label: 'By Customer', icon: User },
            { value: 'product', label: 'By Product', icon: Package },
          ] as const).map(({ value, label, icon: Icon }) => {
            const active = viewMode === value;
            return (
              <button
                key={value}
                onClick={() => setViewMode(value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </div>
        {!loading && (
          <span className="text-xs text-ink-muted">
            {totalGroups} {viewMode === 'customer' ? 'customer' : 'product'}{totalGroups !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Grouped cards */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-line p-5 animate-pulse">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-1/2 bg-line/60 rounded" />
                  <div className="h-3 w-2/3 bg-line/40 rounded" />
                </div>
                <div className="h-5 w-16 bg-line/50 rounded-full" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="flex items-center justify-between gap-2">
                    <div className="h-3 w-1/3 bg-line/40 rounded" />
                    <div className="h-3 w-16 bg-line/40 rounded" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-line/70">
                <div className="h-7 w-24 bg-line/50 rounded-lg" />
                <div className="h-3 w-14 bg-line/40 rounded ml-auto" />
              </div>
            </div>
          ))}
        </div>
      ) : totalGroups === 0 ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center text-ink-muted text-sm">
          {viewMode === 'customer' ? 'No customers found' : 'No price overrides found'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {viewMode === 'customer'
              ? pagedCustomerGroups.map((g) => (
                  <div key={g.customer.id} className="bg-white rounded-xl border border-line p-5 flex flex-col">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{getCustomerName(g.customer)}</div>
                        <div className="text-xs text-ink-muted truncate">{g.customer.email}</div>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-medium px-2 py-1 rounded-full bg-bronze/10 text-bronze">
                        {g.overrides.length} override{g.overrides.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-1.5 flex-1">
                      {g.overrides.length === 0 ? (
                        <div className="text-xs text-ink-muted">No overrides yet</div>
                      ) : (
                        <>
                          {g.overrides.slice(0, PREVIEW_LINES).map((o) => (
                            <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-ink truncate">{o.products.name}</span>
                              <span className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                                <span className="text-ink-muted line-through text-xs">${o.products.price.toFixed(2)}</span>
                                <span className="font-semibold text-bronze">${o.override_price.toFixed(2)}</span>
                              </span>
                            </div>
                          ))}
                          {g.overrides.length > PREVIEW_LINES && (
                            <div className="text-xs text-ink-muted pt-0.5">
                              +{g.overrides.length - PREVIEW_LINES} more
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-line/70">
                      {/* "Edit pricelist" opens this customer's full pricing
                          editor (the former "See all" target) — the single entry
                          point for applying a list, multiplying/converting, and
                          hand-editing their prices. */}
                      <Link
                        href={`/admin/pricing/customer/${g.customer.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-medium hover:bg-ink/90 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit pricelist
                      </Link>
                      {/* Per-customer billing currency. Admins click to toggle
                          CAD ⇄ USD; it's saved on the customer. Non-admins see a
                          read-only tag. */}
                      {userRole === 'admin' ? (
                        <button
                          onClick={() => toggleCustomerCurrency(g.customer)}
                          disabled={togglingCurrency === g.customer.id}
                          title="Billed in — click to switch CAD / USD"
                          className={`ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                            g.customer.price_currency === 'USD'
                              ? 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'
                              : 'bg-surface text-ink-muted border border-line hover:border-ink/30'
                          }`}
                        >
                          <span className="font-semibold">$</span>
                          {g.customer.price_currency === 'USD' ? 'USD' : 'CAD'}
                        </button>
                      ) : (
                        <span
                          title={`Billed in ${g.customer.price_currency === 'USD' ? 'USD' : 'CAD'}`}
                          className={`ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            g.customer.price_currency === 'USD'
                              ? 'bg-blue-500/10 text-blue-600'
                              : 'bg-surface text-ink-muted border border-line'
                          }`}
                        >
                          <span className="font-semibold">$</span>
                          {g.customer.price_currency === 'USD' ? 'USD' : 'CAD'}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              : pagedProductGroups.map((g) => (
                  <div key={g.product.id} className="bg-white rounded-xl border border-line p-5 flex flex-col">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{g.product.name}</div>
                        <div className="text-xs text-ink-muted tabular-nums">Default ${g.product.price.toFixed(2)}</div>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-medium px-2 py-1 rounded-full bg-bronze/10 text-bronze">
                        {g.overrides.length} customer{g.overrides.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-1.5 flex-1">
                      {g.overrides.slice(0, PREVIEW_LINES).map((o) => {
                        const d = discountPct(g.product.price, o.override_price);
                        return (
                          <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-ink truncate">{getCustomerName(o.customers)}</span>
                            <span className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                              <span className={`text-xs ${d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-ink-muted'}`}>
                                {d > 0 ? '-' : d < 0 ? '+' : ''}{Math.abs(d).toFixed(0)}%
                              </span>
                              <span className="font-semibold text-bronze">${o.override_price.toFixed(2)}</span>
                            </span>
                          </div>
                        );
                      })}
                      {g.overrides.length > PREVIEW_LINES && (
                        <div className="text-xs text-ink-muted pt-0.5">
                          +{g.overrides.length - PREVIEW_LINES} more
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-line/70">
                      {/* "Edit pricelist" opens this product's per-customer price
                          editor (the former "See all" target). */}
                      <Link
                        href={`/admin/pricing/product/${g.product.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-medium hover:bg-ink/90 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit pricelist
                      </Link>
                    </div>
                  </div>
                ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-white text-sm text-ink hover:border-ink/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-4 h-4" /> Prev
              </button>
              <span className="text-sm text-ink-muted tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-white text-sm text-ink hover:border-ink/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-ink">
                {editingOverride ? 'Edit Price Override' : 'Add Price Override'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Customer Select */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  {editingOverride ? 'Customer' : 'Customers'}
                </label>
                <MultiSelectCustomer
                  customers={customers}
                  selectedIds={formData.customer_ids}
                  onChange={(selectedIds) => setFormData({ ...formData, customer_ids: selectedIds })}
                  disabled={!!editingOverride}
                  placeholder="Search and select customers..."
                />
              </div>

              {/* Product Select */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Product</label>
                <ProductToggleSelector
                  products={products}
                  selectedId={formData.product_id}
                  onChange={(productId) => setFormData({ ...formData, product_id: productId })}
                  disabled={!!editingOverride}
                />
              </div>

              {/* Price Input */}
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Override Price</label>
                <NumericStepper
                  value={formData.override_price}
                  onChange={(price) => setFormData({ ...formData, override_price: price })}
                  placeholder="0.00"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateOrUpdate}
                  className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Flow */}
      {showBulkFlow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`bg-white rounded-xl w-full p-5 sm:p-8 max-h-[90vh] overflow-y-auto ${bulkStep === 2 ? 'max-w-5xl' : 'max-w-2xl'}`}>
            {/* Step 1: Customer Selection */}
            {bulkStep === 1 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-ink">Bulk Edit Pricing</h2>
                    <p className="text-sm text-ink-muted mt-1">Step 1: Select Customers</p>
                  </div>
                  <button
                    onClick={closeBulkFlow}
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-2">
                      Select Customers
                    </label>
                    <MultiSelectCustomer
                      customers={customers}
                      selectedIds={selectedCustomersForBulk}
                      onChange={setSelectedCustomersForBulk}
                      placeholder="Search and select customers..."
                    />
                    {selectedCustomersForBulk.length > 0 && (
                      <p className="text-xs text-ink-muted mt-2">
                        {selectedCustomersForBulk.length} customer{selectedCustomersForBulk.length > 1 ? 's' : ''} selected
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={closeBulkFlow}
                      className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={proceedToBulkStep2}
                      disabled={selectedCustomersForBulk.length === 0}
                      className="flex-1 px-4 py-2.5 bg-bronze text-white rounded-lg hover:bg-bronze/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next: Set Prices
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 2: Product Pricing Grid */}
            {bulkStep === 2 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-ink">Bulk Edit Pricing</h2>
                    <p className="text-sm text-ink-muted mt-1">
                      Step 2: Set Prices for {selectedCustomersForBulk.length} customer{selectedCustomersForBulk.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={closeBulkFlow}
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-800">
                    Enter override prices (in CAD). Leave blank to skip. Changes apply to all {selectedCustomersForBulk.length} selected customer{selectedCustomersForBulk.length > 1 ? 's' : ''}. Use{' '}
                    <span className="font-semibold">↑ / ↓</span> or <span className="font-semibold">Enter</span> to jump between price fields.
                  </p>
                </div>

                {/* Product Grid */}
                <div className="bg-white border border-line rounded-lg mb-4 max-h-96 overflow-auto">
                  <table className="w-full min-w-[560px]">
                    {/* Sticky header sits above the (focus:z-10) price inputs so
                        scrolled rows never render on top of it. */}
                    <thead>
                      <tr className="border-b border-line">
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          Product
                        </th>
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          SKU
                        </th>
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          Default Price
                        </th>
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider w-64">
                          Override Price
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {products.map((product, idx) => {
                        const sampleKey = `${selectedCustomersForBulk[0]}_${product.id}`;
                        const currentValue = bulkPrices[sampleKey] || '';

                        return (
                          <tr key={product.id} className="hover:bg-surface/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="text-sm font-medium text-ink">{product.name}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-xs text-ink-muted font-mono">{product.slug}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm font-semibold text-ink tabular-nums">
                                ${product.price.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <NumericStepper
                                value={currentValue}
                                onChange={(value) => handleBulkPriceChange(product.id, value)}
                                placeholder="Leave blank to skip"
                                inputRef={(el) => {
                                  bulkInputRefs.current[idx] = el;
                                }}
                                onKeyDown={(e) => {
                                  // Arrow keys / Enter move focus down the column
                                  // for fast sequential entry.
                                  if (e.key === 'ArrowDown' || e.key === 'Enter') {
                                    e.preventDefault();
                                    bulkInputRefs.current[idx + 1]?.focus();
                                  } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    bulkInputRefs.current[idx - 1]?.focus();
                                  }
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setBulkStep(1)}
                    className="px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm inline-flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={proceedToBulkStep3}
                    disabled={Object.keys(bulkPrices).length === 0}
                    className="flex-1 px-4 py-2.5 bg-bronze text-white rounded-lg hover:bg-bronze/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next: Review
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {/* Step 3: Review summary */}
            {bulkStep === 3 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-ink">Bulk Edit Pricing</h2>
                    <p className="text-sm text-ink-muted mt-1">Step 3: Review &amp; Confirm</p>
                  </div>
                  <button
                    onClick={closeBulkFlow}
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                {/* Who it applies to */}
                <div className="mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                    Applies to {bulkSelectedCustomers.length} customer{bulkSelectedCustomers.length !== 1 ? 's' : ''}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {bulkSelectedCustomers.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-bronze/10 text-bronze text-xs rounded-md"
                      >
                        {getCustomerName(c)}
                        <span
                          className={`px-1 rounded text-[9px] font-semibold ${
                            c.price_currency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-white/60 text-ink-muted'
                          }`}
                        >
                          {c.price_currency === 'USD' ? 'USD' : 'CAD'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* What will change */}
                <div className="bg-white border border-line rounded-lg mb-4 max-h-80 overflow-auto">
                  <table className="w-full min-w-[420px]">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          Product
                        </th>
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          New Price (CAD)
                        </th>
                        <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          Customers
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {bulkSummaryByProduct.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-10 text-center text-sm text-ink-muted">
                            No changes to apply — go back and set at least one new price.
                          </td>
                        </tr>
                      ) : (
                        bulkSummaryByProduct.map((row) => (
                          <tr key={row.product?.id ?? row.price}>
                            <td className="px-4 py-3 text-sm text-ink">{row.product?.name ?? 'Product'}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-bronze tabular-nums">
                              ${row.price.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-ink-muted text-right tabular-nums">{row.count}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mb-4 text-sm text-ink-muted">
                  <span className="font-semibold text-ink tabular-nums">{bulkUpdates.length}</span> price override{bulkUpdates.length !== 1 ? 's' : ''} will be created or updated across{' '}
                  <span className="font-semibold text-ink tabular-nums">{bulkSelectedCustomers.length}</span> customer{bulkSelectedCustomers.length !== 1 ? 's' : ''}.
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => { setError(''); setBulkStep(2); }}
                    className="px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm inline-flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={handleBulkSave}
                    disabled={savingBulk || bulkUpdates.length === 0}
                    className="flex-1 px-4 py-2.5 bg-bronze text-white rounded-lg hover:bg-bronze/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingBulk ? (
                      <>Saving...</>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Confirm &amp; Save {bulkUpdates.length} Override{bulkUpdates.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showImport && (
        <PriceListImportModal
          customers={customers as any}
          isAffiliate={isAffiliate}
          onClose={() => setShowImport(false)}
          onApplied={(msg) => {
            setShowImport(false);
            setSuccess(msg);
            fetchData();
          }}
        />
      )}
    </>
  );
}
