'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Megaphone, Save, AlertCircle, Image as ImageIcon, Upload, BarChart3, ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@/lib/site-config';

async function authed(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

// Upload an image via the shared product-image endpoint (permitted for the
// marketing role) and return its public URL.
async function uploadImage(file: File): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/admin/products/upload', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '' }));
    throw new Error(error || `Upload failed (${res.status})`);
  }
  const { url } = await res.json();
  return url as string;
}

export default function AdminMarketingPage() {
  const { canManageMarketing } = usePermissions();
  const readOnly = !canManageMarketing;

  const [form, setForm] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null);

  const logoInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authed('/api/admin/marketing');
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const { config } = await res.json();
        setForm(config);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load marketing settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const handleUpload = async (kind: 'logo' | 'favicon', file: File | null) => {
    if (!file) return;
    setUploading(kind);
    setError('');
    try {
      const url = await uploadImage(file);
      set(kind === 'logo' ? 'logo_url' : 'favicon_url', url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await authed('/api/admin/marketing', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: '' }));
        throw new Error(msg || `Save failed (${res.status})`);
      }
      const { config } = await res.json();
      setForm(config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60';

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-bronze" /> Marketing
          </h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Storefront branding and web analytics. Controls the site name, logo and favicon,
            and installs GA4 / Meta Pixel with an optional cookie-consent banner.
          </p>
        </div>
        {canManageMarketing && (
          <button
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}
      {readOnly && !loading && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700">Read-only access — contact an administrator to make changes.</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center text-ink-muted text-sm">Loading…</div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* Branding */}
          <section className="bg-white rounded-xl border border-line p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <ImageIcon className="w-4 h-4 text-bronze" />
              <h2 className="text-base font-bold text-ink">Store branding</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Store name</label>
                <input
                  value={form.store_name}
                  disabled={readOnly}
                  onChange={(e) => set('store_name', e.target.value)}
                  className={inputCls}
                  placeholder="Aminocan Peptides"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Tagline</label>
                <input
                  value={form.store_tagline}
                  disabled={readOnly}
                  onChange={(e) => set('store_tagline', e.target.value)}
                  className={inputCls}
                  placeholder="Research Peptides"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <ImageField
                label="Logo"
                url={form.logo_url}
                readOnly={readOnly}
                uploading={uploading === 'logo'}
                inputRef={logoInput}
                onPick={() => logoInput.current?.click()}
                onFile={(f) => handleUpload('logo', f)}
                onUrlChange={(v) => set('logo_url', v || null)}
                inputCls={inputCls}
              />
              <ImageField
                label="Favicon"
                url={form.favicon_url}
                readOnly={readOnly}
                uploading={uploading === 'favicon'}
                inputRef={faviconInput}
                onPick={() => faviconInput.current?.click()}
                onFile={(f) => handleUpload('favicon', f)}
                onUrlChange={(v) => set('favicon_url', v || null)}
                inputCls={inputCls}
              />
            </div>
          </section>

          {/* Tracking & consent */}
          <section className="bg-white rounded-xl border border-line p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-bronze" />
              <h2 className="text-base font-bold text-ink">Tracking &amp; consent</h2>
            </div>
            <p className="text-xs text-ink-muted mb-4">
              Paste your IDs to install the tags site-wide. Leave a field blank to disable that tag.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">GA4 Measurement ID</label>
                <input
                  value={form.ga4_measurement_id ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set('ga4_measurement_id', e.target.value || null)}
                  className={inputCls}
                  placeholder="G-XXXXXXXXXX"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Meta Pixel ID</label>
                <input
                  value={form.meta_pixel_id ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set('meta_pixel_id', e.target.value || null)}
                  className={inputCls}
                  placeholder="123456789012345"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={form.tracking_consent_required}
                disabled={readOnly}
                onChange={(e) => set('tracking_consent_required', e.target.checked)}
                className="mt-0.5 rounded border-line accent-bronze"
              />
              <span className="text-sm text-ink">
                <span className="font-medium flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Require cookie consent (GDPR)
                </span>
                <span className="block text-xs text-ink-muted mt-0.5">
                  Show a consent banner and only load the pixels after the visitor accepts. Turn
                  off only if you have another lawful basis to track without consent.
                </span>
              </span>
            </label>
          </section>
        </div>
      )}
    </>
  );
}

function ImageField({
  label, url, readOnly, uploading, inputRef, onPick, onFile, onUrlChange, inputCls,
}: {
  label: string;
  url: string | null;
  readOnly: boolean;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFile: (f: File | null) => void;
  onUrlChange: (v: string) => void;
  inputCls: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-11 h-11 rounded-lg border border-line bg-surface flex items-center justify-center overflow-hidden">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="w-4 h-4 text-ink-muted" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <input
            value={url ?? ''}
            disabled={readOnly}
            onChange={(e) => onUrlChange(e.target.value)}
            className={inputCls}
            placeholder="https://… or upload"
          />
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-surface text-sm text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" /> {uploading ? '…' : 'Upload'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
