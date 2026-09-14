'use client';

import React, { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, X, Edit2, Trash2, Save, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';
import NumericStepper from '@/components/admin/NumericStepper';

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
  customers: { id: string; first_name: string | null; last_name: string | null; email: string };
  products: { id: string; name: string; slug: string; price: number };
}

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

const getCustomerName = (c: { first_name: string | null; last_name: string | null; email: string }) => {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.email;
};

export default function ProductPricingDetailPage() {
  const params = useParams();
  const productId = String(params.id);
  const { userRole, canCreate, canEdit, canDelete } = usePermissions();
  const isAffiliate = userRole === 'affiliate';
  const mayCreate = canCreate || isAffiliate;
  const mayEdit = canEdit || isAffiliate;
  const mayDelete = canDelete || isAffiliate;

  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [product, setProduct] = useState<PriceOverride['products'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add / edit modal state. `editing` holds the override being edited (null when
  // adding). Adding supports multiple customers at once.
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PriceOverride | null>(null);
  const [formCustomerIds, setFormCustomerIds] = useState<string[]>([]);
  const [formPrice, setFormPrice] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/price-overrides?product_id=${productId}`, {
        headers: await authHeaders(),
      });
      const { overrides: data } = res.ok ? await res.json() : { overrides: [] };
      const list = (data || []) as PriceOverride[];
      setOverrides(list);
      if (list[0]?.products) setProduct(list[0].products);

      // Resolve the product even when it has no overrides yet.
      const { data: prod } = await supabase
        .from('products')
        .select('id, name, slug, price')
        .eq('id', productId)
        .maybeSingle();
      if (prod) setProduct(prod);

      // Customer list (scoped) for the add flow.
      const custRes = await fetch('/api/admin/customers', { headers: await authHeaders() });
      if (custRes.ok) {
        const { customers: list2 } = await custRes.json();
        setCustomers(
          (list2 || []).map((c: any) => ({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            email: c.email,
          })),
        );
      }
    } catch (e) {
      console.error('Error loading product pricing:', e);
      setError('Failed to load data');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const openAdd = () => {
    setEditing(null);
    setFormCustomerIds([]);
    setFormPrice('');
    setError('');
    setShowModal(true);
  };

  const openEdit = (o: PriceOverride) => {
    setEditing(o);
    setFormCustomerIds([o.customer_id]);
    setFormPrice(o.override_price.toFixed(2));
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    if (formCustomerIds.length === 0 || !formPrice) {
      setError('Select at least one customer and enter a price');
      return;
    }
    const price = parseFloat(formPrice);
    if (isNaN(price) || price < 0) {
      setError('Invalid price');
      return;
    }
    try {
      const headers = await authHeaders({ 'Content-Type': 'application/json' });
      const responses = await Promise.all(
        formCustomerIds.map((customer_id) =>
          fetch('/api/admin/price-overrides', {
            method: 'POST',
            headers,
            body: JSON.stringify({ customer_id, product_id: productId, override_price: price }),
          }),
        ),
      );
      const failed = responses.filter((r) => !r.ok).length;
      if (failed === 0) {
        setSuccess(editing ? 'Price override updated' : `Price override${formCustomerIds.length > 1 ? 's' : ''} saved`);
        setShowModal(false);
        fetchData();
      } else if (failed === responses.length) {
        setError('Failed to save price overrides');
      } else {
        setSuccess(`${responses.length - failed} saved, ${failed} failed`);
        setShowModal(false);
        fetchData();
      }
    } catch (e) {
      console.error('Error saving override:', e);
      setError('Failed to save price override');
    }
  };

  const handleDelete = async (o: PriceOverride) => {
    if (!confirm(`Delete this override for ${getCustomerName(o.customers)}?`)) return;
    try {
      const res = await fetch(`/api/admin/price-overrides?id=${o.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      if (res.ok) {
        setSuccess('Price override deleted');
        fetchData();
      } else {
        setError('Failed to delete price override');
      }
    } catch (e) {
      console.error('Error deleting override:', e);
      setError('Failed to delete price override');
    }
  };

  const defaultPrice = product?.price ?? 0;

  // When editing, lock the customer picker to the single existing customer.
  const editCustomer = useMemo(
    () => (editing ? customers.filter((c) => c.id === editing.customer_id) : []),
    [editing, customers],
  );

  return (
    <>
      <Link
        href="/admin/pricing"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Customer Pricing
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-1">{product?.name ?? 'Product'}</h1>
          <p className="text-ink-muted text-sm">
            Default ${defaultPrice.toFixed(2)} · {overrides.length} customer override{overrides.length !== 1 ? 's' : ''}
          </p>
        </div>
        {mayCreate && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm self-start"
          >
            <Plus className="w-4 h-4" /> Add Price Override
          </button>
        )}
      </div>

      {error && !showModal && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="flex-1 text-sm text-red-800">{error}</p>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <p className="flex-1 text-sm text-emerald-800">{success}</p>
          <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                {['Customer', 'Default Price', 'Override Price', 'Discount', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</td></tr>
              ) : overrides.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-ink-muted text-sm">No customer overrides for this product</td></tr>
              ) : (
                overrides.map((o) => {
                  const discount = defaultPrice > 0
                    ? ((defaultPrice - o.override_price) / defaultPrice) * 100
                    : 0;
                  return (
                    <tr key={o.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-4">
                        <div className="text-sm font-medium text-ink">{getCustomerName(o.customers)}</div>
                        <div className="text-xs text-ink-muted">{o.customers.email}</div>
                      </td>
                      <td className="px-5 py-4 font-semibold text-ink tabular-nums">${defaultPrice.toFixed(2)}</td>
                      <td className="px-5 py-4 font-semibold text-vital tabular-nums">${o.override_price.toFixed(2)}</td>
                      <td className="px-5 py-4">
                        <span className={`text-sm font-medium ${discount > 0 ? 'text-emerald-600' : discount < 0 ? 'text-red-600' : 'text-ink-muted'}`}>
                          {discount > 0 ? '-' : discount < 0 ? '+' : ''}{Math.abs(discount).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {mayEdit ? (
                            <>
                              <button onClick={() => openEdit(o)} className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink" title="Edit">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {mayDelete && (
                                <button onClick={() => handleDelete(o)} className="p-2 hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600" title="Delete">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-ink-muted">View only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</div>
          ) : overrides.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">No customer overrides for this product</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {overrides.map((o) => {
                const discount = defaultPrice > 0 ? ((defaultPrice - o.override_price) / defaultPrice) * 100 : 0;
                return (
                  <li key={o.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{getCustomerName(o.customers)}</div>
                        <div className="text-xs text-ink-muted break-all">{o.customers.email}</div>
                      </div>
                      {mayEdit ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openEdit(o)} className="w-10 h-10 flex items-center justify-center hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink" title="Edit">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {mayDelete && (
                            <button onClick={() => handleDelete(o)} className="w-10 h-10 flex items-center justify-center hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted shrink-0">View only</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
                      <span>Default <span className="text-ink font-semibold tabular-nums">${defaultPrice.toFixed(2)}</span></span>
                      <span>Override <span className="text-vital font-semibold tabular-nums">${o.override_price.toFixed(2)}</span></span>
                      <span className={`font-medium ${discount > 0 ? 'text-emerald-600' : discount < 0 ? 'text-red-600' : 'text-ink-muted'}`}>
                        {discount > 0 ? '-' : discount < 0 ? '+' : ''}{Math.abs(discount).toFixed(1)}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Add / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-ink">
                {editing ? 'Edit Price Override' : 'Add Price Override'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-ink-muted hover:text-ink transition-colors">
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
                  {editing ? 'Customer' : 'Customers'}
                </label>
                <MultiSelectCustomer
                  customers={editing ? editCustomer : customers}
                  selectedIds={formCustomerIds}
                  onChange={setFormCustomerIds}
                  disabled={!!editing}
                  placeholder="Search and select customers..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Override Price</label>
                <NumericStepper value={formPrice} onChange={setFormPrice} placeholder="0.00" />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" /> Save Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
