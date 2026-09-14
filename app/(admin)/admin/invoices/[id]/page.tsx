'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, FileText, Download, Edit2, DollarSign, Loader2, Pencil, Check, X,
  CreditCard, AlertCircle, Trash2, Mail, Send, Tag, Truck, Save, Package,
  RefreshCw, ExternalLink, ChevronDown, User, Users, MapPin, Receipt, Undo2,
  ArrowLeftRight,
} from 'lucide-react';
import { supabase, type Invoice, type InvoiceStatus } from '@/lib/supabase';
import {
  getInvoice, updateInvoiceStatus, deleteInvoice,
  getInvoiceTracking, replaceInvoice, type InvoiceTrackingResult,
} from '@/lib/admin/invoices';
import { updateOrderTracking } from '@/lib/admin/api';
import { INVOICE_STATUS_META, INVOICE_STATUSES } from '@/lib/admin/invoice-status';
import { lineItemSku, lineItemVialsPerBox, lineItemVialCount } from '@/lib/admin/invoice-html';
import ConfirmDeleteDialog from '@/components/admin/ConfirmDeleteDialog';
import ExportInvoiceDialog from '@/components/admin/ExportInvoiceDialog';
import ConfirmActionDialog from '@/components/admin/ConfirmActionDialog';
import RecordPaymentDialog from '@/components/admin/RecordPaymentDialog';
import ReversePaymentDialog from '@/components/admin/ReversePaymentDialog';
import PaymentEmailBadge from '@/components/admin/PaymentEmailBadge';
import PaymentRequestPanel from '@/components/admin/PaymentRequestPanel';
import PrepaidPurchaseOrders from '@/components/admin/PrepaidPurchaseOrders';
import { convertInvoiceToPrepaid } from '@/lib/admin/prepaid-purchase-orders';
import FulfillmentPanel from '@/app/(admin)/admin/invoices/_components/FulfillmentPanel';
import ShippingLabelPanel from '@/app/(admin)/admin/orders/[id]/_components/ShippingLabelPanel';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit, canDelete, canEditInvoice, canViewInvoices } from '@/lib/permissions';

function renderPreview(tpl: string, inv: Invoice): string {
  const customerName =
    (inv.customer
      ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(' ')
      : inv.customer_name) || 'Customer';
  const [first, ...rest] = customerName.split(' ').filter(Boolean);
  const amountPaid = inv.amount_paid ?? 0;
  const amountDue = inv.amount_due ?? Math.max(0, Number(inv.total) - amountPaid);
  const vars: Record<string, string> = {
    customer_name: customerName,
    customer_first_name: first ?? customerName,
    customer_last_name: rest.join(' '),
    customer_email: inv.customer_email ?? inv.customer?.email ?? '',
    invoice_number: inv.invoice_number,
    invoice_total: Number(inv.total).toFixed(2),
    amount_due: amountDue.toFixed(2),
    amount_paid: amountPaid.toFixed(2),
    due_date: new Date(inv.due_date).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    issue_date: new Date(inv.issue_date).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    currency: inv.currency === 'USD' ? 'USD' : 'CAD',
    sent_by_email: '',
    company_name: 'VYTA Biosciences',
  };
  return tpl.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, k) => vars[k] ?? `{{${k}}}`);
}

