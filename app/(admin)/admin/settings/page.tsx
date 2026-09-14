'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings, Mail, Plus, Trash2, Check, X, CreditCard, Send, AlertCircle, MapPin, Users, ToggleLeft, ToggleRight, FileText, ChevronRight, Truck, Package, KeyRound, DollarSign, Loader2, Clock, UserX, RefreshCw, ExternalLink, Wallet } from 'lucide-react';
import { useUserRole } from '../layout';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { TEST_EMAIL_TYPES } from '@/lib/email-test-catalog';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import PaymentMethodsSettings from '@/components/admin/PaymentMethodsSettings';
import { DEFAULT_PAYMENT_BODY, DEFAULT_PAYMENT_SUBJECT } from '@/lib/payment-email-templates';
import type { ReceivingWallet } from '@/lib/payments/receiving-wallets';

interface ShippingOrigin {
  line_1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_alpha2?: string;
  company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
}

interface ShippingBox {
  length?: number;
  width?: number;
  height?: number;
}

interface SiteSettings {
  checkout_type: 'email' | 'crypto';
  admin_emails: string[];
  pickup_address: string;
  guest_checkout_enabled: boolean;
  invoice_cc_emails: string[];
  invoice_customer_email_subject: string;
  invoice_customer_email_body: string;
  invoice_admin_email_subject: string;
  invoice_admin_email_body: string;
  easyship_enabled: boolean;
  easyship_api_key_set: boolean;
  shipping_origin: ShippingOrigin;
  shipping_box: ShippingBox;
  shipping_item_weight_kg: number;
  shipping_flat_rate: number;
  shipping_handling_fee_type: 'flat' | 'percent';
  shipping_handling_fee_value: number;
  easyship_auto_create_shipment: boolean;
  easyship_auto_courier_preference: 'cheapest' | 'ups' | 'fedex';
  easyship_auto_buy_label: boolean;
  inactive_customer_notification_enabled: boolean;
  inactive_customer_notify_days: number[];
  etransfer_email_delay_minutes: number;
  usd_exchange_rate: number;
  fulfillment_expired_days: number;
  puramass_checkout_enabled: boolean;
  // Read-only: whether the server has PuraMass API credentials (env).
  puramass_configured: boolean;
  // Read-only: true when the config-file master switch (puramass.config.ts) has
  // disabled the hosted checkout, overriding this toggle.
  puramass_config_disabled: boolean;
  // Signed-in customer hosted checkout: the customer's own prices and currency
  // are charged, they pick a courier here, and an Easyship shipment is created
  // when the order is paid. Needs the hosted checkout itself to be on.
  puramass_customer_checkout_enabled: boolean;
  // Processing fee added on top of every courier rate at that checkout. The
  // general Easyship handling fee below is NOT applied there, so the two can
  // never stack into a charge nobody configured.
  puramass_shipping_fee_type: 'flat' | 'percent';
  puramass_shipping_fee_value: number;
  // House phone given to the courier when a customer leaves theirs blank.
  shipping_default_recipient_phone: string;
  // Invoice payment requests — the payment-request email and the methods its
  // hosted page offers (see the "Payment Emails" / "Crypto Payments" sections).
  crypto_wallets: ReceivingWallet[];
  crypto_payment_instructions: string;
  payment_email_subject: string;
  payment_email_body: string;
  payment_crypto_enabled: boolean;
  payment_card_enabled: boolean;
  // Read-only: card payments also need the PuraMass credentials + config switch.
  payment_card_available: boolean;
}

interface PuramassSyncSection {
  counts: { updated: number; skipped_already_set: number; ambiguous: number; unmatched: number };
  updated: { id: string; name: string; sku: string }[];
  ambiguous: { id: string; name: string; candidates: string[] }[];
  unmatched: { id: string; name: string }[];
}
interface PuramassSyncReport {
  source: { box: string; vial: string };
  vial_column_available: boolean;
  box: PuramassSyncSection;
  vial: PuramassSyncSection;
}

// Right-rail "on this page" navigation. Each entry's `id` must match the `id`
// on the matching section card in the JSX below — clicking scrolls to it and
// the item under the viewport is highlighted as you scroll (scroll-spy). Icons
// mirror each section header so the rail reads at a glance.
const SETTINGS_SECTIONS: { id: string; label: string; icon: typeof Settings }[] = [
  { id: 'password', label: 'Your Password', icon: KeyRound },
  { id: 'checkout-type', label: 'Checkout Type', icon: CreditCard },
  { id: 'puramass-checkout', label: 'PuraMass Checkout', icon: ExternalLink },
  { id: 'admin-emails', label: 'Admin Notifications', icon: Mail },
  { id: 'inactive-alerts', label: 'Inactive Alerts', icon: UserX },
  { id: 'invoice-emails', label: 'Invoice Emails', icon: FileText },
  { id: 'payment-emails', label: 'Payment Emails', icon: CreditCard },
  { id: 'crypto-payments', label: 'Crypto Payments', icon: Wallet },
  { id: 'invoice-export', label: 'Invoice Export', icon: Send },
  { id: 'etransfer-timing', label: 'E-Transfer Timing', icon: Clock },
  { id: 'fulfillment-queue', label: 'Fulfillment Queue', icon: Package },
  { id: 'usd-pricing', label: 'USD Pricing', icon: DollarSign },
  { id: 'pickup-address', label: 'Pickup Address', icon: MapPin },
  { id: 'guest-checkout', label: 'Guest Checkout', icon: Users },
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'auto-shipments', label: 'Automatic Shipments', icon: Package },
];

