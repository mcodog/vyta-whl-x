'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, RotateCcw, AlertCircle, Check, Loader2, Mail, Send } from 'lucide-react';
import { useUserRole } from '../../layout';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_ADMIN_BODY,
  DEFAULT_ADMIN_SUBJECT,
  DEFAULT_CUSTOMER_BODY,
  DEFAULT_CUSTOMER_SUBJECT,
  MERGE_VARS,
  renderTemplate,
} from '@/lib/invoice-email-templates';

type TemplateKind = 'customer' | 'admin';

interface TemplateState {
  customerSubject: string;
  customerBody: string;
  adminSubject: string;
  adminBody: string;
}

const sampleVars = Object.fromEntries(
  MERGE_VARS.map((v) => [v.name, v.sample]),
);

export default function EmailTemplatesPage() {
  const userRole = useUserRole();
  const isReadOnly = userRole !== 'admin';

  const [active, setActive] = useState<TemplateKind>('customer');
  const [state, setState] = useState<TemplateState>({
    customerSubject: '',
    customerBody: '',
    adminSubject: '',
    adminBody: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          setState({
            customerSubject: data.invoice_customer_email_subject || DEFAULT_CUSTOMER_SUBJECT,
            customerBody: data.invoice_customer_email_body || DEFAULT_CUSTOMER_BODY,
            adminSubject: data.invoice_admin_email_subject || DEFAULT_ADMIN_SUBJECT,
            adminBody: data.invoice_admin_email_body || DEFAULT_ADMIN_BODY,
          });
        }
      } catch (e) {
        setError('Failed to load templates');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const subject =
    active === 'customer' ? state.customerSubject : state.adminSubject;
  const bodyText =
    active === 'customer' ? state.customerBody : state.adminBody;

  const previewSubject = useMemo(
    () => renderTemplate(subject, sampleVars),
    [subject],
  );
  const previewBody = useMemo(
    () => renderTemplate(bodyText, sampleVars),
    [bodyText],
  );

  const update = (patch: Partial<TemplateState>) =>
    setState((s) => ({ ...s, ...patch }));

  const onSubjectChange = (v: string) =>
    update(active === 'customer' ? { customerSubject: v } : { adminSubject: v });
  const onBodyChange = (v: string) =>
    update(active === 'customer' ? { customerBody: v } : { adminBody: v });

  const resetActive = () => {
    if (active === 'customer') {
      update({
        customerSubject: DEFAULT_CUSTOMER_SUBJECT,
        customerBody: DEFAULT_CUSTOMER_BODY,
      });
    } else {
      update({
        adminSubject: DEFAULT_ADMIN_SUBJECT,
        adminBody: DEFAULT_ADMIN_BODY,
      });
    }
  };

  const insertVar = (varName: string) => {
    const token = `{{${varName}}}`;
    const ta = document.activeElement;
    if (ta instanceof HTMLTextAreaElement || ta instanceof HTMLInputElement) {
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const next = ta.value.slice(0, start) + token + ta.value.slice(end);
      if (ta === document.activeElement) {
        // Drive React-controlled values via the change handler
        if (ta.id === 'tpl-subject') onSubjectChange(next);
        else if (ta.id === 'tpl-body') onBodyChange(next);
        else return;
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(start + token.length, start + token.length);
        });
      }
    } else {
      // No focus target — append to body
      onBodyChange(bodyText + token);
    }
  };

  const save = async () => {
    if (isReadOnly) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated');
        return;
      }
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          invoice_customer_email_subject: state.customerSubject,
          invoice_customer_email_body: state.customerBody,
          invoice_admin_email_subject: state.adminSubject,
          invoice_admin_email_body: state.adminBody,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
      setSuccess('Templates saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-ink-muted text-sm">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/settings"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Invoice email templates</h1>
            <p className="text-sm text-ink-muted">
              Drafts used when sending invoices. Live preview uses sample data.
            </p>
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || isReadOnly}
          className="inline-flex items-center gap-2 px-4 py-2 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save templates
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
          <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
          <span className="text-green-700 text-sm">{success}</span>
        </div>
      )}

      <div className="inline-flex p-1 bg-surface border border-line rounded-lg mb-5">
        <button
          onClick={() => setActive('customer')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
            active === 'customer' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Send className="w-4 h-4" /> Customer email
        </button>
        <button
          onClick={() => setActive('admin')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
            active === 'admin' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Mail className="w-4 h-4" /> Admin copy
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="bg-white rounded-xl border border-line p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              {active === 'customer' ? 'Customer email' : 'Admin copy'}
            </h2>
            <button
              onClick={resetActive}
              disabled={isReadOnly}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset to default
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
              Subject
            </label>
            <input
              id="tpl-subject"
              type="text"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
              Body
            </label>
            <textarea
              id="tpl-body"
              value={bodyText}
              onChange={(e) => onBodyChange(e.target.value)}
              disabled={isReadOnly}
              rows={16}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50"
            />
            <p className="text-xs text-ink-muted mt-1">
              Use {'{{merge_vars}}'} below. The PDF is attached automatically.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-ink-muted uppercase tracking-wider mb-2">
              Available merge vars (click to insert)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MERGE_VARS.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVar(v.name)}
                  disabled={isReadOnly}
                  title={v.description}
                  className="px-2 py-1 text-xs font-mono bg-surface border border-line rounded-md text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-50"
                >
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-xl border border-line p-5">
          <h2 className="text-sm font-semibold text-ink mb-4">Preview</h2>
          <div className="border border-line rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-surface border-b border-line">
              <div className="text-xs text-ink-muted">Subject</div>
              <div className="text-sm font-medium text-ink mt-0.5">{previewSubject}</div>
            </div>
            <div className="px-4 py-4 text-sm text-ink whitespace-pre-wrap leading-relaxed">
              {previewBody}
            </div>
            <div className="px-4 py-3 bg-surface border-t border-line text-xs text-ink-muted">
              📎 INV-1042.pdf (attached)
            </div>
          </div>
          <p className="text-xs text-ink-muted mt-3">
            Preview uses sample values. Actual sends will substitute real invoice data.
          </p>
        </div>
      </div>
    </div>
  );
}