export default function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const userRole = useUserRole();
  // Affiliates may view/download/edit their own customers' invoices; sending
  // emails, recording payments and deleting stay admin-only.
  const canView = canViewInvoices(userRole);
  const canEditInv = canEditInvoice(userRole);
  const isAdmin = canEdit(userRole);
  const deletable = canDelete(userRole);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState<InvoiceStatus>('draft');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showStockConfirm, setShowStockConfirm] = useState(false);

  // Record-payment flow now lives in the shared RecordPaymentDialog (also used
  // by the invoices list's per-row quick action); this just toggles it.
  const [showPayModal, setShowPayModal] = useState(false);
  // Reverse-payment flow (shared ReversePaymentDialog) — undo a recorded payment.
  const [showReverseModal, setShowReverseModal] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Less-critical meta (sales person, markings, dates, notes) is tucked into a
  // collapsible panel so it doesn't crowd the primary content.
  const [showDetails, setShowDetails] = useState(false);

  // Inline due-date editing (from the "More details" panel) so the payment
  // deadline can be adjusted without opening the full edit form.
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState('');
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [switchingCurrency, setSwitchingCurrency] = useState(false);

  // Linked-order tracking (live-refreshed on load when a shipment exists) plus
  // the order-style "email customer" actions.
  const [tracking, setTracking] = useState<InvoiceTrackingResult | null>(null);
  const [trackingInput, setTrackingInput] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const [refreshingTracking, setRefreshingTracking] = useState(false);
  const [custEmailSending, setCustEmailSending] = useState(false);
  const [custEmailSent, setCustEmailSent] = useState('');
  const [custEmailError, setCustEmailError] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportNotice, setExportNotice] = useState('');

  // Convert a standard invoice into a prepaid (procurement) invoice.
  const [showConvert, setShowConvert] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [bccList, setBccList] = useState<
    Array<{ email: string; checked: boolean; adhoc: boolean; label?: string }>
  >([]);
  const [newBccInput, setNewBccInput] = useState('');
  const [newBccError, setNewBccError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ subject: string; body: string } | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const refresh = async () => {
    const inv = await getInvoice(id);
    setInvoice(inv);
    if (inv) setStatusDraft(inv.status);
  };

  const handleConvertToPrepaid = async () => {
    setConverting(true);
    setConvertError('');
    try {
      await convertInvoiceToPrepaid(id);
      await refresh();
      setShowConvert(false);
    } catch (e: any) {
      setConvertError(e?.message ?? 'Could not convert invoice');
    } finally {
      setConverting(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    refresh().finally(() => setLoading(false));
  }, [id]);

  // Seed + live-refresh the linked order's tracking whenever the invoice first
  // loads. The endpoint only calls Easyship when the order actually has a
  // shipment; for invoices with no order it returns hasOrder:false and the page
  // shows the fallback. Keyed on invoice id so it doesn't clobber the tracking
  // input on every unrelated refresh().
  useEffect(() => {
    if (!invoice) return;
    setTrackingInput(invoice.order?.tracking_number ?? '');
    let cancelled = false;
    (async () => {
      try {
        const res = await getInvoiceTracking(id, { refresh: true });
        if (cancelled) return;
        setTracking(res);
        if (res.tracking?.tracking_number) setTrackingInput(res.tracking.tracking_number);
      } catch {
        if (!cancelled) setTracking({ hasOrder: Boolean(invoice.order?.id), tracking: null });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const openPdf = async (download = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `/api/admin/invoices/${id}/pdf${download ? '?download=1' : ''}`;
    const res = await fetch(url, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) return alert('Could not open PDF');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  // Line items tied to a product — these are what get decremented from stock
  // when the invoice is marked paid (the first time only).
  const stockLineItems = (invoice?.line_items ?? []).filter((li) => li.product_id);
  // Will marking the invoice paid trigger a stock decrement right now?
  const willDecrementStock =
    statusDraft === 'paid' &&
    invoice?.status !== 'paid' &&
    !(invoice as any)?.stock_adjusted &&
    stockLineItems.length > 0;
  // Will cancelling the invoice give the previously-sold stock back?
  const willRestoreStock =
    statusDraft === 'cancelled' &&
    invoice?.status !== 'cancelled' &&
    Boolean((invoice as any)?.stock_adjusted) &&
    stockLineItems.length > 0;

  // Clicking the check button: confirm first if this will change stock.
  const handleStatusApply = () => {
    if (!invoice) return;
    setStatusMsg(null);
    if (willDecrementStock) {
      setShowStockConfirm(true);
      return;
    }
    void applyStatusChange();
  };

  const applyStatusChange = async () => {
    if (!invoice) return;
    setSavingStatus(true);
    setStatusMsg(null);
    const adjustsStock = willDecrementStock;
    const restoresStock = willRestoreStock;
    try {
      await updateInvoiceStatus(invoice.id, statusDraft);
      setShowStockConfirm(false);
      setEditingStatus(false);
      await refresh();
      setStatusMsg({
        type: 'success',
        text: adjustsStock
          ? 'Status updated — product stock has been reduced.'
          : restoresStock
            ? 'Invoice cancelled — product stock has been restored.'
            : 'Status updated.',
      });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: e?.message ?? 'Could not update status' });
    } finally {
      setSavingStatus(false);
    }
  };

  const startEditDueDate = () => {
    if (!invoice) return;
    // Seed the picker from the saved due date (YYYY-MM-DD for the date input).
    setDueDateDraft(new Date(invoice.due_date).toISOString().slice(0, 10));
    setDueDateError(null);
    setEditingDueDate(true);
  };

  const saveDueDate = async () => {
    if (!invoice) return;
    if (!dueDateDraft) {
      setDueDateError('Pick a due date');
      return;
    }
    setSavingDueDate(true);
    setDueDateError(null);
    try {
      await replaceInvoice(invoice.id, { due_date: dueDateDraft });
      setEditingDueDate(false);
      await refresh();
    } catch (e: any) {
      setDueDateError(e?.message ?? 'Could not update due date');
    } finally {
      setSavingDueDate(false);
    }
  };

  // Admin-only: flip the invoice's billing currency (CAD ↔ USD) as a label only.
  // The amounts are NOT converted or re-priced — the PATCH sends the currency by
  // itself, so the server's totals-recalc path is skipped and every stored value
  // (line unit prices, subtotal, total) stays exactly as it was. Used to correct
  // an invoice that was raised in the wrong currency.
  const switchCurrency = async () => {
    if (!invoice || switchingCurrency) return;
    const next = invoice.currency === 'USD' ? 'CAD' : 'USD';
    setSwitchingCurrency(true);
    setStatusMsg(null);
    try {
      await replaceInvoice(invoice.id, { currency: next });
      await refresh();
      setStatusMsg({ type: 'success', text: `Invoice now billed in ${next} — amounts unchanged.` });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: e?.message ?? 'Could not change currency' });
    } finally {
      setSwitchingCurrency(false);
    }
  };

  const openEmailModal = async () => {
    if (!invoice) return;
    setEmailError(null);
    setEmailSuccess(null);
    setEmailRecipient(invoice.customer_email ?? invoice.customer?.email ?? '');
    setNewBccInput('');
    setNewBccError(null);
    setBccList([]);
    setShowEmailModal(true);
    setTemplatesLoading(true);

    // Optional "also notify" recipients resolved from the invoice: the sales
    // person on the invoice, and the affiliate the customer is bound to. Both
    // are offered as opt-in (unchecked) copy recipients.
    const extras: Array<{ email: string; checked: boolean; adhoc: boolean; label?: string }> = [];
    // Every sales person credited on the invoice, primary first, de-duplicated
    // by address. Falls back to the legacy single sales person.
    const rosterEmails = [...(invoice.sales_people ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((m) => m.sales_person?.email)
      .filter((e): e is string => Boolean(e));
    const spEmails = rosterEmails.length > 0
      ? rosterEmails
      : invoice.sales_person?.email
        ? [invoice.sales_person.email]
        : [];
    for (const email of [...new Set(spEmails)]) {
      extras.push({ email, checked: false, adhoc: false, label: 'Sales person' });
    }
    const affiliateId = invoice.customer?.affiliate_id ?? null;
    if (affiliateId) {
      const { data: aff } = await supabase
        .from('affiliates')
        .select('email')
        .eq('id', affiliateId)
        .maybeSingle();
      if (aff?.email) {
        extras.push({ email: aff.email, checked: false, adhoc: false, label: 'Affiliate' });
      }
    }

    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        setTemplates({
          subject: renderPreview(data.invoice_customer_email_subject || '', invoice),
          body: renderPreview(data.invoice_customer_email_body || '', invoice),
        });
        const configured: string[] = Array.isArray(data.invoice_cc_emails)
          ? data.invoice_cc_emails.filter((e: unknown): e is string => typeof e === 'string')
          : [];
        const entries: Array<{ email: string; checked: boolean; adhoc: boolean; label?: string }> =
          configured.map((email) => ({ email, checked: true, adhoc: false }));
        // Append the sales person / affiliate options, skipping any that are
        // already in the configured CC list (dedupe case-insensitively).
        const seen = new Set(entries.map((e) => e.email.toLowerCase()));
        for (const extra of extras) {
          if (!seen.has(extra.email.toLowerCase())) {
            entries.push(extra);
            seen.add(extra.email.toLowerCase());
          }
        }
        setBccList(entries);
      } else {
        setBccList(extras);
      }
    } finally {
      setTemplatesLoading(false);
    }
  };

  const toggleBcc = (email: string) => {
    setBccList((list) =>
      list.map((b) => (b.email === email ? { ...b, checked: !b.checked } : b)),
    );
  };

  const removeAdhocBcc = (email: string) => {
    setBccList((list) => list.filter((b) => !(b.adhoc && b.email === email)));
  };

  const addAdhocBcc = () => {
    setNewBccError(null);
    const value = newBccInput.trim();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setNewBccError('Invalid email format');
      return;
    }
    if (bccList.some((b) => b.email.toLowerCase() === value.toLowerCase())) {
      setNewBccError('Already in the list');
      return;
    }
    setBccList((list) => [...list, { email: value, checked: true, adhoc: true }]);
    setNewBccInput('');
  };

  const submitSendEmail = async () => {
    if (!invoice) return;
    setEmailError(null);
    setEmailSuccess(null);
    if (!emailRecipient.trim()) {
      setEmailError('Recipient email is required');
      return;
    }
    setEmailSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const bcc = bccList.filter((b) => b.checked).map((b) => b.email);
      const res = await fetch(`/api/admin/invoices/${invoice.id}/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ to: emailRecipient.trim(), bcc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setEmailSuccess(`Sent to ${data.to}${data.bcc_count ? ` (+${data.bcc_count} copy)` : ''}`);
      await refresh();
      setTimeout(() => setShowEmailModal(false), 1200);
    } catch (e: any) {
      setEmailError(e?.message ?? 'Send failed');
    } finally {
      setEmailSending(false);
    }
  };

  const submitDelete = async () => {
    if (!invoice) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteInvoice(invoice.id);
      router.push('/admin/invoices');
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete invoice');
      setDeleting(false);
    }
  };

  // Save a manual tracking number onto the linked order (admin). Reuses the
  // order tracking mutation, then re-reads the stored snapshot.
  const handleSaveTracking = async () => {
    const orderId = invoice?.order?.id;
    if (!orderId) return;
    setSavingTracking(true);
    await updateOrderTracking(orderId, trackingInput.trim());
    await refresh();
    try {
      setTracking(await getInvoiceTracking(id, { refresh: false }));
    } catch { /* non-fatal */ }
    setSavingTracking(false);
  };

  // Manual "check for live updates" — hits Easyship and persists any changes.
  const handleRefreshTracking = async () => {
    if (!invoice?.order?.id) return;
    setRefreshingTracking(true);
    try {
      const res = await getInvoiceTracking(id, { refresh: true });
      setTracking(res);
      if (res.tracking?.tracking_number) setTrackingInput(res.tracking.tracking_number);
    } catch { /* non-fatal */ }
    setRefreshingTracking(false);
  };

  // Send a customer notification (order confirmation / shipping) through the
  // authenticated admin endpoint so the send is recorded with who/when, then
  // refresh so the "Email Customer" panel shows the updated "Sent by" line.
  const sendCustomerNotification = async (
    kind: 'order_confirmation' | 'shipping_notification',
    flag: 'confirmation' | 'shipping',
  ) => {
    if (!invoice) return;
    const to = invoice.customer_email ?? invoice.customer?.email ?? '';
    if (!to) return;
    setCustEmailError('');
    setCustEmailSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/invoices/${invoice.id}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          kind,
          ...(kind === 'shipping_notification'
            ? { trackingNumber: trackingInput || invoice.order?.tracking_number || 'Pending' }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setCustEmailSent(flag);
      setTimeout(() => setCustEmailSent(''), 3000);
      await refresh();
    } catch (e: any) {
      console.error('Failed to send email:', e);
      setCustEmailError(e?.message ?? 'Send failed');
    }
    setCustEmailSending(false);
  };

  const sendCustomerConfirmation = () =>
    sendCustomerNotification('order_confirmation', 'confirmation');
  const sendCustomerShipping = () =>
    sendCustomerNotification('shipping_notification', 'shipping');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!invoice) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted text-sm">Invoice not found.</p>
        <Link href="/admin/invoices" scroll={false} className="mt-3 inline-block text-vital">Back</Link>
      </div>
    );
  }

  const effective = invoice.status_effective ?? invoice.status;
  const meta = INVOICE_STATUS_META[effective];
  const amountPaid = invoice.amount_paid ?? 0;
  const amountDue = invoice.amount_due ?? Math.max(0, invoice.total - amountPaid);
  const isPaid = invoice.status === 'paid';

  // Linked-order derived data (all null-safe: some invoices have no order).
  const linkedOrder = invoice.order ?? null;
  const custEmailAddress = invoice.customer_email ?? invoice.customer?.email ?? '';
  // Prefer the live tracking snapshot, falling back to the order's stored fields.
  const trackNumber = tracking?.tracking?.tracking_number ?? linkedOrder?.tracking_number ?? null;
  const trackStatus = tracking?.tracking?.tracking_status ?? linkedOrder?.tracking_status ?? null;
  const trackUrl = tracking?.tracking?.tracking_url ?? linkedOrder?.tracking_url ?? null;
  const trackCarrier = tracking?.tracking?.carrier ?? linkedOrder?.carrier ?? null;
  const shipAddr = linkedOrder?.shipping_address ?? null;
  // Client shipment (Packing List flow): the invoice bills the customer but the
  // parcel ships to the customer's client (end-recipient). Surface the client's
  // ship-to details, mirroring what the create/edit form captures.
  const shipsToClient = Boolean(invoice.ships_to_client && invoice.client);
  const client = invoice.client ?? null;
  const customerDisplayName =
    (invoice.customer
      ? `${invoice.customer.first_name} ${invoice.customer.last_name}`.trim()
      : invoice.customer_name) || 'the customer';
  const orderIsPickup =
    linkedOrder?.fulfillment_type === 'pickup' || invoice.fulfillment_type === 'pickup';
  const orderStatusDisplay = tracking?.order_status ?? linkedOrder?.status ?? null;

  // Everyone credited on this invoice, primary first. An invoice raised before
  // rosters existed has none, so fall back to its single sales person — the
  // same numbers, just read from the legacy columns.
  const salesTeam: { sales_person_id: string; name: string; rate: number; amount: number }[] =
    (invoice.sales_people ?? []).length > 0
      ? [...(invoice.sales_people ?? [])]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((m) => ({
            sales_person_id: m.sales_person_id,
            name:
              [m.sales_person?.first_name, m.sales_person?.last_name].filter(Boolean).join(' ') ||
              m.sales_person?.email ||
              'Unknown',
            rate: Number(m.commission_rate) || 0,
            amount: Number(m.commission_amount) || 0,
          }))
      : invoice.sales_person
        ? [
            {
              sales_person_id: invoice.sales_person.id,
              name: `${invoice.sales_person.first_name} ${invoice.sales_person.last_name}`.trim(),
              rate: Number(invoice.sales_person_commission_rate) || 0,
              amount: Number(invoice.sales_person_commission_amount) || 0,
            },
          ]
        : [];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          {/* scroll={false} so Next doesn't jump to the top on this navigation;
              the list restores its own saved scroll position on mount. Without
              it, Next's default scroll-to-top overrides the restore (the browser
              Back button already works because it uses native scroll restore). */}
          <Link
            href="/admin/invoices"
            scroll={false}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-ink font-mono">{invoice.invoice_number}</h1>
              {invoice.invoice_type === 'prepaid' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-vital/10 text-vital">
                  <Package className="w-3 h-3" /> Prepaid
                </span>
              )}
            </div>
            <p className="text-sm text-ink-muted">
              Issued {new Date(invoice.issue_date).toLocaleDateString()} · Due {new Date(invoice.due_date).toLocaleDateString()}
            </p>
          </div>
        </div>
        {canView && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openPdf(false)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm"
            >
              <FileText className="w-4 h-4" /> View PDF
            </button>
            <button
              onClick={() => openPdf(true)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            {canEditInv && (
              <Link
                href={`/admin/invoices/${invoice.id}/edit`}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm"
              >
                <Edit2 className="w-4 h-4" /> Edit
              </Link>
            )}
            {isAdmin && invoice.invoice_type !== 'prepaid' && (
              <button
                onClick={() => { setConvertError(''); setShowConvert(true); }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-vital/50 text-ink-muted hover:text-vital rounded-lg text-sm"
                title="Turn this into a prepaid procurement invoice"
              >
                <Package className="w-4 h-4" /> Convert to Prepaid
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowExportModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-line hover:border-ink/20 text-ink-muted hover:text-ink rounded-lg text-sm"
              >
                <ExternalLink className="w-4 h-4" /> Send to site
              </button>
            )}
            {isAdmin && (
              <button
                onClick={openEmailModal}
                className="inline-flex items-center gap-2 px-3 py-2 bg-vital hover:bg-vital/90 text-white rounded-lg text-sm font-medium"
              >
                <Send className="w-4 h-4" /> Send Email
              </button>
            )}
          </div>
        )}
      </div>

      {exportNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><ExternalLink className="w-4 h-4" /> {exportNotice}</span>
          <button onClick={() => setExportNotice('')} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showConvert && (
        <ConfirmActionDialog
          title="Convert to prepaid invoice?"
          icon={Package}
          confirmLabel={converting ? 'Converting…' : 'Convert to Prepaid'}
          loading={converting}
          error={convertError}
          onConfirm={handleConvertToPrepaid}
          onClose={() => { if (!converting) setShowConvert(false); }}
          message={
            <>
              This marks <span className="font-medium text-ink">{invoice.invoice_number}</span> as a prepaid
              procurement invoice and auto-routes each product line to its <span className="font-medium text-ink">cheapest supplier</span>.
              A Supplier Purchase Orders panel appears where you can override any supplier and generate the POs.
              The invoice&apos;s totals and line items are unchanged.
            </>
          }
        />
      )}

      {showExportModal && invoice && (
        <ExportInvoiceDialog
          invoiceIds={[invoice.id]}
          onClose={() => setShowExportModal(false)}
          onDone={(summary) => setExportNotice(summary)}
        />
      )}

      {/* ── At-a-glance summary ───────────────────────────────────────────
          The four things a viewer needs immediately — payment status, what's
          owed, who it's for, and where it's shipping — surfaced before any
          scrolling. Primary actions (mark paid / record payment) live inline
          with the number they act on. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden border border-line mb-6">
        {/* Status */}
        <div className="bg-white p-5">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Status</div>
          {editingStatus ? (
            <div className="flex items-center gap-1.5">
              <select
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as InvoiceStatus)}
                disabled={savingStatus}
                className="flex-1 min-w-0 bg-surface border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:opacity-60"
              >
                {INVOICE_STATUSES.map((s) => (
                  <option key={s} value={s}>{INVOICE_STATUS_META[s].label}</option>
                ))}
              </select>
              <button
                onClick={handleStatusApply}
                disabled={savingStatus}
                title="Apply status"
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-ink text-white disabled:opacity-60"
              >
                {savingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button
                onClick={() => { setEditingStatus(false); setStatusDraft(invoice.status); setStatusMsg(null); }}
                disabled={savingStatus}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink disabled:opacity-60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${meta.badge}`}>{meta.label}</span>
              {canEditInv && (
                <button
                  onClick={() => { setEditingStatus(true); setStatusMsg(null); }}
                  title="Edit status"
                  className="text-ink-muted hover:text-ink"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {editingStatus && willDecrementStock && (
            <p className="mt-2 text-xs text-amber-700">
              Marking paid reduces stock for {stockLineItems.length} product
              {stockLineItems.length === 1 ? '' : 's'}.
            </p>
          )}
          {editingStatus && willRestoreStock && (
            <p className="mt-2 text-xs text-emerald-700">
              Cancelling restores stock for {stockLineItems.length} product
              {stockLineItems.length === 1 ? '' : 's'}.
            </p>
          )}
          {statusMsg && (
            <div
              className={`mt-2 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {statusMsg.type === 'success'
                ? <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
              <span>{statusMsg.text}</span>
            </div>
          )}
        </div>

        {/* Amount due */}
        <div className="bg-white p-5">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Amount Due</div>
          {amountDue <= 0 ? (
            <div className="text-xl font-bold text-emerald-600 flex items-center gap-1.5">
              <Check className="w-5 h-5" /> Paid
            </div>
          ) : (
            <div className="text-2xl font-bold text-vital tabular-nums">${amountDue.toFixed(2)}</div>
          )}
          <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
            ${invoice.total.toFixed(2)} total{amountPaid > 0 ? ` · $${amountPaid.toFixed(2)} paid` : ''}
          </div>
          {isAdmin && !isPaid && amountDue > 0 && (
            <button
              onClick={() => setShowPayModal(true)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium"
            >
              <DollarSign className="w-3.5 h-3.5" /> Record Payment
            </button>
          )}
        </div>

        {/* Customer */}
        <div className="bg-white p-5 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Customer</span>
            {invoice.customer_deleted && (
              <span
                title="This customer's record has been deleted"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-600 whitespace-nowrap"
              >
                <Trash2 className="w-2.5 h-2.5" /> Customer deleted
              </span>
            )}
          </div>
          <div className="text-sm font-medium text-ink truncate">
            {invoice.customer
              ? `${invoice.customer.first_name} ${invoice.customer.last_name}`
              : (invoice.customer_name ?? '—')}
          </div>
          <div className="text-xs text-ink-muted truncate">
            {invoice.customer?.email ?? invoice.customer_email ?? '—'}
          </div>
          {(invoice.customer?.phone ?? invoice.customer_phone) && (
            <div className="text-xs text-ink-muted truncate">{invoice.customer?.phone ?? invoice.customer_phone}</div>
          )}
        </div>

        {/* Shipping */}
        <div className="bg-white p-5 min-w-0">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Shipping</div>
          {orderIsPickup ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <Package className="w-4 h-4" /> Local pickup
            </span>
          ) : trackStatus ? (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600 capitalize">
                <Truck className="w-3 h-3" /> {String(trackStatus).replace(/_/g, ' ')}
              </span>
              {trackUrl && (
                <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-vital hover:underline">
                  Track shipment →
                </a>
              )}
            </div>
          ) : trackNumber ? (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-600">
                <Truck className="w-3 h-3" /> Tracking added
              </span>
              {trackUrl && (
                <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-vital hover:underline">
                  Track shipment →
                </a>
              )}
            </div>
          ) : linkedOrder ? (
            <span className="text-sm text-ink-muted">Not shipped yet</span>
          ) : (
            <span className="text-sm text-ink-muted">No linked order</span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* LEFT */}
        <div className="lg:col-span-2 space-y-6">
          {/* Line items — desktop table (≥lg) / stacked cards (mobile). Per
              ADR 0007: the table is untouched above lg; below lg it is hidden
              and replaced by item cards + a stacked totals block. */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">SKU</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Description</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Qty</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Unit $</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Disc</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {(invoice.line_items ?? []).map((li) => (
                  <tr key={li.id}>
                    <td className="px-5 py-3 font-mono text-xs text-ink-muted whitespace-nowrap">{lineItemSku(li) || '—'}</td>
                    <td className="px-5 py-3 text-ink">
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        {li.description}
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                            li.price_type === 'vial' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-vital/10 text-vital'
                          }`}
                          title={
                            li.price_type === 'vial'
                              ? 'Sold by the vial'
                              : `Sold by the box — ${lineItemVialsPerBox(li)} vials per box`
                          }
                        >
                          {li.price_type === 'vial'
                            ? 'Vial'
                            : `Box · ${lineItemVialsPerBox(li)}/box · ${lineItemVialCount(li)} vials`}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{li.qty}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-muted">${Number(li.unit_price).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{Number(li.discount_pct) || 0}%</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums">${Number(li.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface">
                <tr><td colSpan={5} className="px-5 py-2 text-right text-ink-muted">Subtotal</td><td className="px-5 py-2 text-right tabular-nums">${invoice.subtotal.toFixed(2)}</td></tr>
                <tr><td colSpan={5} className="px-5 py-2 text-right text-ink-muted">Tax ({invoice.tax_rate || 0}%)</td><td className="px-5 py-2 text-right tabular-nums">${invoice.tax_total.toFixed(2)}</td></tr>
                <tr><td colSpan={5} className="px-5 py-2 text-right text-ink-muted">Shipping</td><td className="px-5 py-2 text-right tabular-nums">${invoice.shipping_cost.toFixed(2)}</td></tr>
                {invoice.show_processing_fee !== false && Number(invoice.processing_fee) > 0 && (
                  <tr><td colSpan={5} className="px-5 py-2 text-right text-ink-muted">Processing Fee</td><td className="px-5 py-2 text-right tabular-nums">${Number(invoice.processing_fee).toFixed(2)}</td></tr>
                )}
                <tr><td colSpan={5} className="px-5 py-3 text-right font-semibold text-ink border-t border-line">Total</td><td className="px-5 py-3 text-right font-bold text-ink tabular-nums border-t border-line">${invoice.total.toFixed(2)}</td></tr>
                {amountPaid > 0 && (
                  <tr><td colSpan={5} className="px-5 py-2 text-right text-ink-muted">Paid</td><td className="px-5 py-2 text-right tabular-nums">− ${amountPaid.toFixed(2)}</td></tr>
                )}
                <tr><td colSpan={5} className="px-5 py-3 text-right text-vital font-semibold">Amount Due</td><td className="px-5 py-3 text-right text-vital font-bold tabular-nums">${amountDue.toFixed(2)}</td></tr>
              </tfoot>
            </table>
            </div>

            {/* Mobile line items (below lg): one card per line, then the totals
                stacked as label/amount rows — mirrors the table + tfoot above. */}
            <div className="lg:hidden">
              <ul className="divide-y divide-line/50">
                {(invoice.line_items ?? []).map((li) => (
                  <li key={li.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">{li.description}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-muted">{lineItemSku(li) || '—'}</span>
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                              li.price_type === 'vial' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-vital/10 text-vital'
                            }`}
                            title={
                              li.price_type === 'vial'
                                ? 'Sold by the vial'
                                : `Sold by the box — ${lineItemVialsPerBox(li)} vials per box`
                            }
                          >
                            {li.price_type === 'vial'
                              ? 'Vial'
                              : `Box · ${lineItemVialsPerBox(li)}/box · ${lineItemVialCount(li)} vials`}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">${Number(li.line_total).toFixed(2)}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                      <span>Qty <span className="text-ink tabular-nums font-medium">{li.qty}</span></span>
                      <span>Unit <span className="text-ink tabular-nums font-medium">${Number(li.unit_price).toFixed(2)}</span></span>
                      <span>Disc <span className="text-ink tabular-nums font-medium">{Number(li.discount_pct) || 0}%</span></span>
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="bg-surface px-5 py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums text-ink">${invoice.subtotal.toFixed(2)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Tax ({invoice.tax_rate || 0}%)</dt><dd className="tabular-nums text-ink">${invoice.tax_total.toFixed(2)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Shipping</dt><dd className="tabular-nums text-ink">${invoice.shipping_cost.toFixed(2)}</dd></div>
                {invoice.show_processing_fee !== false && Number(invoice.processing_fee) > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-ink-muted">Processing Fee</dt><dd className="tabular-nums text-ink">${Number(invoice.processing_fee).toFixed(2)}</dd></div>
                )}
                <div className="flex justify-between gap-3 pt-1.5 border-t border-line"><dt className="font-semibold text-ink">Total</dt><dd className="font-bold text-ink tabular-nums">${invoice.total.toFixed(2)}</dd></div>
                {amountPaid > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-ink-muted">Paid</dt><dd className="tabular-nums text-ink">− ${amountPaid.toFixed(2)}</dd></div>
                )}
                <div className="flex justify-between gap-3"><dt className="text-vital font-semibold">Amount Due</dt><dd className="text-vital font-bold tabular-nums">${amountDue.toFixed(2)}</dd></div>
              </dl>
            </div>
          </div>

          {/* Supplier Purchase Orders — prepaid invoices only. Lives in the main
              column (right under the line items it procures) so it reads as core
              content rather than a full-width afterthought. Route each line to a
              supplier (cheapest auto-selected, overridable) and generate the
              attached POs, downloadable as price-less supplier PDFs. */}
          {invoice.invoice_type === 'prepaid' && (
            <PrepaidPurchaseOrders
              invoiceId={invoice.id}
              currency={invoice.currency}
              lineItems={invoice.line_items ?? []}
              canAct={isAdmin}
            />
          )}

          {/* Fulfillment — packed photos, per-line progress, handling checklist
              and status actions, mirroring the warehouse fulfillment queue.
              Loads its own data lazily so it never blocks the invoice's first
              paint. */}
          <FulfillmentPanel invoiceId={id} canAct={isAdmin} onChanged={refresh} />

          {/* Payment history */}
          {invoice.payments && invoice.payments.length > 0 && (
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-vital" /> Payment History
                </h3>
                {isAdmin && (
                  <button
                    onClick={() => setShowReverseModal(true)}
                    title="Reverse a payment"
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Reverse
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {invoice.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 text-sm border-b border-line/50 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-ink capitalize">{p.method}{p.reference_note ? ` · ${p.reference_note}` : ''}</div>
                      <div className="text-xs text-ink-muted">{new Date(p.paid_at).toLocaleString()}</div>
                      <div className="mt-1">
                        <PaymentEmailBadge payment={p} />
                      </div>
                    </div>
                    <div className="font-semibold text-emerald-600 tabular-nums whitespace-nowrap">${Number(p.amount).toFixed(2)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Delete (admin only, bottom of left col) */}
          {deletable && (
            <div className="bg-white rounded-xl border border-line p-5">
              <button
                onClick={() => {
                  setDeleteError('');
                  setConfirmDelete(true);
                }}
                className="inline-flex items-center gap-2 text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" /> Delete invoice
              </button>
            </div>
          )}
        </div>

        {/* RIGHT — related info grouped into a few panels instead of a long
            stack of one-line cards */}
        <div className="space-y-6">
          {/* Order & Shipping — the linked order, where it's going, and the
              tracking (with admin controls) all read together in one panel. */}
          <SideCard title="Order & Shipping" icon={<Truck className="w-3.5 h-3.5" />}>
            {linkedOrder ? (
              <div className="divide-y divide-line/60">
                {/* Linked order */}
                <div className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/admin/orders/${linkedOrder.id}`}
                      className="font-mono text-sm text-ink hover:text-vital inline-flex items-center gap-1"
                    >
                      {linkedOrder.order_number ?? linkedOrder.id.slice(0, 8)}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    {orderStatusDisplay && (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted capitalize whitespace-nowrap">
                        {String(orderStatusDisplay).replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-ink-muted mt-1.5">
                    Order status follows the invoice automatically — marking it paid moves the
                    order into fulfillment.
                  </p>
                </div>

                {/* Shipping address */}
                <div className="py-3">
                  <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Ship to
                  </div>
                  {shipsToClient && client ? (
                    <ClientShipTo
                      client={client}
                      customerName={customerDisplayName}
                      packingList={{
                        at: invoice.packing_list_emailed_at,
                        by: invoice.packing_list_emailed_by_email ?? null,
                        to: invoice.packing_list_emailed_to,
                      }}
                    />
                  ) : (
                    <div className="text-sm text-ink space-y-0.5">
                      {shipAddr && typeof shipAddr === 'object' ? (
                        <>
                          {(shipAddr.firstName || shipAddr.lastName) && (
                            <p>{shipAddr.firstName} {shipAddr.lastName}</p>
                          )}
                          {shipAddr.address && <p>{shipAddr.address}</p>}
                          <p>{[shipAddr.city, shipAddr.state, shipAddr.postalCode].filter(Boolean).join(', ')}</p>
                          {shipAddr.country && <p>{shipAddr.country}</p>}
                          {shipAddr.phone && <p className="text-ink-muted">{shipAddr.phone}</p>}
                        </>
                      ) : orderIsPickup ? (
                        <p className="inline-flex items-center gap-1.5 text-ink-muted">
                          <Package className="w-3.5 h-3.5" /> Local pickup — no shipping address
                        </p>
                      ) : (
                        <p className="text-ink-muted">No address on file</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Tracking */}
                <div className="pt-3">
                  <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Truck className="w-3 h-3" /> Tracking
                  </div>
                  {trackNumber ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-sm text-ink break-all">{trackNumber}</div>
                          {trackCarrier && <div className="text-[11px] text-ink-muted">{trackCarrier}</div>}
                        </div>
                        {trackStatus && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600 whitespace-nowrap capitalize">
                            <Truck className="w-3 h-3" /> {String(trackStatus).replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {trackUrl && (
                        <a
                          href={trackUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-vital hover:underline"
                        >
                          Track shipment <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-sm text-ink-muted">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                      <span>
                        No tracking number yet.
                        {linkedOrder?.easyship_shipment_id
                          ? ' It will appear once the label is bought.'
                          : ''}
                      </span>
                    </div>
                  )}

                  {/* Admin controls: set a manual number + check live updates */}
                  {isAdmin && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={trackingInput}
                          onChange={(e) => setTrackingInput(e.target.value)}
                          placeholder="Enter tracking number"
                          className="flex-1 min-w-0 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
                        />
                        <button
                          onClick={handleSaveTracking}
                          disabled={savingTracking}
                          title="Save tracking number"
                          className="px-3 py-2 bg-vital/10 border border-vital/20 text-vital rounded-lg text-sm hover:bg-vital/20 transition-colors disabled:opacity-50"
                        >
                          {savingTracking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </button>
                      </div>
                      {linkedOrder.easyship_shipment_id && (
                        <button
                          onClick={handleRefreshTracking}
                          disabled={refreshingTracking}
                          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${refreshingTracking ? 'animate-spin' : ''}`} />
                          {refreshingTracking ? 'Checking Easyship…' : 'Check for live updates'}
                          {tracking?.live && !refreshingTracking && (
                            <span className="text-emerald-600">· live</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {shipsToClient && client && (
                  <div>
                    <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Ship to
                    </div>
                    <ClientShipTo
                      client={client}
                      customerName={customerDisplayName}
                      packingList={{
                        at: invoice.packing_list_emailed_at,
                        by: invoice.packing_list_emailed_by_email ?? null,
                        to: invoice.packing_list_emailed_to,
                      }}
                    />
                  </div>
                )}
                <div className="flex items-start gap-2 text-sm text-ink-muted">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>
                    No linked order for this invoice — shipping, tracking and order status aren&apos;t
                    available.
                  </span>
                </div>
              </div>
            )}
          </SideCard>

          {/* Shipping label — pick a courier, create the Easyship shipment, then
              buy and print/download the label. Admin only; hidden for pickup
              orders and invoices with no linked order. */}
          {isAdmin && linkedOrder && !orderIsPickup && (
            <ShippingLabelPanel orderId={linkedOrder.id} onChanged={refresh} />
          )}

          {/* Request payment — emails the customer a link to the hosted payment
              page (crypto or Visa/Mastercard) and reports back what they chose,
              the Stealth Health payment link, and any crypto reference. */}
          <PaymentRequestPanel invoice={invoice} canSend={isAdmin} onSent={refresh} />

          {/* Email customer — order confirmation + shipping notification (admin) */}
          {isAdmin && custEmailAddress && (
            <SideCard title="Email Customer" icon={<Mail className="w-3.5 h-3.5" />}>
              <div className="space-y-2">
                <div>
                  <button
                    onClick={sendCustomerConfirmation}
                    disabled={custEmailSending}
                    className="w-full px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-600 rounded-lg text-sm hover:bg-blue-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {custEmailSent === 'confirmation' ? (
                      <><Check className="w-3.5 h-3.5" /> Sent!</>
                    ) : (
                      <><Mail className="w-3.5 h-3.5" /> Send Order Confirmation</>
                    )}
                  </button>
                  {invoice.order_confirmation_emailed_at && (
                    <p className="mt-1 text-[10px] text-ink-muted flex items-center gap-1">
                      <Check className="w-2.5 h-2.5 text-emerald-600 flex-shrink-0" />
                      <span className="truncate">
                        Sent {new Date(invoice.order_confirmation_emailed_at).toLocaleString()}
                        {invoice.order_confirmation_emailed_by_email && (
                          <> by <span className="text-ink">{invoice.order_confirmation_emailed_by_email}</span></>
                        )}
                      </span>
                    </p>
                  )}
                </div>
                <div>
                  <button
                    onClick={sendCustomerShipping}
                    disabled={custEmailSending || !trackingInput}
                    className="w-full px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 rounded-lg text-sm hover:bg-indigo-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {custEmailSent === 'shipping' ? (
                      <><Check className="w-3.5 h-3.5" /> Sent!</>
                    ) : (
                      <><Truck className="w-3.5 h-3.5" /> Send Shipping Notification</>
                    )}
                  </button>
                  {invoice.shipping_notification_emailed_at && (
                    <p className="mt-1 text-[10px] text-ink-muted flex items-center gap-1">
                      <Check className="w-2.5 h-2.5 text-emerald-600 flex-shrink-0" />
                      <span className="truncate">
                        Sent {new Date(invoice.shipping_notification_emailed_at).toLocaleString()}
                        {invoice.shipping_notification_emailed_by_email && (
                          <> by <span className="text-ink">{invoice.shipping_notification_emailed_by_email}</span></>
                        )}
                      </span>
                    </p>
                  )}
                </div>
                {!trackingInput && (
                  <p className="text-[10px] text-ink-muted">
                    Add a tracking number to enable the shipping email.
                  </p>
                )}
                {custEmailError && (
                  <p className="text-[10px] text-red-600 flex items-start gap-1">
                    <AlertCircle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" /> {custEmailError}
                  </p>
                )}
              </div>
            </SideCard>
          )}

          {/* Details — the lower-priority meta (sales person, markings, dates,
              email history, notes) collapsed into one panel so it's available
              without crowding the page. Collapsed by default. */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface/60 transition-colors"
            >
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5" /> More details
              </span>
              <ChevronDown
                className={`w-4 h-4 text-ink-muted transition-transform ${showDetails ? 'rotate-180' : ''}`}
              />
            </button>
            {showDetails && (
              <div className="px-4 pb-4 space-y-4 border-t border-line/60 pt-4">
                {/* Sales people — every person credited on this invoice, each
                    on their own rate. Falls back to the single primary for
                    invoices raised before a roster existed. */}
                {salesTeam.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                      <User className="w-3 h-3" /> Sales {salesTeam.length > 1 ? 'people' : 'person'}
                    </div>
                    <div className="space-y-1.5">
                      {salesTeam.map((m, i) => (
                        <div key={m.sales_person_id || i} className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-ink">
                            {m.name}
                            {i === 0 && salesTeam.length > 1 && (
                              <span className="ml-1.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                                primary
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-purple-600 tabular-nums whitespace-nowrap">
                            ${m.amount.toFixed(2)} ({m.rate}%)
                          </span>
                        </div>
                      ))}
                    </div>
                    {salesTeam.length > 1 && (
                      <div className="mt-1.5 pt-1.5 border-t border-line/60 flex items-baseline justify-between gap-3">
                        <span className="text-xs text-ink-muted">Total commission</span>
                        <span className="text-xs font-semibold text-purple-600 tabular-nums">
                          ${salesTeam.reduce((s, m) => s + m.amount, 0).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Order markings — currency + labels */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Paid in</span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-medium text-ink">
                        <span className="font-semibold">$</span>{invoice.currency ?? 'CAD'}
                      </span>
                      {/* Admin-only: re-denominate the invoice into the other
                          currency without touching any amount (label change). */}
                      {isAdmin && (
                        <button
                          onClick={switchCurrency}
                          disabled={switchingCurrency}
                          className="inline-flex items-center gap-1 text-xs text-vital hover:text-vital/80 disabled:opacity-60"
                          title={`Switch this invoice to ${invoice.currency === 'USD' ? 'CAD' : 'USD'} — keeps the same amounts, only changes the currency label`}
                        >
                          {switchingCurrency ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ArrowLeftRight className="w-3 h-3" />
                          )}
                          Switch to {invoice.currency === 'USD' ? 'CAD' : 'USD'}
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Labels</span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        invoice.with_labels !== false
                          ? 'bg-vital/10 text-vital'
                          : 'bg-ink/5 text-ink-muted'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      {invoice.with_labels !== false ? 'With labels' : 'Without labels'}
                    </span>
                  </div>
                </div>

                {/* Dates */}
                <div className="space-y-1">
                  <div className="text-sm text-ink-muted">Issue: <span className="text-ink">{new Date(invoice.issue_date).toLocaleDateString()}</span></div>
                  {editingDueDate ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-muted">Due:</span>
                        <input
                          type="date"
                          value={dueDateDraft}
                          onChange={(e) => setDueDateDraft(e.target.value)}
                          disabled={savingDueDate}
                          className="px-2 py-1 border border-line rounded-lg text-sm text-ink focus:border-vital focus:outline-none"
                        />
                        <button
                          onClick={saveDueDate}
                          disabled={savingDueDate}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-vital text-white hover:bg-vital/90 disabled:opacity-60"
                          title="Save due date"
                        >
                          {savingDueDate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { setEditingDueDate(false); setDueDateError(null); }}
                          disabled={savingDueDate}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-line text-ink-muted hover:text-ink disabled:opacity-60"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {dueDateError && <div className="text-xs text-red-600">{dueDateError}</div>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      <span>Due: <span className={effective === 'overdue' ? 'text-red-600 font-medium' : 'text-ink'}>{new Date(invoice.due_date).toLocaleDateString()}</span></span>
                      {canEditInv && (
                        <button
                          onClick={startEditDueDate}
                          className="inline-flex items-center gap-1 text-xs text-vital hover:text-vital/80"
                          title="Edit due date"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Invoice email history */}
                <div>
                  <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Invoice email
                  </div>
                  {invoice.last_emailed_at ? (
                    <div className="text-xs text-ink-muted">
                      Sent {new Date(invoice.last_emailed_at).toLocaleString()}
                      {invoice.last_emailed_by_email && (
                        <> by <span className="text-ink">{invoice.last_emailed_by_email}</span></>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-ink-muted">Not sent yet</div>
                  )}
                </div>

                {/* Notes */}
                {invoice.notes && (
                  <div>
                    <div className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mb-1">Notes</div>
                    <p className="text-sm text-ink-muted whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mark-paid stock confirmation */}
      {showStockConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" /> Confirm payment & stock update
              </h3>
              <button onClick={() => setShowStockConfirm(false)} disabled={savingStatus} className="text-ink-muted hover:text-ink disabled:opacity-60">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-3">
              Marking <span className="font-medium text-ink">{invoice.invoice_number}</span> as
              paid will reduce inventory for the following product
              {stockLineItems.length === 1 ? '' : 's'}:
            </p>
            <ul className="mb-4 border border-line rounded-lg divide-y divide-line/60 max-h-56 overflow-y-auto">
              {stockLineItems.map((li) => (
                <li key={li.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-ink truncate">{li.description}</span>
                  <span className="text-ink-muted tabular-nums whitespace-nowrap">
                    − {lineItemVialCount(li)} vials
                    {li.price_type !== 'vial' && (
                      <span className="text-ink-muted/70"> ({li.qty} × {lineItemVialsPerBox(li)})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {statusMsg?.type === 'error' && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {statusMsg.text}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowStockConfirm(false)}
                disabled={savingStatus}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={applyStatusChange}
                disabled={savingStatus}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {savingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Mark paid & reduce stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send email modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-lg p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-ink flex items-center gap-2">
                <Send className="w-4 h-4 text-vital" /> Send invoice email
              </h3>
              <button onClick={() => setShowEmailModal(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">To</label>
                <input
                  type="email"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  Also send a copy to (BCC)
                </label>
                {bccList.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    No admin copy recipients configured.{' '}
                    <Link href="/admin/settings" className="text-vital hover:underline">
                      Add some
                    </Link>{' '}
                    or paste one below to send just for this email.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {bccList.map((b) => (
                      <li
                        key={b.email}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface border border-line rounded-lg"
                      >
                        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={b.checked}
                            onChange={() => toggleBcc(b.email)}
                            className="w-4 h-4 accent-vital"
                          />
                          <span className="text-sm text-ink truncate">{b.email}</span>
                          {b.label && (
                            <span className="text-[10px] uppercase tracking-wider text-vital bg-vital/10 px-1.5 py-0.5 rounded flex-shrink-0">
                              {b.label}
                            </span>
                          )}
                          {b.adhoc && (
                            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                              one-off
                            </span>
                          )}
                        </label>
                        {b.adhoc && (
                          <button
                            type="button"
                            onClick={() => removeAdhocBcc(b.email)}
                            className="text-ink-muted hover:text-red-500"
                            aria-label="Remove"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex gap-2 mt-2">
                  <input
                    type="email"
                    value={newBccInput}
                    onChange={(e) => setNewBccInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addAdhocBcc();
                      }
                    }}
                    placeholder="Add another email (won't be saved)"
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
                  />
                  <button
                    type="button"
                    onClick={addAdhocBcc}
                    disabled={!newBccInput.trim()}
                    className="px-3 py-1.5 bg-ink/5 hover:bg-ink/10 text-ink text-sm rounded-lg disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                {newBccError && (
                  <p className="text-xs text-red-600 mt-1">{newBccError}</p>
                )}
                <p className="text-xs text-ink-muted mt-1">
                  Configured under{' '}
                  <Link href="/admin/settings" className="text-vital hover:underline">
                    Settings → Invoice Emails
                  </Link>
                  . Adding here only affects this send.
                </p>
              </div>

              {templatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading template…
                </div>
              ) : templates ? (
                <div className="border border-line rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-surface border-b border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-muted">Subject</div>
                    <div className="text-sm font-medium text-ink mt-0.5">{templates.subject}</div>
                  </div>
                  <div className="px-3 py-3 text-sm text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {templates.body}
                  </div>
                  <div className="px-3 py-2 bg-surface border-t border-line text-xs text-ink-muted">
                    📎 {invoice.invoice_number}.pdf (attached)
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-ink-muted">
                Edit the template under{' '}
                <Link href="/admin/settings/email-templates" className="text-vital hover:underline">
                  Settings → Email templates
                </Link>.
              </p>

              {emailError && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {emailError}
                </div>
              )}
              {emailSuccess && (
                <div className="flex items-start gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> {emailSuccess}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={submitSendEmail}
                disabled={emailSending}
                className="px-4 py-2 bg-vital hover:bg-vital/90 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment modal — shared with the invoices list quick action */}
      {showPayModal && (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          amountDue={amountDue}
          customerEmail={invoice.customer_email ?? invoice.customer?.email ?? null}
          onClose={() => setShowPayModal(false)}
          onRecorded={() => {
            // Keep the dialog open on its result step; refresh the invoice so the
            // Payment History (and its email-status badge) reflects the new row.
            refresh();
          }}
        />
      )}

      {/* Reverse-payment modal — shared with the invoices list quick action */}
      {showReverseModal && (
        <ReversePaymentDialog
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          onClose={() => setShowReverseModal(false)}
          onReversed={() => {
            // Refresh so the status pill, amount due, and Payment History reflect
            // the removed payment.
            refresh();
          }}
        />
      )}

      {confirmDelete && invoice && (
        <ConfirmDeleteDialog
          title="Delete Invoice"
          message={
            <>
              <p className="mb-2">
                You are about to permanently delete invoice{' '}
                <span className="font-semibold text-ink">{invoice.invoice_number}</span>, along
                with its line items and payments.
              </p>
              <p>
                The linked order is deleted too (invoices and orders are paired).{' '}
                <span className="font-semibold text-red-500">This cannot be undone.</span>
              </p>
            </>
          }
          confirmLabel="Delete invoice"
          loading={deleting}
          error={deleteError}
          onConfirm={submitDelete}
          onClose={() => {
            if (deleting) return;
            setConfirmDelete(false);
            setDeleteError('');
          }}
        />
      )}
    </>
  );
}

// Client (end-recipient) ship-to for the Packing List flow: the invoice bills
// the customer, but the parcel goes to the customer's client. Renders the
// client's name, address and contact plus a note about who's billed.
function ClientShipTo({
  client,
  customerName,
  packingList,
}: {
  client: NonNullable<Invoice['client']>;
  customerName: string;
  /** Packing List send status (who/when/to), when it's been emailed. */
  packingList?: { at: string | null; by: string | null; to: string | null };
}) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client';
  const cityLine = [client.city, client.state, client.postal_code].filter(Boolean).join(', ');
  return (
    <div className="mb-2 rounded-lg border border-vital/30 bg-vital/5 p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-vital/15 text-vital whitespace-nowrap">
          <Users className="w-2.5 h-2.5" /> Ships to client
        </span>
      </div>
      <div className="text-sm text-ink space-y-0.5">
        <p className="font-medium">{name}</p>
        {client.address && <p>{client.address}</p>}
        {cityLine && <p>{cityLine}</p>}
        {client.country && <p>{client.country}</p>}
        {client.phone && <p className="text-ink-muted">{client.phone}</p>}
        {client.email && <p className="text-ink-muted break-all">{client.email}</p>}
      </div>
      <p className="text-[11px] text-ink-muted mt-1.5">
        Billed to {customerName} · the client receives a Packing List only (no pricing).
      </p>
      {packingList?.at && (
        <p className="text-[11px] text-emerald-700 mt-1 flex items-start gap-1">
          <Check className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
          <span>
            Packing list emailed {new Date(packingList.at).toLocaleDateString()}
            {packingList.to ? <> to <span className="break-all">{packingList.to}</span></> : ''}
            {packingList.by ? <> by <span className="text-ink">{packingList.by}</span></> : ''}
          </span>
        </p>
      )}
    </div>
  );
}

function SideCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}