export default function SettingsPage() {
  const userRole = useUserRole();
  const toast = useToast();
  const isReadOnly = userRole === 'assistant';

  const [settings, setSettings] = useState<SiteSettings>({
    checkout_type: 'crypto',
    admin_emails: [],
    pickup_address: '',
    guest_checkout_enabled: true,
    invoice_cc_emails: [],
    invoice_customer_email_subject: '',
    invoice_customer_email_body: '',
    invoice_admin_email_subject: '',
    invoice_admin_email_body: '',
    easyship_enabled: false,
    easyship_api_key_set: false,
    shipping_origin: {},
    shipping_box: {},
    shipping_item_weight_kg: 0.05,
    shipping_flat_rate: 20,
    shipping_handling_fee_type: 'flat',
    shipping_handling_fee_value: 0,
    easyship_auto_create_shipment: false,
    easyship_auto_courier_preference: 'cheapest',
    easyship_auto_buy_label: false,
    inactive_customer_notification_enabled: false,
    inactive_customer_notify_days: [],
    etransfer_email_delay_minutes: 0,
    usd_exchange_rate: 0.73,
    fulfillment_expired_days: 3,
    puramass_checkout_enabled: false,
    puramass_configured: false,
    puramass_config_disabled: false,
    puramass_customer_checkout_enabled: false,
    puramass_shipping_fee_type: 'flat',
    puramass_shipping_fee_value: 0,
    shipping_default_recipient_phone: '',
    crypto_wallets: [],
    crypto_payment_instructions: '',
    payment_email_subject: DEFAULT_PAYMENT_SUBJECT,
    payment_email_body: DEFAULT_PAYMENT_BODY,
    payment_crypto_enabled: false,
    payment_card_enabled: true,
    payment_card_available: false,
  });
  const [pickupAddressInput, setPickupAddressInput] = useState('');
  const [newInactiveDays, setNewInactiveDays] = useState('');
  const [inactiveDaysError, setInactiveDaysError] = useState('');
  const [etransferDelayInput, setEtransferDelayInput] = useState('0');
  const [etransferDelayError, setEtransferDelayError] = useState('');
  const [expiredDaysInput, setExpiredDaysInput] = useState('3');
  const [expiredDaysError, setExpiredDaysError] = useState('');
  // CAD→USD multiplier field (text input so partial values while typing are ok).
  const [usdRateInput, setUsdRateInput] = useState('0.73');
  const [usdRateError, setUsdRateError] = useState('');
  const [fetchingUsdRate, setFetchingUsdRate] = useState(false);
  // PuraMass hosted-checkout SKU sync state.
  const [syncingPuramass, setSyncingPuramass] = useState(false);
  const [puramassReport, setPuramassReport] = useState<PuramassSyncReport | null>(null);
  // Hosted-checkout shipping fields (text inputs so a partial value while
  // typing is fine; parsed and validated on save).
  const [puramassFeeInput, setPuramassFeeInput] = useState('0');
  const [puramassFeeError, setPuramassFeeError] = useState('');
  const [housePhoneInput, setHousePhoneInput] = useState('');

  // Shipping (Easyship) form state
  const [shipForm, setShipForm] = useState({
    line_1: '',
    city: '',
    state: '',
    postal_code: '',
    country_alpha2: 'CA',
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    length: '',
    width: '',
    height: '',
    item_weight_kg: '',
    flat_rate: '',
    handling_fee_type: 'flat' as 'flat' | 'percent',
    handling_fee_value: '',
    free_shipping_threshold: '',
  });
  const [easyshipApiKeyInput, setEasyshipApiKeyInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Signed-in admin's email — used to re-verify the current password when
  // changing it below.
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);

  // Email input state
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [newInvoiceCc, setNewInvoiceCc] = useState('');
  const [invoiceCcError, setInvoiceCcError] = useState('');

  // Test-email quick buttons: per-type status + feedback.
  const [testStatus, setTestStatus] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const [testFeedback, setTestFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Which addresses receive a test send. Defaults to all configured admin
  // emails; the admin can narrow it and/or add a one-off custom recipient.
  const [testRecipients, setTestRecipients] = useState<string[]>([]);
  const [testCustomEmail, setTestCustomEmail] = useState('');

  // Which section the right-rail nav highlights (updated by scroll-spy).
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email);
    });
  }, []);

  useEffect(() => {
    // Keep the test-recipient selection in step with the configured admin
    // emails: prune any that were removed, and default to all when empty.
    setTestRecipients((prev) => {
      const kept = prev.filter((e) => settings.admin_emails.includes(e));
      return kept.length > 0 ? kept : settings.admin_emails;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.admin_emails]);

  // Scroll-spy for the right-rail nav: highlight the section currently under
  // the top of the viewport. Runs once the page has loaded (the section cards
  // only exist in the DOM after `loading` flips to false).
  useEffect(() => {
    if (loading) return;

    // A section counts as "in view" once its top passes below the header band
    // (top margin) but before it leaves the upper part of the viewport
    // (bottom margin). Among those, the first in document order wins.
    const visible: Record<string, boolean> = {};
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visible[entry.target.id] = entry.isIntersecting;
        });
        const current = SETTINGS_SECTIONS.find((s) => visible[s.id]);
        if (current) setActiveSection(current.id);
      },
      { rootMargin: '-96px 0px -66% 0px', threshold: 0 },
    );

    SETTINGS_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  // Smooth-scroll a section into view when its rail item is clicked. The
  // sections carry `scroll-mt-*` so they land just below the top edge.
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveSection(id); // instant feedback; the observer keeps it in sync after
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setPickupAddressInput(data.pickup_address || '');
        setEtransferDelayInput(
          String(data.etransfer_email_delay_minutes ?? 0),
        );
        setUsdRateInput(String(data.usd_exchange_rate ?? 0.73));
        setExpiredDaysInput(String(data.fulfillment_expired_days ?? 3));
        setPuramassFeeInput(String(data.puramass_shipping_fee_value ?? 0));
        setHousePhoneInput(data.shipping_default_recipient_phone || '');
        const origin = data.shipping_origin || {};
        const box = data.shipping_box || {};
        setShipForm({
          line_1: origin.line_1 || '',
          city: origin.city || '',
          state: origin.state || '',
          postal_code: origin.postal_code || '',
          country_alpha2: origin.country_alpha2 || 'CA',
          company_name: origin.company_name || '',
          contact_name: origin.contact_name || '',
          contact_email: origin.contact_email || '',
          contact_phone: origin.contact_phone || '',
          length: box.length != null ? String(box.length) : '',
          width: box.width != null ? String(box.width) : '',
          height: box.height != null ? String(box.height) : '',
          item_weight_kg:
            data.shipping_item_weight_kg != null
              ? String(data.shipping_item_weight_kg)
              : '',
          flat_rate:
            data.shipping_flat_rate != null
              ? String(data.shipping_flat_rate)
              : '',
          handling_fee_type:
            data.shipping_handling_fee_type === 'percent' ? 'percent' : 'flat',
          handling_fee_value:
            data.shipping_handling_fee_value != null
              ? String(data.shipping_handling_fee_value)
              : '',
          free_shipping_threshold:
            data.free_shipping_threshold != null && Number(data.free_shipping_threshold) > 0
              ? String(data.free_shipping_threshold)
              : '',
        });
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (updates: Partial<SiteSettings>) => {
    if (isReadOnly) {
      toast.error('You have read-only access');
      return;
    }

    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Not authenticated');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      const data = await res.json();
      setSettings(data.settings);
      toast.success('Settings saved successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckoutTypeChange = (type: 'email' | 'crypto') => {
    setSettings((s) => ({ ...s, checkout_type: type }));
    saveSettings({ checkout_type: type });
  };

  const handlePuramassToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, puramass_checkout_enabled: enabled }));
    saveSettings({ puramass_checkout_enabled: enabled } as Partial<SiteSettings>);
  };

  /** Master toggle for customer pricing + courier choice on the hosted checkout. */
  const handlePuramassCustomerToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, puramass_customer_checkout_enabled: enabled }));
    saveSettings({
      puramass_customer_checkout_enabled: enabled,
    } as Partial<SiteSettings>);
  };

  /**
   * Save the hosted-checkout shipping options: the processing fee added to
   * every courier rate, and the house phone the courier is given when the
   * customer leaves theirs blank.
   */
  const handleSavePuramassShipping = () => {
    const raw = puramassFeeInput.trim();
    const value = raw === '' ? 0 : Number(raw);
    const max = settings.puramass_shipping_fee_type === 'percent' ? 100 : 10000;
    if (!Number.isFinite(value) || value < 0 || value > max) {
      setPuramassFeeError(
        settings.puramass_shipping_fee_type === 'percent'
          ? 'Enter a percentage between 0 and 100'
          : 'Enter an amount between 0 and 10,000',
      );
      return;
    }
    setPuramassFeeError('');
    saveSettings({
      puramass_shipping_fee_type: settings.puramass_shipping_fee_type,
      puramass_shipping_fee_value: value,
      shipping_default_recipient_phone: housePhoneInput.trim(),
    } as Partial<SiteSettings>);
  };

  // Auto-fill each product's PuraMass SKU by matching against the PuraMass
  // catalog (live when configured, bundled snapshot otherwise). Confident
  // matches are written; ambiguous/unmatched are surfaced for manual fixing.
  const handleSyncPuramassSkus = async () => {
    if (isReadOnly) {
      toast.error('You have read-only access');
      return;
    }
    setSyncingPuramass(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Not authenticated');
        return;
      }
      const res = await fetch('/api/admin/puramass/sync-skus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setPuramassReport(data);
      const b = data.box.counts;
      const v = data.vial.counts;
      toast.success(
        `SKU sync — case: ${b.updated} mapped, ${b.unmatched} unmatched · vial: ${v.updated} mapped, ${v.unmatched} unmatched.`,
      );
    } catch (err: any) {
      toast.error(err.message || 'SKU sync failed');
    } finally {
      setSyncingPuramass(false);
    }
  };

  const handleSavePickupAddress = () => {
    setSettings((s) => ({ ...s, pickup_address: pickupAddressInput }));
    saveSettings({ pickup_address: pickupAddressInput });
  };

  const handleSaveEtransferDelay = () => {
    setEtransferDelayError('');
    const n = Number(etransferDelayInput.trim());
    if (!Number.isInteger(n) || n < 0 || n > 10080) {
      setEtransferDelayError('Enter a whole number of minutes (0–10080). 0 = instant.');
      return;
    }
    setSettings((s) => ({ ...s, etransfer_email_delay_minutes: n }));
    saveSettings({ etransfer_email_delay_minutes: n } as Partial<SiteSettings>);
  };

  const handleSaveUsdRate = () => {
    setUsdRateError('');
    const n = Number(usdRateInput.trim());
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      setUsdRateError('Enter a positive multiplier (e.g. 0.73).');
      return;
    }
    setSettings((s) => ({ ...s, usd_exchange_rate: n }));
    saveSettings({ usd_exchange_rate: n } as Partial<SiteSettings>);
  };

  // Pull a fresh CAD→USD rate from a live FX source and drop it into the input
  // (the admin still reviews it and clicks Save). Best-effort — a network/API
  // hiccup just surfaces a toast and leaves the manual value untouched.
  const handleFetchUsdRate = async () => {
    setUsdRateError('');
    setFetchingUsdRate(true);
    try {
      const res = await fetch('/api/admin/settings/usd-rate');
      const data = await res.json();
      if (!res.ok || typeof data.rate !== 'number') {
        throw new Error(data.error || 'Could not fetch live rate');
      }
      setUsdRateInput(String(data.rate));
      toast.success(`Live rate: 1 CAD ≈ ${data.rate} USD. Review and Save to apply.`);
    } catch (err: any) {
      toast.error(err.message || 'Could not fetch live rate');
    } finally {
      setFetchingUsdRate(false);
    }
  };

  const handleSaveExpiredDays = () => {
    setExpiredDaysError('');
    const n = Number(expiredDaysInput.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setExpiredDaysError('Enter a whole number of days (1–365).');
      return;
    }
    setSettings((s) => ({ ...s, fulfillment_expired_days: n }));
    saveSettings({ fulfillment_expired_days: n } as Partial<SiteSettings>);
  };

  const handleGuestCheckoutToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, guest_checkout_enabled: enabled }));
    saveSettings({ guest_checkout_enabled: enabled });
  };

  const handleEasyshipToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, easyship_enabled: enabled }));
    saveSettings({ easyship_enabled: enabled } as Partial<SiteSettings>);
  };

  const handleAutoCreateShipmentToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, easyship_auto_create_shipment: enabled }));
    saveSettings({ easyship_auto_create_shipment: enabled } as Partial<SiteSettings>);
  };

  const handleAutoBuyLabelToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, easyship_auto_buy_label: enabled }));
    saveSettings({ easyship_auto_buy_label: enabled } as Partial<SiteSettings>);
  };

  const handleCourierPreferenceChange = (
    pref: 'cheapest' | 'ups' | 'fedex',
  ) => {
    setSettings((s) => ({ ...s, easyship_auto_courier_preference: pref }));
    saveSettings({ easyship_auto_courier_preference: pref } as Partial<SiteSettings>);
  };

  const handleSaveShipping = () => {
    const updates: Record<string, unknown> = {
      shipping_origin: {
        line_1: shipForm.line_1,
        city: shipForm.city,
        state: shipForm.state,
        postal_code: shipForm.postal_code,
        country_alpha2: shipForm.country_alpha2 || 'CA',
        company_name: shipForm.company_name,
        contact_name: shipForm.contact_name,
        contact_email: shipForm.contact_email,
        contact_phone: shipForm.contact_phone,
      },
      shipping_box: {
        length: Number(shipForm.length) || 0,
        width: Number(shipForm.width) || 0,
        height: Number(shipForm.height) || 0,
      },
      shipping_item_weight_kg: Number(shipForm.item_weight_kg) || 0,
      shipping_flat_rate: Number(shipForm.flat_rate) || 0,
      shipping_handling_fee_type: shipForm.handling_fee_type,
      shipping_handling_fee_value: Number(shipForm.handling_fee_value) || 0,
      free_shipping_threshold: Number(shipForm.free_shipping_threshold) || 0,
    };
    if (easyshipApiKeyInput.trim()) {
      updates.easyship_api_key = easyshipApiKeyInput.trim();
    }
    saveSettings(updates as Partial<SiteSettings>);
    setEasyshipApiKeyInput('');
  };

  const addEmail = () => {
    setEmailError('');

    if (!newEmail.trim()) {
      setEmailError('Email cannot be empty');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setEmailError('Invalid email format');
      return;
    }

    // Check for duplicates
    if (settings.admin_emails.includes(newEmail)) {
      setEmailError('Email already added');
      return;
    }

    const next = [...settings.admin_emails, newEmail];
    setSettings((s) => ({ ...s, admin_emails: next }));
    saveSettings({ admin_emails: next });
    setNewEmail('');
  };

  const removeEmail = (email: string) => {
    const next = settings.admin_emails.filter((e) => e !== email);
    setSettings((s) => ({ ...s, admin_emails: next }));
    saveSettings({ admin_emails: next });
  };

  const addInvoiceCc = () => {
    setInvoiceCcError('');
    const value = newInvoiceCc.trim();
    if (!value) {
      setInvoiceCcError('Email cannot be empty');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      setInvoiceCcError('Invalid email format');
      return;
    }
    if (settings.invoice_cc_emails.includes(value)) {
      setInvoiceCcError('Email already added');
      return;
    }
    const next = [...settings.invoice_cc_emails, value];
    setSettings((s) => ({ ...s, invoice_cc_emails: next }));
    saveSettings({ invoice_cc_emails: next });
    setNewInvoiceCc('');
  };

  const removeInvoiceCc = (email: string) => {
    const next = settings.invoice_cc_emails.filter((e) => e !== email);
    setSettings((s) => ({ ...s, invoice_cc_emails: next }));
    saveSettings({ invoice_cc_emails: next });
  };

  const handleInactiveNotificationToggle = (enabled: boolean) => {
    setSettings((s) => ({ ...s, inactive_customer_notification_enabled: enabled }));
    saveSettings({ inactive_customer_notification_enabled: enabled });
  };

  const addInactiveDays = () => {
    setInactiveDaysError('');
    const n = Number(newInactiveDays.trim());
    if (!newInactiveDays.trim() || !Number.isInteger(n) || n < 1 || n > 3650) {
      setInactiveDaysError('Enter a whole number of days (1–3650)');
      return;
    }
    if (settings.inactive_customer_notify_days.includes(n)) {
      setInactiveDaysError('That threshold is already added');
      return;
    }
    const next = Array.from(
      new Set([...settings.inactive_customer_notify_days, n]),
    ).sort((a, b) => a - b);
    setSettings((s) => ({ ...s, inactive_customer_notify_days: next }));
    saveSettings({ inactive_customer_notify_days: next });
    setNewInactiveDays('');
  };

  const removeInactiveDays = (days: number) => {
    const next = settings.inactive_customer_notify_days.filter((d) => d !== days);
    setSettings((s) => ({ ...s, inactive_customer_notify_days: next }));
    saveSettings({ inactive_customer_notify_days: next });
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Resolve who a test send should go to: the ticked admin emails plus an
  // optional one-off custom address.
  const resolveTestRecipients = (): string[] | { error: string } => {
    const custom = testCustomEmail.trim();
    if (custom && !emailRegex.test(custom)) {
      return { error: `Invalid custom email: ${custom}` };
    }
    const recipients = Array.from(new Set([...testRecipients, ...(custom ? [custom] : [])]));
    if (recipients.length === 0) {
      return { error: 'Select at least one recipient before sending a test.' };
    }
    return recipients;
  };

  const sendTestEmail = async (type: string, label: string) => {
    if (isReadOnly) return;
    const resolved = resolveTestRecipients();
    if (!Array.isArray(resolved)) {
      setTestFeedback({ type: 'error', text: resolved.error });
      return;
    }
    setTestFeedback(null);
    setTestStatus((s) => ({ ...s, [type]: 'sending' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTestStatus((s) => ({ ...s, [type]: 'error' }));
        setTestFeedback({ type: 'error', text: 'Not authenticated' });
        return;
      }
      const res = await fetch('/api/admin/settings/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ type, to: resolved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send test email');
      setTestStatus((s) => ({ ...s, [type]: 'sent' }));
      const recipients: string[] = data.sentTo || resolved;
      setTestFeedback({
        type: 'success',
        text: `“${label}” test email sent to ${recipients.join(', ')}.`,
      });
      // Reset the button back to idle after a moment.
      setTimeout(() => {
        setTestStatus((s) => {
          const next = { ...s };
          delete next[type];
          return next;
        });
      }, 3000);
    } catch (err: any) {
      setTestStatus((s) => ({ ...s, [type]: 'error' }));
      setTestFeedback({ type: 'error', text: err.message || 'Failed to send test email' });
    }
  };

  const toggleTestRecipient = (email: string) => {
    setTestRecipients((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  };

  // At least one selected admin email or a valid custom address is required.
  const hasTestRecipient =
    testRecipients.length > 0 || emailRegex.test(testCustomEmail.trim());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-ink-muted text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-6 h-6 text-ink" />
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">Site Settings</h1>
        </div>
        <p className="text-ink-muted text-sm">
          Configure checkout type and admin notification emails
        </p>
      </div>

      {/* Two-column on desktop: the settings cards fill the main column and a
          sticky section rail sits to the right. `items-start` lets the rail
          stay sticky instead of stretching to the column's full height. */}
      <div className="lg:flex lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1 space-y-6">
        {/* Your Password — a personal account action, so it stays available
            even for read-only (assistant) roles. */}
        <div id="password" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Your Password</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Change the password for your admin sign-in
            {userEmail ? <> (<span className="font-medium text-ink">{userEmail}</span>)</> : ''}.
          </p>
          <div className="max-w-sm">
            <ChangePasswordForm email={userEmail} variant="admin" />
          </div>
        </div>

        {/* Checkout Type */}
        <div id="checkout-type" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Checkout Type</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Select which checkout system to use for customer orders
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <button
              onClick={() => handleCheckoutTypeChange('email')}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                settings.checkout_type === 'email'
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Send className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Email Invoice</span>
                </div>
                {settings.checkout_type === 'email' && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                Send invoices via email and process payments manually
              </p>
            </button>

            <div
              aria-disabled
              title="Cryptocurrency checkout is disabled"
              className="p-4 rounded-xl border-2 border-line bg-surface/50 text-left opacity-60 cursor-not-allowed"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-ink-muted" />
                  <span className="font-semibold text-ink-muted">Cryptocurrency</span>
                </div>
                <span className="text-[10px] uppercase tracking-wider font-medium text-ink-muted bg-line/40 px-2 py-0.5 rounded-full">
                  Disabled
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Crypto payments are disabled site-wide. All orders use the email/invoice flow.
              </p>
            </div>
          </div>
        </div>

        {/* Admin Email Addresses */}
        <div id="admin-emails" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Admin Email Notifications</h2>
          </div>
          <p className="text-sm text-ink-muted mb-3">
            Add email addresses below. Every address you add here will receive admin notification emails.
          </p>
          <div className="mb-5 p-3 bg-surface rounded-lg border border-line">
            <p className="text-xs font-medium text-ink mb-1.5">These emails receive a notification for:</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-ink-muted">
              <li><span className="font-medium text-ink">New customer registrations</span> — sent whenever a customer signs up</li>
              <li><span className="font-medium text-ink">Inactive customers</span> — a customer registered but hasn&apos;t ordered (configured below)</li>
              <li>New orders</li>
              <li>Low-stock &amp; out-of-stock alerts</li>
            </ul>
          </div>

          {/* Add Email Input */}
          <div className="mb-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addEmail()}
                  placeholder="admin@example.com"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {emailError && (
                  <p className="text-red-500 text-xs mt-1">{emailError}</p>
                )}
              </div>
              <button
                onClick={addEmail}
                disabled={saving || isReadOnly || !newEmail.trim()}
                className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>

          {/* Email List */}
          {settings.admin_emails.length === 0 ? (
            <div className="text-center py-8 text-ink-muted text-sm">
              No admin emails configured. Add at least one email address.
            </div>
          ) : (
            <div className="space-y-2">
              {settings.admin_emails.map((email, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 p-3 bg-surface rounded-lg border border-line"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-bronze/10 rounded-lg flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-bronze" />
                    </div>
                    <span className="text-sm text-ink font-medium break-all">{email}</span>
                  </div>
                  <button
                    onClick={() => removeEmail(email)}
                    disabled={saving || isReadOnly}
                    className="p-2 text-ink-muted hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Send a test email */}
          <div className="mt-6 pt-5 border-t border-line">
            <div className="flex items-center gap-2 mb-1">
              <Send className="w-4 h-4 text-ink" />
              <h3 className="text-sm font-semibold text-ink">Send a test email</h3>
            </div>
            <p className="text-xs text-ink-muted mb-4">
              Send a sample of any email the store sends, using obviously-fake sample data. Choose which recipients receive it below.
            </p>

            {/* Recipient selector */}
            <div className="mb-4 p-3 bg-surface rounded-lg border border-line">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                Send test to
              </p>
              {settings.admin_emails.length === 0 ? (
                <p className="text-xs text-ink-muted mb-2">
                  No admin emails configured. Add one above, or enter a custom address below.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-2">
                  {settings.admin_emails.map((email) => {
                    const selected = testRecipients.includes(email);
                    return (
                      <button
                        key={email}
                        type="button"
                        onClick={() => toggleTestRecipient(email)}
                        disabled={isReadOnly}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          selected
                            ? 'border-bronze bg-bronze/10 text-ink'
                            : 'border-line bg-white text-ink-muted hover:border-ink/20'
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                            selected ? 'bg-bronze' : 'border border-line'
                          }`}
                        >
                          {selected && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                        <span className="break-all">{email}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-ink-muted shrink-0">Or a custom address:</span>
                <input
                  type="email"
                  value={testCustomEmail}
                  onChange={(e) => setTestCustomEmail(e.target.value)}
                  placeholder="someone@example.com"
                  disabled={isReadOnly}
                  className="flex-1 min-w-0 px-3 py-1.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-xs text-ink disabled:opacity-50"
                />
              </div>
            </div>

            {!hasTestRecipient && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-amber-700 text-xs">Select a recipient or enter a custom address to enable test sends.</span>
              </div>
            )}

            {testFeedback && (
              <div
                className={`mb-4 p-3 rounded-lg flex items-center gap-2 border ${
                  testFeedback.type === 'success'
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                {testFeedback.type === 'success' ? (
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                )}
                <span className={`text-xs ${testFeedback.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                  {testFeedback.text}
                </span>
              </div>
            )}

            {(['customer', 'admin'] as const).map((audience) => (
              <div key={audience} className="mb-4 last:mb-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  {audience === 'customer' ? 'Customer emails' : 'Admin emails'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEST_EMAIL_TYPES.filter((t) => t.audience === audience).map((t) => {
                    const status = testStatus[t.id];
                    const disabled =
                      isReadOnly || status === 'sending' || !hasTestRecipient;
                    return (
                      <button
                        key={t.id}
                        onClick={() => sendTestEmail(t.id, t.label)}
                        disabled={disabled}
                        title={t.description}
                        className={`group flex items-center justify-between gap-2 p-3 rounded-lg border text-left transition-all disabled:cursor-not-allowed ${
                          status === 'sent'
                            ? 'border-green-300 bg-green-50'
                            : status === 'error'
                            ? 'border-red-300 bg-red-50'
                            : 'border-line bg-surface hover:border-bronze/50 hover:bg-bronze/5 disabled:opacity-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{t.label}</p>
                          <p className="text-[11px] text-ink-muted truncate">{t.description}</p>
                        </div>
                        <span className="shrink-0 text-ink-muted group-hover:text-bronze">
                          {status === 'sending' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : status === 'sent' ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : status === 'error' ? (
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Inactive Customer Alerts — nudge admins when a signup never orders */}
        <div id="inactive-alerts" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserX className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Inactive Customer Alerts</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Email all admin addresses above when a customer registers but still
            hasn&apos;t placed an order after a set amount of time. Add one or more
            thresholds — each one sends a separate reminder, once per customer.
          </p>

          {/* On / Off toggle */}
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <button
              onClick={() => handleInactiveNotificationToggle(true)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                settings.inactive_customer_notification_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleRight className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">On</span>
                </div>
                {settings.inactive_customer_notification_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Send no-order reminders to admins</p>
            </button>
            <button
              onClick={() => handleInactiveNotificationToggle(false)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                !settings.inactive_customer_notification_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleLeft className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Off</span>
                </div>
                {!settings.inactive_customer_notification_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Don&apos;t send these reminders</p>
            </button>
          </div>

          {/* Day thresholds */}
          <div
            className={
              settings.inactive_customer_notification_enabled
                ? ''
                : 'opacity-50 pointer-events-none'
            }
          >
            <p className="text-xs font-medium text-ink mb-1.5">Reminder thresholds (days after registration)</p>
            <div className="flex gap-2 mb-3">
              <div className="flex-1 max-w-[180px]">
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={newInactiveDays}
                    onChange={(e) => setNewInactiveDays(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addInactiveDays()}
                    placeholder="e.g. 7"
                    disabled={isReadOnly}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
              <button
                onClick={addInactiveDays}
                disabled={saving || isReadOnly || !newInactiveDays.trim()}
                className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            {inactiveDaysError && (
              <p className="text-red-500 text-xs mb-3">{inactiveDaysError}</p>
            )}

            {settings.inactive_customer_notify_days.length === 0 ? (
              <div className="text-center py-6 text-ink-muted text-sm bg-surface rounded-lg border border-dashed border-line">
                No thresholds yet. Add one (e.g. 3, 7, 14) to start sending reminders.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {settings.inactive_customer_notify_days.map((days) => (
                  <span
                    key={days}
                    className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 bg-bronze/10 text-ink rounded-full text-sm font-medium border border-bronze/20"
                  >
                    <Clock className="w-3.5 h-3.5 text-bronze" />
                    {days} {days === 1 ? 'day' : 'days'}
                    <button
                      onClick={() => removeInactiveDays(days)}
                      disabled={saving || isReadOnly}
                      className="p-0.5 text-ink-muted hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Remove ${days} day threshold`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink-muted mt-3">
              Checked once daily by a scheduled job. The alert email includes a link to
              take over the customer for contacting.
            </p>
          </div>
        </div>

        {/* Invoice Email — BCC list + template editor link */}
        <div id="invoice-emails" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Invoice Emails</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            When an admin sends an invoice from the invoice page, a copy (BCC, hidden from the customer) goes to every address below.
          </p>

          <div className="mb-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="email"
                  value={newInvoiceCc}
                  onChange={(e) => setNewInvoiceCc(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addInvoiceCc()}
                  placeholder="finance@example.com"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {invoiceCcError && (
                  <p className="text-red-500 text-xs mt-1">{invoiceCcError}</p>
                )}
              </div>
              <button
                onClick={addInvoiceCc}
                disabled={saving || isReadOnly || !newInvoiceCc.trim()}
                className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>

          {settings.invoice_cc_emails.length === 0 ? (
            <div className="text-center py-6 text-ink-muted text-sm">
              No copy recipients. Invoice copies won&apos;t be sent.
            </div>
          ) : (
            <div className="space-y-2 mb-5">
              {settings.invoice_cc_emails.map((email, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 p-3 bg-surface rounded-lg border border-line"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-bronze/10 rounded-lg flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-bronze" />
                    </div>
                    <span className="text-sm text-ink font-medium break-all">{email}</span>
                  </div>
                  <button
                    onClick={() => removeInvoiceCc(email)}
                    disabled={saving || isReadOnly}
                    className="p-2 text-ink-muted hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Link
            href="/admin/settings/email-templates"
            className="inline-flex items-center justify-between gap-2 w-full px-4 py-3 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Edit invoice email templates
            </span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Payment Emails + Crypto Payments — the invoice payment request and
            the two ways its hosted page lets a customer pay. */}
        <PaymentMethodsSettings
          settings={settings}
          saving={saving}
          isReadOnly={isReadOnly}
          onSave={(updates) => {
            setSettings((s) => ({ ...s, ...updates }));
            saveSettings(updates as Partial<SiteSettings>);
          }}
        />

        {/* Invoice Export */}
        <div id="invoice-export" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Invoice Export</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Push invoices to other websites. Configure the destination sites and
            their shared secrets here; the actual send happens from an invoice or
            in bulk on the Invoices page.
          </p>
          <Link
            href="/admin/settings/invoice-export"
            className="inline-flex items-center justify-between gap-2 w-full px-4 py-3 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Manage export destinations
            </span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* E-Transfer Email Timing */}
        <div id="etransfer-timing" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">E-Transfer Email Timing</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            How long to wait after an order is placed before the customer&apos;s
            Interac e-Transfer invoice email is sent. Set <span className="font-medium text-ink">0</span> to
            send instantly (the default). This is the store-wide default applied to every new order.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 max-w-[220px]">
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="number"
                  min={0}
                  max={10080}
                  value={etransferDelayInput}
                  onChange={(e) => setEtransferDelayInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEtransferDelay()}
                  placeholder="0"
                  disabled={isReadOnly}
                  className="w-full pl-10 pr-16 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">min</span>
              </div>
            </div>
            <button
              onClick={handleSaveEtransferDelay}
              disabled={saving || isReadOnly}
              className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
          {etransferDelayError && (
            <p className="text-red-500 text-xs mt-2">{etransferDelayError}</p>
          )}
          <p className="text-[11px] text-ink-muted mt-3">
            {settings.etransfer_email_delay_minutes > 0
              ? `Currently: sent ${settings.etransfer_email_delay_minutes} minute${settings.etransfer_email_delay_minutes === 1 ? '' : 's'} after checkout (flushed by a scheduled job).`
              : 'Currently: sent instantly at checkout.'}
          </p>
        </div>

        {/* Fulfillment Queue — "expired" (aged) card threshold */}
        <div id="fulfillment-queue" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Fulfillment Queue</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            A queue card is treated as <span className="font-medium text-ink">expired</span> (aged)
            once it is at least this many days old. Expired cards are hidden by
            default in the warehouse fulfillment queue and revealed with the
            {' '}<span className="font-medium text-ink">Show expired</span> toggle — a way to
            keep old stragglers out of the way without losing them.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 max-w-[220px]">
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={expiredDaysInput}
                  onChange={(e) => setExpiredDaysInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveExpiredDays()}
                  placeholder="3"
                  disabled={isReadOnly}
                  className="w-full pl-10 pr-16 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">days</span>
              </div>
            </div>
            <button
              onClick={handleSaveExpiredDays}
              disabled={saving || isReadOnly}
              className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
          {expiredDaysError && (
            <p className="text-red-500 text-xs mt-2">{expiredDaysError}</p>
          )}
          <p className="text-[11px] text-ink-muted mt-3">
            Currently: cards {settings.fulfillment_expired_days}
            {settings.fulfillment_expired_days === 1 ? ' day' : ' days'} old or
            older are treated as expired.
          </p>
        </div>

        {/* USD Pricing (CAD→USD multiplier) */}
        <div id="usd-pricing" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">USD Pricing</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            CAD→USD multiplier used to show USD prices across the admin (Products
            table and invoices). A product&apos;s USD price is
            {' '}<span className="font-medium text-ink">CAD&nbsp;price&nbsp;×&nbsp;rate</span>{' '}
            unless a specific USD price is set on the product. Keep this up to date
            so USD prices stay accurate.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 max-w-[220px]">
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={usdRateInput}
                  onChange={(e) => setUsdRateInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveUsdRate()}
                  placeholder="0.73"
                  disabled={isReadOnly}
                  className="w-full pl-10 pr-16 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">×CAD</span>
              </div>
            </div>
            <button
              onClick={handleFetchUsdRate}
              disabled={fetchingUsdRate || isReadOnly}
              title="Fetch the current live CAD→USD rate"
              className="px-4 py-2.5 bg-surface border border-line hover:bg-surface/70 text-ink rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {fetchingUsdRate ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Live rate
            </button>
            <button
              onClick={handleSaveUsdRate}
              disabled={saving || isReadOnly}
              className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
          {usdRateError && (
            <p className="text-red-500 text-xs mt-2">{usdRateError}</p>
          )}
          <p className="text-[11px] text-ink-muted mt-3">
            Currently: 1 CAD ≈ {settings.usd_exchange_rate} USD (e.g. a $100.00 CAD
            product ≈ ${(100 * settings.usd_exchange_rate).toFixed(2)} USD).
          </p>
        </div>

        {/* Pickup Address */}
        <div id="pickup-address" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Pickup Address</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            The address shown to customers who select local pickup at checkout
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={pickupAddressInput}
              onChange={(e) => setPickupAddressInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePickupAddress()}
              placeholder="e.g. 123 Main St, Toronto, ON M5V 1A1"
              disabled={isReadOnly}
              className="flex-1 px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSavePickupAddress}
              disabled={saving || isReadOnly}
              className="px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
          </div>
          {settings.pickup_address && (
            <p className="text-xs text-ink-muted mt-2">
              Current: <span className="font-medium text-ink">{settings.pickup_address}</span>
            </p>
          )}
        </div>

        {/* Guest Checkout */}
        <div id="guest-checkout" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Guest Checkout</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Allow customers to checkout without creating an account
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              onClick={() => handleGuestCheckoutToggle(true)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                settings.guest_checkout_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleRight className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Enabled</span>
                </div>
                {settings.guest_checkout_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Anyone can checkout without an account</p>
            </button>
            <button
              onClick={() => handleGuestCheckoutToggle(false)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                !settings.guest_checkout_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleLeft className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Disabled</span>
                </div>
                {!settings.guest_checkout_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Customers must sign in to place an order</p>
            </button>
          </div>
        </div>

        {/* PuraMass Hosted Checkout */}
        <div id="puramass-checkout" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <ExternalLink className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">PuraMass Hosted Checkout</h2>
          </div>
          <p className="text-sm text-ink-muted mb-4">
            Hand the cart off to the PuraMass hosted checkout instead of the
            in-house email/invoice flow. When enabled, customers are redirected to
            PuraMass to pay; PuraMass re-reads its own prices and owns payment,
            fulfilment, and order emails. Your in-house pricing, shipping, and
            warehouse steps are bypassed for these orders.
          </p>

          {/* Server credential status (read-only, from env) */}
          <div
            className={`flex items-start gap-2 rounded-xl border p-3 mb-5 text-sm ${
              settings.puramass_configured
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {settings.puramass_configured ? (
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            )}
            <span>
              {settings.puramass_configured
                ? 'Server API credentials detected. Hosted checkout is ready to use when enabled.'
                : 'No server API credentials detected (PURAMASS_API_KEY). Set them in the server environment — the hosted checkout will not run until they are, even if enabled below.'}
            </span>
          </div>

          {/* Config-file master switch (puramass.config.ts) overrides the toggle. */}
          {settings.puramass_config_disabled && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 mb-5 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Disabled in the config file (<code>puramass.config.ts</code>). The
                storefront uses the in-house checkout and this toggle has no effect
                until the config switch is turned back on.
              </span>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <button
              onClick={() => handlePuramassToggle(true)}
              disabled={saving || isReadOnly || settings.puramass_config_disabled}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                settings.puramass_checkout_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly || settings.puramass_config_disabled) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleRight className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Enabled</span>
                </div>
                {settings.puramass_checkout_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Checkout redirects to PuraMass</p>
            </button>
            <button
              onClick={() => handlePuramassToggle(false)}
              disabled={saving || isReadOnly || settings.puramass_config_disabled}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                !settings.puramass_checkout_enabled
                  ? 'border-bronze bg-bronze/5'
                  : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleLeft className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Disabled</span>
                </div>
                {!settings.puramass_checkout_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Use the in-house invoice flow</p>
            </button>
          </div>

          {/* Signed-in customer checkout: their prices, their courier, their
              shipment. Sits on top of the hosted checkout above. */}
          <div className="border-t border-line pt-5 mb-6">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">
                  Customer pricing &amp; courier choice
                </h3>
                <p className="text-xs text-ink-muted">
                  Charge each customer the prices they see on the storefront —
                  their price list, in their own currency — instead of
                  PuraMass&apos;s catalog prices. They also enter their shipping
                  address and pick a courier (UPS, FedEx or Canada Post) here
                  before paying, and an Easyship shipment is created and attached
                  to the invoice once the order is paid.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.puramass_customer_checkout_enabled}
                onClick={() =>
                  handlePuramassCustomerToggle(
                    !settings.puramass_customer_checkout_enabled,
                  )
                }
                disabled={saving || isReadOnly || settings.puramass_config_disabled}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                  settings.puramass_customer_checkout_enabled ? 'bg-bronze' : 'bg-line'
                } ${
                  saving || isReadOnly || settings.puramass_config_disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform mt-0.5 ${
                    settings.puramass_customer_checkout_enabled
                      ? 'translate-x-[22px]'
                      : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {settings.puramass_customer_checkout_enabled &&
              !settings.puramass_checkout_enabled && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 mt-3 text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    The hosted checkout itself is off above, so this has no effect
                    yet — the storefront is still using the in-house invoice flow.
                  </span>
                </div>
              )}

            {settings.puramass_customer_checkout_enabled && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1.5">
                    Shipping processing fee
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={settings.puramass_shipping_fee_type}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          puramass_shipping_fee_type: e.target.value as
                            | 'flat'
                            | 'percent',
                        }))
                      }
                      disabled={isReadOnly}
                      className="px-3 py-2.5 rounded-xl border border-line focus:border-bronze focus:outline-none text-sm bg-white"
                    >
                      <option value="flat">Flat (CAD)</option>
                      <option value="percent">Percent of rate</option>
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={puramassFeeInput}
                      onChange={(e) => {
                        setPuramassFeeInput(e.target.value);
                        setPuramassFeeError('');
                      }}
                      disabled={isReadOnly}
                      placeholder={
                        settings.puramass_shipping_fee_type === 'percent' ? '10' : '5.00'
                      }
                      className="flex-1 px-4 py-2.5 rounded-xl border border-line focus:border-bronze focus:outline-none text-sm"
                    />
                  </div>
                  {puramassFeeError ? (
                    <p className="text-xs text-red-600 mt-1">{puramassFeeError}</p>
                  ) : (
                    <p className="text-xs text-ink-muted mt-1">
                      Added on top of every courier rate the customer sees, so
                      they read one shipping figure rather than an itemised fee.
                      0 = no fee. The general Easyship handling fee below is{' '}
                      <strong>not</strong> applied at this checkout, so the two
                      never stack.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1.5">
                    House phone for shipments
                  </label>
                  <input
                    type="tel"
                    value={housePhoneInput}
                    onChange={(e) => setHousePhoneInput(e.target.value)}
                    disabled={isReadOnly}
                    placeholder="16473029495"
                    className="w-full px-4 py-2.5 rounded-xl border border-line focus:border-bronze focus:outline-none text-sm"
                  />
                  <p className="text-xs text-ink-muted mt-1">
                    Couriers require a recipient phone number, but customers
                    aren&apos;t asked for one — this number is used when they
                    leave it blank. Their <strong>email</strong> is always
                    required. Leave blank to use the built-in default.
                  </p>
                </div>

                <p className="text-xs text-ink-muted">
                  The <strong>sender</strong> address and contact (company, name,
                  email, phone) used on every shipment are configured under{' '}
                  <button
                    type="button"
                    onClick={() => scrollToSection('shipping')}
                    className="text-bronze hover:underline font-medium"
                  >
                    Shipping (Easyship)
                  </button>
                  .
                </p>

                <button
                  onClick={handleSavePuramassShipping}
                  disabled={saving || isReadOnly}
                  className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-medium transition-all text-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save shipping options'
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Product SKU mapping */}
          <div className="border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-ink mb-1">Product SKU mapping</h3>
            <p className="text-xs text-ink-muted mb-3">
              Your product SKUs differ from PuraMass SKUs. Run a sync to auto-fill
              each product&apos;s PuraMass <strong>case</strong> and{' '}
              <strong>single-vial</strong> SKUs by matching name + strength against
              the PuraMass catalog. Existing mappings are preserved; ambiguous and
              unmatched products are listed per mapping for you to fix manually.
            </p>
            <button
              onClick={handleSyncPuramassSkus}
              disabled={syncingPuramass || isReadOnly}
              className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-medium transition-all text-sm"
            >
              {syncingPuramass ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sync SKUs from catalog
                </>
              )}
            </button>

            {puramassReport && (
              <div className="mt-4 space-y-4">
                {[
                  {
                    key: 'box',
                    label: 'Case SKUs (puramass_sku)',
                    rep: puramassReport.box,
                    src: puramassReport.source.box,
                    avail: true,
                  },
                  {
                    key: 'vial',
                    label: 'Single-vial SKUs (puramass_sku_vial)',
                    rep: puramassReport.vial,
                    src: puramassReport.source.vial,
                    avail: puramassReport.vial_column_available,
                  },
                ].map((sec) => (
                  <div key={sec.key}>
                    <p className="text-xs font-semibold text-ink mb-1.5">{sec.label}</p>
                    {!sec.avail ? (
                      <p className="text-xs text-amber-700">
                        Column not found — run{' '}
                        <code>puramass-vial-sku-migration.sql</code> first.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
                            {sec.rep.counts.updated} mapped
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-surface text-ink-muted border border-line">
                            {sec.rep.counts.skipped_already_set} already set
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            {sec.rep.counts.ambiguous} need review
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                            {sec.rep.counts.unmatched} unmatched
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-surface text-ink-muted border border-line">
                            source: {sec.src}
                          </span>
                        </div>
                        {sec.rep.ambiguous.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-ink mb-1">
                              Ambiguous (set the SKU manually on the product):
                            </p>
                            <ul className="text-xs text-ink-muted space-y-1">
                              {sec.rep.ambiguous.map((a) => (
                                <li key={a.id}>
                                  <span className="font-medium text-ink">{a.name}</span> →{' '}
                                  {a.candidates.join(', ')}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {sec.rep.unmatched.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-ink mb-1">
                              Unmatched (no PuraMass equivalent found):
                            </p>
                            <p className="text-xs text-ink-muted">
                              {sec.rep.unmatched.map((u) => u.name).join(', ')}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Shipping (Easyship) */}
        <div id="shipping" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Shipping (Easyship)</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            When enabled, checkout shows the cheapest live Easyship courier rate.
            When disabled (or if no rates are returned), the flat rate below is used.
          </p>

          {/* Enable toggle */}
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <button
              onClick={() => handleEasyshipToggle(true)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                settings.easyship_enabled ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleRight className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Live rates</span>
                </div>
                {settings.easyship_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Calculate shipping via Easyship</p>
            </button>
            <button
              onClick={() => handleEasyshipToggle(false)}
              disabled={saving || isReadOnly}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                !settings.easyship_enabled ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
              } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ToggleLeft className="w-5 h-5 text-ink" />
                  <span className="font-semibold text-ink">Flat rate</span>
                </div>
                {!settings.easyship_enabled && (
                  <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-muted">Charge a single flat shipping fee</p>
            </button>
          </div>

          {/* API key */}
          <div className="mb-5">
            <label className="flex items-center gap-2 text-sm font-medium text-ink mb-2">
              <KeyRound className="w-4 h-4 text-ink-muted" />
              Easyship API token
              {settings.easyship_api_key_set ? (
                <span className="text-xs text-green-600 font-normal">• configured</span>
              ) : (
                <span className="text-xs text-ink-muted font-normal">• not set</span>
              )}
            </label>
            <input
              type="password"
              value={easyshipApiKeyInput}
              onChange={(e) => setEasyshipApiKeyInput(e.target.value)}
              placeholder={settings.easyship_api_key_set ? 'Enter a new token to replace the saved one' : 'Paste your Easyship API token'}
              disabled={isReadOnly}
              autoComplete="off"
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-ink-muted mt-1">Stored securely; never shown after saving. Leave blank to keep the current token.</p>
          </div>

          {/* Origin address */}
          <div className="mb-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink mb-2">
              <MapPin className="w-4 h-4 text-ink-muted" />
              Origin / warehouse address
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={shipForm.line_1}
                onChange={(e) => setShipForm((f) => ({ ...f, line_1: e.target.value }))}
                placeholder="Street address"
                disabled={isReadOnly}
                className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={shipForm.city}
                  onChange={(e) => setShipForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="City"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
                <input
                  type="text"
                  value={shipForm.state}
                  onChange={(e) => setShipForm((f) => ({ ...f, state: e.target.value }))}
                  placeholder="Province / State"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={shipForm.postal_code}
                  onChange={(e) => setShipForm((f) => ({ ...f, postal_code: e.target.value }))}
                  placeholder="Postal code"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
                <input
                  type="text"
                  value={shipForm.country_alpha2}
                  onChange={(e) => setShipForm((f) => ({ ...f, country_alpha2: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="Country (e.g. CA)"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Sender contact — required by Easyship to create a shipment/label */}
          <div className="mb-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink mb-2">
              <Truck className="w-4 h-4 text-ink-muted" />
              Sender contact
            </h3>
            <p className="text-xs text-ink-muted mb-2">
              Easyship requires a sender company, contact name, email and phone to create a shipping label.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={shipForm.company_name}
                  onChange={(e) => setShipForm((f) => ({ ...f, company_name: e.target.value }))}
                  placeholder="Company name"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
                <input
                  type="text"
                  value={shipForm.contact_name}
                  onChange={(e) => setShipForm((f) => ({ ...f, contact_name: e.target.value }))}
                  placeholder="Contact name"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="email"
                  value={shipForm.contact_email}
                  onChange={(e) => setShipForm((f) => ({ ...f, contact_email: e.target.value }))}
                  placeholder="Contact email"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
                <input
                  type="tel"
                  value={shipForm.contact_phone}
                  onChange={(e) => setShipForm((f) => ({ ...f, contact_phone: e.target.value }))}
                  placeholder="Contact phone"
                  disabled={isReadOnly}
                  className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Parcel + flat rate */}
          <div className="mb-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink mb-2">
              <Package className="w-4 h-4 text-ink-muted" />
              Default parcel & flat rate
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-ink-muted mb-1">Length (cm)</label>
                <input type="number" min="0" value={shipForm.length} onChange={(e) => setShipForm((f) => ({ ...f, length: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Width (cm)</label>
                <input type="number" min="0" value={shipForm.width} onChange={(e) => setShipForm((f) => ({ ...f, width: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Height (cm)</label>
                <input type="number" min="0" value={shipForm.height} onChange={(e) => setShipForm((f) => ({ ...f, height: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-muted mb-1">Weight per vial (kg)</label>
                <input type="number" min="0" step="0.01" value={shipForm.item_weight_kg} onChange={(e) => setShipForm((f) => ({ ...f, item_weight_kg: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Flat rate fallback (CAD)</label>
                <input type="number" min="0" step="0.01" value={shipForm.flat_rate} onChange={(e) => setShipForm((f) => ({ ...f, flat_rate: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-ink-muted mb-1">Free shipping over (CAD)</label>
              <input type="number" min="0" step="0.01" placeholder="0 = disabled" value={shipForm.free_shipping_threshold} onChange={(e) => setShipForm((f) => ({ ...f, free_shipping_threshold: e.target.value }))} disabled={isReadOnly} className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50" />
              <p className="mt-1 text-[11px] text-ink-muted">Orders whose discounted subtotal reaches this amount ship free, and the storefront shows a progress bar. Set 0 to disable.</p>
            </div>
          </div>

          {/* Handling fee — markup added on top of live rates */}
          <div className="mb-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink mb-2">
              <DollarSign className="w-4 h-4 text-ink-muted" />
              Handling fee
            </h3>
            <p className="text-xs text-ink-muted mb-3">
              Added on top of every live courier rate to cover packing and other
              manual labour. It&apos;s folded into the shipping price shown at
              checkout — customers never see it as a separate charge.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-muted mb-1">Type</label>
                <select
                  value={shipForm.handling_fee_type}
                  onChange={(e) =>
                    setShipForm((f) => ({
                      ...f,
                      handling_fee_type: e.target.value === 'percent' ? 'percent' : 'flat',
                    }))
                  }
                  disabled={isReadOnly}
                  className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                >
                  <option value="flat">Flat amount (CAD)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">
                  {shipForm.handling_fee_type === 'percent' ? 'Amount (%)' : 'Amount (CAD)'}
                </label>
                <input
                  type="number"
                  min="0"
                  step={shipForm.handling_fee_type === 'percent' ? '0.1' : '0.01'}
                  value={shipForm.handling_fee_value}
                  onChange={(e) => setShipForm((f) => ({ ...f, handling_fee_value: e.target.value }))}
                  disabled={isReadOnly}
                  placeholder="0"
                  className="w-full px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveShipping}
            disabled={saving || isReadOnly}
            className="w-full sm:w-auto px-5 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Save shipping settings
          </button>
        </div>

        {/* Automatic shipments (Easyship) */}
        <div id="auto-shipments" className="scroll-mt-8 bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-5 h-5 text-ink" />
            <h2 className="text-lg font-semibold text-ink">Automatic shipments</h2>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Create Easyship shipments (and optionally buy labels) automatically as
            orders come in. Everything runs server-side and never affects the
            customer at checkout — any failures are recorded on the dashboard and
            the individual order page.
          </p>

          {/* Auto-create shipment toggle */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-ink mb-1">Auto-create shipment records</h3>
            <p className="text-xs text-ink-muted mb-3">
              When a customer places an order, automatically create a draft Easyship
              shipment so it has a tracking page. No label is purchased at this step.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleAutoCreateShipmentToggle(true)}
                disabled={saving || isReadOnly}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  settings.easyship_auto_create_shipment ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
                } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ToggleRight className="w-5 h-5 text-ink" />
                    <span className="font-semibold text-ink">On</span>
                  </div>
                  {settings.easyship_auto_create_shipment && (
                    <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Create a shipment on every order</p>
              </button>
              <button
                onClick={() => handleAutoCreateShipmentToggle(false)}
                disabled={saving || isReadOnly}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  !settings.easyship_auto_create_shipment ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
                } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ToggleLeft className="w-5 h-5 text-ink" />
                    <span className="font-semibold text-ink">Off</span>
                  </div>
                  {!settings.easyship_auto_create_shipment && (
                    <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Create shipments manually only</p>
              </button>
            </div>
          </div>

          {/* Preferred courier */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-ink mb-1">Preferred courier</h3>
            <p className="text-xs text-ink-muted mb-2">
              Which courier to use for auto-created shipments. Only UPS and FedEx are
              offered; if the preferred one isn&apos;t available for a destination, the
              cheapest of the two is used.
            </p>
            <select
              value={settings.easyship_auto_courier_preference}
              onChange={(e) =>
                handleCourierPreferenceChange(
                  e.target.value === 'ups' || e.target.value === 'fedex'
                    ? e.target.value
                    : 'cheapest',
                )
              }
              disabled={saving || isReadOnly}
              className="w-full sm:w-72 px-3 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink disabled:opacity-50"
            >
              <option value="cheapest">Cheapest (UPS or FedEx)</option>
              <option value="ups">Prefer UPS</option>
              <option value="fedex">Prefer FedEx</option>
            </select>
          </div>

          {/* Auto-buy label toggle */}
          <div>
            <h3 className="text-sm font-medium text-ink mb-1">Auto-buy shipping labels</h3>
            <p className="text-xs text-ink-muted mb-3">
              Once an order&apos;s invoice is marked <span className="font-medium">paid</span>,
              automatically purchase &amp; generate the shipping label. This charges your
              Easyship account, so it only runs after payment — never on unpaid orders.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleAutoBuyLabelToggle(true)}
                disabled={saving || isReadOnly}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  settings.easyship_auto_buy_label ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
                } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ToggleRight className="w-5 h-5 text-ink" />
                    <span className="font-semibold text-ink">On</span>
                  </div>
                  {settings.easyship_auto_buy_label && (
                    <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Buy the label when payment is confirmed</p>
              </button>
              <button
                onClick={() => handleAutoBuyLabelToggle(false)}
                disabled={saving || isReadOnly}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  !settings.easyship_auto_buy_label ? 'border-bronze bg-bronze/5' : 'border-line bg-white hover:border-ink/20'
                } ${(saving || isReadOnly) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ToggleLeft className="w-5 h-5 text-ink" />
                    <span className="font-semibold text-ink">Off</span>
                  </div>
                  {!settings.easyship_auto_buy_label && (
                    <div className="w-5 h-5 bg-bronze rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Buy labels manually from each order</p>
              </button>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">Important Notes:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>All orders use the email/invoice checkout — crypto payments are disabled</li>
                <li>All admin emails receive order notifications, new customer registrations, and low-stock alerts</li>
                <li>Email checkout requires SMTP configuration in .env.local</li>
                <li>Auto-buy labels charges your Easyship account, and only runs after an invoice is marked paid</li>
              </ul>
            </div>
          </div>
        </div>
        </div>

        {/* Right-rail section navigation — desktop only; on mobile the cards
            simply stack. Sticky so it stays in view while the main column
            scrolls. Clicking smooth-scrolls to a section and scroll-spy keeps
            the active item highlighted. */}
        <nav
          aria-label="Settings sections"
          className="hidden lg:block lg:w-56 lg:shrink-0 lg:sticky lg:top-8 lg:self-start"
        >
          <p className="px-3 mb-2 text-[10px] font-semibold text-ink-light uppercase tracking-[0.12em]">
            On this page
          </p>
          <ul className="space-y-0.5 border-l border-line">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`group -ml-px flex w-full items-center gap-2.5 border-l-2 py-1.5 pl-3 pr-2 text-left text-sm transition-colors ${
                      active
                        ? 'border-bronze font-medium text-ink'
                        : 'border-transparent text-ink-muted hover:border-ink/20 hover:text-ink'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-bronze' : 'text-ink-light group-hover:text-ink'
                      }`}
                    />
                    <span className="truncate">{section.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
