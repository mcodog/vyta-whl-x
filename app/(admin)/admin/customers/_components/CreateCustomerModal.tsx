'use client';

import React, { useEffect, useState } from 'react';
import { X, Loader2, UserPlus, Check, AlertCircle, Mail, KeyRound, ListChecks, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

interface PriceListLite { id: string; name: string; is_active: boolean; item_count: number; }

export default function CreateCustomerModal({
  onClose,
  onCreated,
  affiliateId,
}: {
  onClose: () => void;
  onCreated: () => void;
  // When set, the new customer is bound to this affiliate (used from the sales
  // person / affiliate detail page so they land in that partner's book).
  affiliateId?: string | null;
}) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    alternate_email: '',
    phone: '',
  });
  const toast = useToast();
  const [priceCurrency, setPriceCurrency] = useState<'CAD' | 'USD'>('CAD');
  // Whether new invoices for this customer default to WITH product labels (the
  // sticker on each vial — not the shipping label) or without. Defaults to true.
  const [withLabels, setWithLabels] = useState(true);
  // Optional price list to apply to the new customer once it's created.
  const [priceLists, setPriceLists] = useState<PriceListLite[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [createLogin, setCreateLogin] = useState(true);
  // How the customer's password is established. Default: the affiliate/admin
  // sets it now. Alternative: email a link so the customer sets it themselves.
  const [passwordMode, setPasswordMode] = useState<'set' | 'self'>('set');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // After success: how the account was set up (a password was set directly, or
  // a set-up link was emailed), plus any non-fatal link error.
  const [sent, setSent] = useState<{ email: string; mode: 'set' | 'self'; linkError: string | null } | null>(null);
  // The entered email already belongs to an affiliate — prompt to merge into
  // their existing record instead of minting a duplicate customer.
  const [conflict, setConflict] = useState<
    { id: string; first_name: string | null; last_name: string | null; email: string } | null
  >(null);
  const [merging, setMerging] = useState(false);
  // After a confirmed merge: the affiliate's display name, for the success panel.
  const [merged, setMerged] = useState<{ name: string } | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // The create payload, shared by the initial submit and the merge confirmation.
  const buildPayload = (extra?: Record<string, unknown>) => ({
    first_name: form.first_name,
    last_name: form.last_name,
    email: form.email,
    alternate_email: form.alternate_email,
    phone: form.phone,
    price_currency: priceCurrency,
    default_with_labels: withLabels,
    create_login: createLogin,
    ...(affiliateId ? { affiliate_id: affiliateId } : {}),
    ...(createLogin && passwordMode === 'set' ? { password: password.trim() } : {}),
    ...extra,
  });

  // Load available price lists (admin-only API; affiliates get none and the
  // selector stays hidden).
  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        const res = await fetch('/api/admin/pricelists', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.ok) {
          const { pricelists } = await res.json();
          setPriceLists(pricelists || []);
        }
      } catch {
        /* non-fatal — the selector just stays hidden */
      }
    })();
  }, []);

  // Best-effort: apply the selected price list to the freshly created customer.
  const applyPricelist = async (customerId: string) => {
    if (!selectedListId || !customerId) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/pricelists/${selectedListId}/apply-to-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ customer_id: customerId, mode: 'override' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Customer created, but applying the price list failed.');
      } else {
        const list = priceLists.find((l) => l.id === selectedListId);
        toast.success(`Applied "${list?.name ?? 'price list'}" to the new customer`);
      }
    } catch {
      toast.error('Customer created, but applying the price list failed.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (createLogin && !form.email.trim()) {
      setError('Email is required to create a login.');
      return;
    }

    // When the password is set here (not by the customer), require a valid one.
    const setPasswordNow = createLogin && passwordMode === 'set';
    if (setPasswordNow && password.trim().length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.conflict?.type === 'affiliate') {
        // This email is already an affiliate — offer to merge rather than error.
        setConflict(data.conflict);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create customer');
      }

      const newId = data?.customer?.id;

      // Apply the chosen price list to the new customer before finishing.
      await applyPricelist(newId);

      // Password set here — the account is ready, nothing to email.
      if (createLogin && newId && setPasswordNow) {
        setSent({ email: form.email.trim(), mode: 'set', linkError: null });
        setSaving(false);
        return;
      }

      // Customer sets their own — email a set-up link that lands them on the
      // "Set your password" page.
      if (createLogin && newId) {
        const linkRes = await fetch('/api/admin/customers/magic-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ customer_id: newId, redirect_path: '/account/set-password' }),
        });
        if (!linkRes.ok) {
          const linkData = await linkRes.json().catch(() => ({}));
          setSent({ email: form.email.trim(), mode: 'self', linkError: linkData.error || 'Could not send the set-up link.' });
          setSaving(false);
          return;
        }
        setSent({ email: form.email.trim(), mode: 'self', linkError: null });
        setSaving(false);
        return;
      }

      // Guest record — nothing to email, just close.
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  // Confirmed merge: fold the entered info into the affiliate's existing record
  // and reuse it (no duplicate customer is created). Applies the selected price
  // list to that record too.
  const confirmMerge = async () => {
    if (!conflict) return;
    setMerging(true);
    setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildPayload({ merge_into_affiliate_id: conflict.id })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge into the affiliate');
      }
      const targetId = data?.customer?.id ?? conflict.id;
      await applyPricelist(targetId);
      const name =
        [conflict.first_name, conflict.last_name].filter(Boolean).join(' ') || conflict.email;
      setMerged({ name });
    } catch (err: any) {
      setError(err.message || 'Failed to merge into the affiliate');
    } finally {
      setMerging(false);
    }
  };

  const fld =
    'w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-vital" />
            <h2 className="text-lg font-bold text-ink">New Customer</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        {merged ? (
          /* Success: merged into the affiliate's existing record */
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <Check className="w-5 h-5" />
              <span className="text-sm font-semibold">Merged into affiliate</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-surface border border-line rounded-lg text-sm text-ink">
              <Users className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
              <span>
                The details were added to{' '}
                <span className="font-medium break-all">{merged.name}</span>&apos;s existing
                affiliate record — no duplicate customer was created. You can invoice them
                straight from that record.
              </span>
            </div>
            <button
              type="button"
              onClick={onCreated}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : conflict ? (
          /* This email already belongs to an affiliate — prompt to merge */
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">
                  {[conflict.first_name, conflict.last_name].filter(Boolean).join(' ') || conflict.email}
                </span>{' '}
                (<span className="break-all">{conflict.email}</span>) is already an{' '}
                <span className="font-medium">affiliate</span>. Affiliates can be invoiced like any
                customer, so creating a new record would split this person in two.
              </span>
            </div>
            <p className="text-sm text-ink">
              Use the existing affiliate record? The details you entered will be added to it, and no
              duplicate customer will be created.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConflict(null); setError(''); }}
                disabled={merging}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 text-sm font-medium disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={merging}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 text-sm font-medium disabled:opacity-60"
              >
                {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {merging ? 'Merging…' : 'Use existing affiliate'}
              </button>
            </div>
          </div>
        ) : sent ? (
          /* Success: link emailed (or couldn't be) */
          <div className="p-5 space-y-4">
            {sent.linkError ? (
              <>
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Customer created, but the set-up link couldn&apos;t be emailed:{' '}
                    <span className="font-medium">{sent.linkError}</span>. You can resend it
                    from the Customers list (the <em>Login Link</em> button).
                  </span>
                </div>
              </>
            ) : sent.mode === 'set' ? (
              <>
                <div className="flex items-center gap-2 text-emerald-700">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-semibold">Customer created</span>
                </div>
                <div className="flex items-start gap-2 p-3 bg-surface border border-line rounded-lg text-sm text-ink">
                  <KeyRound className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                  <span>
                    The account for{' '}
                    <span className="font-medium break-all">{sent.email}</span> is ready. They
                    can sign in right away with the password you set. Be sure to share it with
                    them.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-emerald-700">
                  <Check className="w-5 h-5" />
                  <span className="text-sm font-semibold">Customer created</span>
                </div>
                <div className="flex items-start gap-2 p-3 bg-surface border border-line rounded-lg text-sm text-ink">
                  <Mail className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
                  <span>
                    A set-up link was emailed to{' '}
                    <span className="font-medium break-all">{sent.email}</span>. They&apos;ll
                    click it to sign in and choose their own password.
                  </span>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={onCreated}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={fld} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
              <input className={fld} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </div>
            <input className={fld} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <input className={fld} type="email" placeholder="Alternate email (optional)" value={form.alternate_email} onChange={(e) => set('alternate_email', e.target.value)} />
            <input className={fld} placeholder="Phone (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />

            <div>
              <label className="block text-xs font-medium text-ink mb-1">Price Currency</label>
              <div className="grid grid-cols-2 gap-2">
                {(['CAD', 'USD'] as const).map((cur) => {
                  const isActive = priceCurrency === cur;
                  return (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setPriceCurrency(cur)}
                      aria-pressed={isActive}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                        isActive
                          ? 'bg-ink text-white border-ink'
                          : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                      }`}
                    >
                      <span className="font-semibold">$</span> {cur}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-ink-muted">New invoices for this customer default to this currency.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1">Product Labels</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: true, label: 'With labels' },
                  { value: false, label: 'Without labels' },
                ] as const).map((opt) => {
                  const isActive = withLabels === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setWithLabels(opt.value)}
                      aria-pressed={isActive}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                        isActive
                          ? 'bg-ink text-white border-ink'
                          : 'bg-surface text-ink-muted border-line hover:border-ink/20'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                New invoices default to this. The product label is the sticker on each
                vial — not the shipping label.
              </p>
            </div>

            {priceLists.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-ink mb-1 inline-flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5 text-vital" /> Price List <span className="text-ink-muted font-normal">(optional)</span>
                </label>
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className={fld}
                >
                  <option value="">Default catalog prices</option>
                  {priceLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}{l.is_active ? ' (active)' : ''} · {l.item_count} products
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">Applied to the customer right after they&apos;re created.</p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="accent-ink w-4 h-4" />
              Create a login for this customer
            </label>

            {createLogin ? (
              <div className="space-y-3">
                <p className="text-xs text-ink-muted">Choose how the customer&apos;s password is set up.</p>

                <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="radio"
                    name="passwordMode"
                    checked={passwordMode === 'set'}
                    onChange={() => setPasswordMode('set')}
                    className="accent-ink w-4 h-4 mt-0.5"
                  />
                  <span>
                    Set the password now
                    <span className="block text-xs text-ink-muted">You choose the password and share it with the customer.</span>
                  </span>
                </label>

                {passwordMode === 'set' && (
                  <input
                    className={fld}
                    type="password"
                    placeholder="Password (min. 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                )}

                <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="radio"
                    name="passwordMode"
                    checked={passwordMode === 'self'}
                    onChange={() => setPasswordMode('self')}
                    className="accent-ink w-4 h-4 mt-0.5"
                  />
                  <span>
                    Let the customer set their own
                    <span className="block text-xs text-ink-muted">We email a sign-in link; clicking it prompts them to choose a password.</span>
                  </span>
                </label>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                Without a login, this creates a record you can invoice — they can claim the account later by signing up with the same email.
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 text-sm font-medium">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 text-sm font-medium disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving && createLogin && passwordMode === 'self' ? 'Creating & sending…' : saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
