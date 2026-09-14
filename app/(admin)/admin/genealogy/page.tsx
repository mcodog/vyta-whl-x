'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Network, Users, Briefcase, UserCircle, MapPin, Search, ChevronRight, ChevronDown,
  FileText, ExternalLink, Mail, Phone, X, Wallet, Percent, Layers,
  ChevronsDownUp, ChevronsUpDown, TrendingUp, Info, Building2,
  ZoomIn, ZoomOut, Maximize2, Move,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import StatTile from '@/components/admin/StatTile';
import { getRoleBadgeClasses, getRoleName, type UserRole } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Types (mirror the /api/admin/genealogy payload)
// ---------------------------------------------------------------------------
type Affiliate = {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  active: boolean | null; total_earnings: number | null; created_at: string | null;
};
type SalesPerson = {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  commission_rate: number | null; active: boolean | null; total_earnings: number | null;
  user_id: string | null; created_at: string | null;
};
type Customer = {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  phone: string | null; role: UserRole | null; active: boolean | null;
  price_currency: 'CAD' | 'USD' | null; affiliate_id: string | null;
  default_sales_person_id: string | null; shipping_city: string | null;
  shipping_state: string | null; shipping_country: string | null; created_at: string | null;
  invoice_count: number; revenue: number; last_invoice_at: string | null; client_count: number;
};
type ClientRec = {
  id: string; customer_id: string; first_name: string | null; last_name: string | null;
  address: string | null; city: string | null; state: string | null; country: string | null;
  email: string | null; phone: string | null; created_at: string | null;
};

type NodeKind = 'apex' | 'affiliate' | 'salesperson' | 'unassigned' | 'unknown' | 'customer' | 'client';

interface TNode {
  key: string;
  kind: NodeKind;
  title: string;
  subtitle: string | null;
  search: string;
  data: any;
  children: TNode[];
  // roll-ups
  customerCount?: number;
  revenue?: number;
  clientCount?: number;
  invoiceCount?: number;
}

type Grouping = 'salesperson' | 'affiliate';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const fullName = (f?: string | null, l?: string | null) => `${f ?? ''} ${l ?? ''}`.trim();

const initials = (f?: string | null, l?: string | null, fallback?: string | null) => {
  const a = (f ?? '').trim();
  const b = (l ?? '').trim();
  if (a || b) return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase();
  const fb = (fallback ?? '').trim();
  return fb ? fb[0].toUpperCase() : '?';
};

const fmtMoney = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
const fmtInt = (n: number) => Math.round(n || 0).toLocaleString('en-US');

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const cityLine = (city?: string | null, state?: string | null, country?: string | null) =>
  [city, state, country].map((x) => (x ?? '').trim()).filter(Boolean).join(', ') || null;

const clampNum = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;

// Run layout measurements before paint on the client; fall back to useEffect on
// the server so Next doesn't warn during SSR.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
const AVATAR: Record<NodeKind, { cls: string; icon: typeof Users | null }> = {
  apex: { cls: 'bg-bronze/15 text-bronze', icon: Network },
  affiliate: { cls: 'bg-emerald-500/10 text-emerald-600', icon: Users },
  salesperson: { cls: 'bg-purple-500/10 text-purple-600', icon: Briefcase },
  unassigned: { cls: 'bg-surface text-ink-muted border border-line', icon: Layers },
  unknown: { cls: 'bg-amber-500/10 text-amber-600', icon: Users },
  customer: { cls: 'bg-bronze/10 text-bronze', icon: null },
  client: { cls: 'bg-blue-500/10 text-blue-600', icon: MapPin },
};

function Avatar({ node, size = 'md' }: { node: TNode; size?: 'sm' | 'md' | 'lg' }) {
  const { cls, icon: Icon } = AVATAR[node.kind];
  const dim = size === 'lg' ? 'w-11 h-11 rounded-xl' : size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-9 h-9 rounded-lg';
  const iconDim = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <span className={`shrink-0 inline-flex items-center justify-center ${dim} ${cls}`}>
      {Icon ? (
        <Icon className={iconDim} />
      ) : (
        <span className={`font-semibold ${size === 'lg' ? 'text-sm' : 'text-xs'}`}>
          {initials(node.data?.first_name, node.data?.last_name, node.data?.email)}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Org-chart node card + connectors
// ---------------------------------------------------------------------------
function CardBadges({ d }: { d: any }) {
  if (!d) return null;
  const role = d.role as UserRole | undefined;
  const showRole = role && role !== 'customer';
  const showUsd = d.price_currency === 'USD';
  const showInactive = d.active === false;
  if (!showRole && !showUsd && !showInactive) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {showRole && (
        <span className={`px-1 py-0.5 rounded text-[9px] font-semibold tracking-wide ${getRoleBadgeClasses(role!)}`}>
          {getRoleName(role!)}
        </span>
      )}
      {showUsd && <span className="px-1 py-0.5 rounded text-[9px] font-semibold tracking-wide bg-blue-500/10 text-blue-600">USD</span>}
      {showInactive && <span className="px-1 py-0.5 rounded text-[9px] font-semibold tracking-wide bg-red-500/10 text-red-500">Inactive</span>}
    </div>
  );
}

function CardStats({ node }: { node: TNode }) {
  if (node.kind === 'customer') {
    return (
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1 tabular-nums" title="Invoices"><FileText className="w-3 h-3" />{node.invoiceCount ?? 0}</span>
        {node.clientCount ? (
          <span className="inline-flex items-center gap-1 tabular-nums" title="Clients"><MapPin className="w-3 h-3" />{node.clientCount}</span>
        ) : null}
        <span className="font-semibold text-ink tabular-nums" title="Revenue">{fmtMoney(node.revenue ?? 0)}</span>
      </div>
    );
  }
  if (node.kind === 'client') {
    const loc = cityLine(node.data?.city, node.data?.state, node.data?.country);
    return <div className="text-[11px] text-ink-muted truncate">{loc || 'Ship-to client'}</div>;
  }
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
      <span className="inline-flex items-center gap-1 tabular-nums" title="Customers"><UserCircle className="w-3 h-3" />{node.customerCount ?? 0}</span>
      {node.clientCount ? (
        <span className="inline-flex items-center gap-1 tabular-nums" title="Clients"><MapPin className="w-3 h-3" />{node.clientCount}</span>
      ) : null}
      <span className="font-semibold text-ink tabular-nums" title="Revenue">{fmtMoney(node.revenue ?? 0)}</span>
    </div>
  );
}

function NodeCard({
  node, isOpen, selected, onToggle, onSelect,
}: {
  node: TNode; isOpen: boolean; selected: boolean;
  onToggle: (k: string) => void; onSelect: (n: TNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const showExpander = hasChildren && node.kind !== 'apex';
  const accent = node.kind === 'apex';
  return (
    <div className="relative">
      <div
        data-node-key={node.key}
        onClick={() => onSelect(node)}
        className={`w-52 rounded-xl border bg-white px-3 py-2.5 cursor-pointer transition-[border-color,box-shadow] duration-150 ${
          selected
            ? 'border-bronze ring-2 ring-bronze/30 shadow-sm'
            : accent
              ? 'border-bronze/40 shadow-sm hover:border-bronze'
              : 'border-line hover:border-bronze/40 hover:shadow-sm'
        }`}
      >
        <div className="flex items-center gap-2 text-left">
          <Avatar node={node} size={accent ? 'md' : 'sm'} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink text-sm truncate">{node.title}</div>
            {node.subtitle && <div className="text-[11px] text-ink-muted truncate">{node.subtitle}</div>}
          </div>
        </div>
        {node.kind === 'customer' && <CardBadges d={node.data} />}
        <div className="mt-2 pt-2 border-t border-line/60">
          <CardStats node={node} />
        </div>
      </div>

      {showExpander && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(node.key); }}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          className="absolute left-1/2 -translate-x-1/2 -bottom-3 z-10 inline-flex items-center gap-1 h-6 px-2 rounded-full border border-line bg-white text-ink-muted hover:text-ink hover:border-bronze/50 shadow-sm text-[11px] font-semibold tabular-nums transition-colors"
        >
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {node.children.length}
        </button>
      )}
    </div>
  );
}

function OrgNode({
  node, expanded, searchActive, selectedKey, onToggle, onSelect,
}: {
  node: TNode; expanded: Set<string>; searchActive: boolean; selectedKey: string | null;
  onToggle: (k: string) => void; onSelect: (n: TNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = node.kind === 'apex' || searchActive || expanded.has(node.key);
  return (
    <li>
      <NodeCard
        node={node}
        isOpen={isOpen}
        selected={selectedKey === node.key}
        onToggle={onToggle}
        onSelect={onSelect}
      />
      {hasChildren && isOpen && (
        <ul>
          {node.children.map((ch) => (
            <OrgNode
              key={ch.key}
              node={ch}
              expanded={expanded}
              searchActive={searchActive}
              selectedKey={selectedKey}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail panel building blocks
// ---------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-line/60 last:border-0">
      <span className="text-xs text-ink-muted shrink-0">{label}</span>
      <span className="text-sm text-ink text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-center">
      <div className="text-base font-bold text-ink tabular-nums leading-none">{value}</div>
      <div className="text-[10px] text-ink-muted uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function PanelLink({ href, label, subtle }: { href: string; label: string; subtle?: boolean }) {
  return (
    <Link
      href={href}
      className={`mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        subtle ? 'bg-white border border-line text-ink-muted hover:text-ink hover:bg-surface' : 'bg-ink text-white hover:bg-ink/90'
      }`}
    >
      {label} <ExternalLink className="w-3.5 h-3.5" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function GenealogyPage() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [salesPersons, setSalesPersons] = useState<SalesPerson[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clients, setClients] = useState<ClientRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Sales-person lineage is the primary view.
  const [grouping, setGrouping] = useState<Grouping>('salesperson');
  const [search, setSearch] = useState('');
  const [showClients, setShowClients] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TNode | null>(null);

  // Pan / zoom canvas state. Panning is applied imperatively during the drag
  // (no re-render per frame) and committed to `view` on release.
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const panRef = useRef({ id: -1, startX: 0, startY: 0, ox: 0, oy: 0, curX: 0, curY: 0, active: false, panning: false });
  const didPanRef = useRef(false);
  useEffect(() => { viewRef.current = view; }, [view]);

  // When true, the world transform animates (used for the zoom/fit buttons).
  const [animate, setAnimate] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending "keep this node under the cursor after expand/collapse" measurement.
  const anchorRef = useRef<{ key: string; left: number; top: number; opening: boolean } | null>(null);
  // Timer that clears the transient transition after an expand/collapse glide.
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors of state read inside imperative effects (avoids stale closures).
  const expandedRef = useRef(expanded);
  const searchActiveRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/genealogy', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setAffiliates(json.affiliates ?? []);
      setSalesPersons(json.salesPersons ?? []);
      setCustomers(json.customers ?? []);
      setClients(json.clients ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lookups used both by the tree builder and the detail panel.
  const affById = useMemo(() => new Map(affiliates.map((a) => [a.id, a] as const)), [affiliates]);
  const spById = useMemo(() => new Map(salesPersons.map((s) => [s.id, s] as const)), [salesPersons]);
  const custById = useMemo(() => new Map(customers.map((c) => [c.id, c] as const)), [customers]);
  const clientsByCustomer = useMemo(() => {
    const m = new Map<string, ClientRec[]>();
    for (const cl of clients) {
      const arr = m.get(cl.customer_id) ?? [];
      arr.push(cl);
      m.set(cl.customer_id, arr);
    }
    return m;
  }, [clients]);

  // Build a customer node (+ optional client leaves).
  const makeCustomerNode = useCallback((c: Customer): TNode => {
    const name = fullName(c.first_name, c.last_name) || c.email || 'Unnamed customer';
    const kids = showClients ? (clientsByCustomer.get(c.id) ?? []) : [];
    const children: TNode[] = kids.map((cl) => {
      const cname = fullName(cl.first_name, cl.last_name) || cl.email || 'Client';
      const loc = cityLine(cl.city, cl.state, cl.country);
      return {
        key: `cl:${cl.id}`,
        kind: 'client',
        title: cname,
        // Location lives in the card's stat row, so keep email (if any) here to
        // avoid showing the location twice.
        subtitle: cl.email,
        search: `${cname} ${cl.email ?? ''} ${loc ?? ''}`.toLowerCase(),
        data: cl,
        children: [],
      };
    });
    return {
      key: `c:${c.id}`,
      kind: 'customer',
      title: name,
      subtitle: c.email,
      search: `${name} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase(),
      data: c,
      children,
      revenue: c.revenue,
      invoiceCount: c.invoice_count,
      clientCount: c.client_count,
    };
  }, [clientsByCustomer, showClients]);

  // Assemble the principal-level roots for the selected grouping.
  const roots = useMemo<TNode[]>(() => {
    const custByRoot = new Map<string, Customer[]>();
    const NONE = '__none__';
    for (const c of customers) {
      const key = grouping === 'affiliate' ? (c.affiliate_id ?? NONE) : (c.default_sales_person_id ?? NONE);
      const arr = custByRoot.get(key) ?? [];
      arr.push(c);
      custByRoot.set(key, arr);
    }

    const rollup = (custNodes: TNode[]) => ({
      customerCount: custNodes.length,
      revenue: custNodes.reduce((s, n) => s + (n.revenue ?? 0), 0),
      clientCount: custNodes.reduce((s, n) => s + (n.clientCount ?? 0), 0),
    });
    const sortCustNodes = (a: TNode, b: TNode) =>
      (b.revenue ?? 0) - (a.revenue ?? 0) || a.title.localeCompare(b.title);

    const out: TNode[] = [];
    const used = new Set<string>();

    const principals: { id: string; name: string; email: string | null; data: any }[] =
      grouping === 'affiliate'
        ? affiliates.map((a) => ({
            id: a.id, name: fullName(a.first_name, a.last_name) || a.email || 'Affiliate', email: a.email, data: a,
          }))
        : salesPersons.map((s) => ({
            id: s.id, name: fullName(s.first_name, s.last_name) || s.email || 'Sales person', email: s.email, data: s,
          }));

    for (const p of principals) {
      used.add(p.id);
      const custNodes = (custByRoot.get(p.id) ?? []).map(makeCustomerNode).sort(sortCustNodes);
      out.push({
        key: `${grouping}:${p.id}`,
        kind: grouping === 'affiliate' ? 'affiliate' : 'salesperson',
        title: p.name,
        subtitle: p.email,
        search: `${p.name} ${p.email ?? ''}`.toLowerCase(),
        data: p.data,
        children: custNodes,
        ...rollup(custNodes),
      });
    }

    // Attribution ids that don't resolve to a principal record (in the newer
    // model an affiliate can be a customer account — fall back to that).
    for (const [key, list] of custByRoot) {
      if (key === NONE || used.has(key)) continue;
      const custNodes = list.map(makeCustomerNode).sort(sortCustNodes);
      const acc = custById.get(key);
      if (acc) {
        const name = fullName(acc.first_name, acc.last_name) || acc.email || 'Affiliate';
        out.push({
          key: `${grouping}:${key}`,
          kind: grouping === 'affiliate' ? 'affiliate' : 'salesperson',
          title: name,
          subtitle: acc.email,
          search: `${name} ${acc.email ?? ''}`.toLowerCase(),
          data: acc,
          children: custNodes,
          ...rollup(custNodes),
        });
      } else {
        out.push({
          key: `unknown:${key}`,
          kind: 'unknown',
          title: grouping === 'affiliate' ? 'Unknown affiliate' : 'Unknown sales person',
          subtitle: null,
          search: 'unknown',
          data: { id: key },
          children: custNodes,
          ...rollup(custNodes),
        });
      }
    }

    // Direct customers — not attributed to anyone.
    const none = (custByRoot.get(NONE) ?? []).map(makeCustomerNode).sort(sortCustNodes);
    if (none.length) {
      out.push({
        key: 'unassigned',
        kind: 'unassigned',
        title: grouping === 'affiliate' ? 'Direct customers' : 'No sales person',
        subtitle: grouping === 'affiliate' ? 'No affiliate attribution' : 'No default sales person',
        search: 'direct unassigned none',
        data: null,
        children: none,
        ...rollup(none),
      });
    }

    const bucketRank = (n: TNode) => (n.kind === 'unassigned' ? 2 : n.kind === 'unknown' ? 1 : 0);
    out.sort((a, b) =>
      bucketRank(a) - bucketRank(b) ||
      (b.customerCount ?? 0) - (a.customerCount ?? 0) ||
      (b.revenue ?? 0) - (a.revenue ?? 0) ||
      a.title.localeCompare(b.title));

    return out;
  }, [customers, grouping, affiliates, salesPersons, makeCustomerNode, custById]);

  // Apply "hide empty" + search filtering to the principal roots.
  const q = search.trim().toLowerCase();
  const searchActive = q.length > 0;

  const visibleRoots = useMemo<TNode[]>(() => {
    let base = roots;
    if (hideEmpty && !searchActive) base = base.filter((r) => (r.customerCount ?? 0) > 0);
    if (!searchActive) return base;

    const filterNode = (node: TNode): TNode | null => {
      const self = node.search.includes(q);
      const kids = node.children.map(filterNode).filter(Boolean) as TNode[];
      if (self || kids.length) return { ...node, children: self ? node.children : kids };
      return null;
    };
    return base.map(filterNode).filter(Boolean) as TNode[];
  }, [roots, hideEmpty, searchActive, q]);

  // The apex wraps everything into a single hierarchical graph.
  const apex = useMemo<TNode>(() => {
    const children = visibleRoots;
    const customerCount = children.reduce((s, n) => s + (n.customerCount ?? 0), 0);
    const revenue = children.reduce((s, n) => s + (n.revenue ?? 0), 0);
    const clientCount = children.reduce((s, n) => s + (n.clientCount ?? 0), 0);
    return {
      key: 'apex',
      kind: 'apex',
      title: grouping === 'salesperson' ? 'Sales Team' : 'Affiliate Network',
      subtitle: grouping === 'salesperson' ? `${children.length} sales people` : `${children.length} affiliates`,
      search: '',
      data: null,
      children,
      customerCount,
      revenue,
      clientCount,
    };
  }, [visibleRoots, grouping]);

  // Totals for the header tiles (whole graph, independent of filters).
  const totals = useMemo(() => ({
    affiliates: affiliates.length,
    affiliatesActive: affiliates.filter((a) => a.active !== false).length,
    salesPersons: salesPersons.length,
    salesPersonsActive: salesPersons.filter((s) => s.active !== false).length,
    customers: customers.length,
    attributed: customers.filter((c) => c.affiliate_id || c.default_sales_person_id).length,
    clients: clients.length,
    revenue: customers.reduce((s, c) => s + (c.revenue || 0), 0),
  }), [affiliates, salesPersons, customers, clients]);

  const toggle = useCallback((k: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  const collectKeys = (nodes: TNode[], acc: string[] = []): string[] => {
    for (const n of nodes) {
      if (n.children.length) { acc.push(n.key); collectKeys(n.children, acc); }
    }
    return acc;
  };
  const expandAll = () => setExpanded(new Set(collectKeys(apex.children)));
  const collapseAll = () => setExpanded(new Set());

  const changeGrouping = (g: Grouping) => {
    if (g === grouping) return;
    setExpanded(new Set());
    setSelected(null);
    setGrouping(g);
  };

  // ---- pan / zoom ---------------------------------------------------------
  const applyZoom = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = clampNum(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      if (k === v.k) return v;
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    applyZoom(factor, vp.clientWidth / 2, vp.clientHeight / 2);
  }, [applyZoom]);

  // Briefly enable the transform transition so a button-driven view change glides.
  const withAnim = useCallback(() => {
    setAnimate(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setAnimate(false), 320);
  }, []);

  // Scale + center the whole tree to fit the viewport (never upscaling past 1:1).
  const fitView = useCallback(() => {
    const vp = viewportRef.current, w = worldRef.current;
    if (!vp || !w) return;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    const cw = w.offsetWidth, ch = w.offsetHeight;
    if (!cw || !ch) return;
    const pad = 56;
    const k = clampNum(Math.min((vw - pad) / cw, (vh - pad) / ch, 1), MIN_ZOOM, MAX_ZOOM);
    const x = (vw - cw * k) / 2;
    const y = ch * k > vh - pad ? 28 : (vh - ch * k) / 2;
    setView({ x, y, k });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = panRef.current;
    p.active = true; p.panning = false; p.id = e.pointerId;
    p.startX = e.clientX; p.startY = e.clientY;
    p.ox = viewRef.current.x; p.oy = viewRef.current.y;
    didPanRef.current = false;
    // A pan must follow the pointer instantly — never through the button easing.
    setAnimate(false);
    if (worldRef.current) worldRef.current.style.transition = 'none';
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p.active) return;
    const dx = e.clientX - p.startX, dy = e.clientY - p.startY;
    if (!p.panning) {
      if (Math.hypot(dx, dy) < 4) return; // ignore micro-movement so clicks still register
      p.panning = true; didPanRef.current = true;
      try { viewportRef.current?.setPointerCapture(p.id); } catch { /* ignore */ }
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    }
    const x = p.ox + dx, y = p.oy + dy;
    p.curX = x; p.curY = y;
    // Apply straight to the DOM during the drag; commit to state on release.
    if (worldRef.current) worldRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${viewRef.current.k})`;
    if (viewportRef.current) viewportRef.current.style.backgroundPosition = `${x}px ${y}px`;
  };
  const endPan = () => {
    const p = panRef.current;
    if (!p.active) return;
    p.active = false;
    if (p.panning) {
      try { viewportRef.current?.releasePointerCapture(p.id); } catch { /* ignore */ }
      if (viewportRef.current) viewportRef.current.style.cursor = '';
      setView((v) => ({ ...v, x: p.curX, y: p.curY }));
    }
    p.panning = false;
  };

  // Selecting/toggling is suppressed when the gesture was actually a pan.
  const handleSelect = useCallback((n: TNode) => { if (!didPanRef.current) setSelected(n); }, []);
  // Record where the toggled node sits before the layout reflows, so the tree can
  // glide smoothly into its new shape afterwards (see the layout effect below).
  const handleToggle = useCallback((k: string) => {
    if (didPanRef.current) return;
    const el = viewportRef.current?.querySelector(`[data-node-key="${k}"]`) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      anchorRef.current = { key: k, left: r.left, top: r.top, opening: !expandedRef.current.has(k) };
    } else {
      anchorRef.current = null;
    }
    toggle(k);
  }, [toggle]);

  // After an expand/collapse reflow, animate the tree into its new position using
  // the same easing as the zoom/fit buttons — so extending a node glides instead
  // of snapping. The reflow itself is instantaneous (flexbox re-layout can't be
  // transitioned), so we FLIP the world transform: seed it at the offset that
  // keeps the toggled node exactly where the user clicked (no jump), force that
  // to paint, then transition to the natural resting transform. The whole canvas
  // — cards and connectors together — pans as one, matching the recenter feel.
  useIsoLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    anchorRef.current = null;
    const vp = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    const el = vp.querySelector(`[data-node-key="${a.key}"]`) as HTMLElement | null;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const dx = r.left - a.left;
    const dy = r.top - a.top;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      // Respect the user's preference: keep the toggled node pinned, no motion.
      if (dx || dy) setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      return;
    }

    const v = viewRef.current;
    if (dx || dy) {
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      world.style.transition = 'none';
      world.style.transform = `translate3d(${v.x - dx}px, ${v.y - dy}px, 0) scale(${v.k})`;
      // Force the seeded (pre-reflow) transform to commit before we animate away
      // from it, otherwise the browser coalesces both writes and nothing eases.
      void world.offsetWidth;
      world.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
      world.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})`;
      flipTimerRef.current = setTimeout(() => {
        if (worldRef.current) worldRef.current.style.transition = 'none';
      }, 360);
    }

    // Fade + slide the freshly revealed children in (skip while a search already
    // forces every branch open, and on collapse there is nothing new to reveal).
    if (a.opening && !searchActiveRef.current) {
      const li = el.closest('li');
      const childUl = li ? (li.querySelector(':scope > ul') as HTMLElement | null) : null;
      if (childUl) {
        childUl.style.transition = 'none';
        childUl.style.opacity = '0';
        childUl.style.transform = 'translateY(-6px)';
        void childUl.offsetWidth;
        childUl.style.transition = 'opacity 260ms ease-out, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        childUl.style.opacity = '1';
        childUl.style.transform = 'translateY(0)';
        const ul = childUl;
        setTimeout(() => {
          ul.style.transition = '';
          ul.style.opacity = '';
          ul.style.transform = '';
        }, 320);
      }
    }
  }, [expanded]);

  // Keep the refs read inside imperative handlers/effects up to date.
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { searchActiveRef.current = searchActive; }, [searchActive]);
  useEffect(() => () => { if (flipTimerRef.current) clearTimeout(flipTimerRef.current); }, []);

  // Wheel to zoom toward the cursor (non-passive so we can preventDefault the page scroll).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      applyZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener('wheel', handler, { passive: false });
    return () => vp.removeEventListener('wheel', handler);
  }, [applyZoom]);

  // Fit on first load and when the grouping switches.
  useEffect(() => {
    if (loading || error || !visibleRoots.length) return;
    const id = requestAnimationFrame(() => fitView());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, grouping]);

  const gridGap = 26 * view.k;
  const canvasStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface, #F7F7F7)',
    backgroundImage: [
      'linear-gradient(to right, rgba(26,26,26,0.05) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(26,26,26,0.05) 1px, transparent 1px)',
      'linear-gradient(to right, rgba(26,26,26,0.08) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(26,26,26,0.08) 1px, transparent 1px)',
    ].join(','),
    backgroundSize: `${gridGap}px ${gridGap}px, ${gridGap}px ${gridGap}px, ${gridGap * 5}px ${gridGap * 5}px, ${gridGap * 5}px ${gridGap * 5}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
  const hasGraph = !loading && !error && visibleRoots.length > 0;

  return (
    <>
      {/* org-chart connector styling (scoped to .gtree) */}
      <style>{`
        .gtree ul { position: relative; display: flex; justify-content: center; padding-top: 22px; }
        .gtree li { list-style: none; position: relative; padding: 22px 10px 0; display: flex; flex-direction: column; align-items: center; }
        .gtree li::before, .gtree li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 22px; border-top: 2.5px solid var(--color-line, #C9CCD1); }
        .gtree li::after { right: auto; left: 50%; border-left: 2.5px solid var(--color-line, #C9CCD1); }
        .gtree li:only-child::before, .gtree li:only-child::after { display: none; }
        .gtree li:only-child { padding-top: 0; }
        .gtree li:first-child::before, .gtree li:last-child::after { border: 0 none; }
        .gtree li:last-child::before { border-right: 2.5px solid var(--color-line, #C9CCD1); border-radius: 0 6px 0 0; }
        .gtree li:first-child::after { border-radius: 6px 0 0 0; }
        .gtree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 22px; border-left: 2.5px solid var(--color-line, #C9CCD1); }
        .gtree > ul { padding-top: 0; }
      `}</style>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
          <Network className="w-6 h-6 text-bronze" /> Customer Genealogy
        </h1>
        <p className="text-sm text-ink-muted mt-1 max-w-2xl">
          The hierarchy of who owns whom — from the sales person (or affiliate) at the top, down to
          each customer and the clients (end-recipients) they ship to.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
        <StatTile icon={Briefcase} tint="purple" label="Sales People" value={totals.salesPersons}
          sub={`${totals.salesPersonsActive} active`} loading={loading} />
        <StatTile icon={Users} tint="emerald" label="Affiliates" value={totals.affiliates}
          sub={`${totals.affiliatesActive} active`} loading={loading} />
        <StatTile icon={UserCircle} tint="bronze" label="Customers" value={totals.customers}
          sub={`${totals.attributed} attributed`} loading={loading} />
        <StatTile icon={MapPin} tint="blue" label="Clients" value={totals.clients}
          sub="ship-to recipients" loading={loading} />
        <StatTile icon={TrendingUp} tint="ink" label="Revenue" value={totals.revenue}
          sub="invoiced (excl. cancelled)" loading={loading} format={fmtMoney} />
      </div>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="inline-flex bg-white border border-line rounded-lg p-0.5 shrink-0">
          {(['salesperson', 'affiliate'] as Grouping[]).map((g) => (
            <button
              key={g}
              onClick={() => changeGrouping(g)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                grouping === g ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {g === 'salesperson' ? <Briefcase className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
              {g === 'salesperson' ? 'By Sales Person' : 'By Affiliate'}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search people, customers, clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowClients((v) => !v)}
            title="Toggle client (ship-to) leaves"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showClients ? 'bg-blue-500/10 border-blue-500/20 text-blue-600' : 'bg-white border-line text-ink-muted hover:text-ink'
            }`}
          >
            <MapPin className="w-4 h-4" /> Clients
          </button>
          <button
            onClick={() => setHideEmpty((v) => !v)}
            title="Show or hide people with no customers"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              hideEmpty ? 'bg-white border-line text-ink-muted hover:text-ink' : 'bg-bronze/10 border-bronze/20 text-bronze'
            }`}
          >
            <Layers className="w-4 h-4" /> {hideEmpty ? 'Active only' : 'Show all'}
          </button>
          <div className="hidden sm:flex items-center gap-1">
            <button onClick={expandAll} title="Expand all"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors">
              <ChevronsUpDown className="w-4 h-4" />
            </button>
            <button onClick={collapseAll} title="Collapse all"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors">
              <ChevronsDownUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body: graph + detail */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-5 items-start">
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              {grouping === 'salesperson' ? <Briefcase className="w-4 h-4 text-bronze" /> : <Users className="w-4 h-4 text-bronze" />}
              {grouping === 'salesperson' ? 'Sales-person hierarchy' : 'Affiliate hierarchy'}
            </h2>
            <span className="text-xs text-ink-muted">
              {visibleRoots.length} {grouping === 'salesperson' ? 'sales people' : 'affiliates'}
            </span>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerLeave={endPan}
            className={`relative h-[64vh] min-h-[440px] overflow-hidden select-none touch-none ${hasGraph ? 'cursor-grab' : ''}`}
            style={canvasStyle}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-8 animate-pulse">
                  <div className="w-52 h-[68px] rounded-xl bg-white border border-line" />
                  <div className="flex gap-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="w-52 h-[68px] rounded-xl bg-white border border-line" />
                    ))}
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center text-center text-sm px-6">
                <div>
                  <p className="text-red-500 mb-3">{error}</p>
                  <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90">
                    Try again
                  </button>
                </div>
              </div>
            ) : visibleRoots.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-ink-muted text-sm px-6 text-center">
                {searchActive ? 'No people, customers or clients match your search.' : 'Nothing to show yet.'}
              </div>
            ) : (
              <div
                ref={worldRef}
                className="absolute top-0 left-0 w-max origin-top-left will-change-transform"
                style={{
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
                  transition: animate ? 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                }}
              >
                <div className="gtree inline-block">
                  <ul>
                    <OrgNode
                      node={apex}
                      expanded={expanded}
                      searchActive={searchActive}
                      selectedKey={selected?.key ?? null}
                      onToggle={handleToggle}
                      onSelect={handleSelect}
                    />
                  </ul>
                </div>
              </div>
            )}

            {hasGraph && (
              <>
                {/* zoom controls */}
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-3 right-3 flex flex-col items-stretch gap-1.5"
                >
                  <div className="flex flex-col rounded-lg border border-line bg-white shadow-sm overflow-hidden">
                    <button onClick={() => { withAnim(); zoomBy(1.2); }} title="Zoom in" aria-label="Zoom in"
                      className="w-9 h-9 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <div className="h-px bg-line" />
                    <button onClick={() => { withAnim(); zoomBy(1 / 1.2); }} title="Zoom out" aria-label="Zoom out"
                      className="w-9 h-9 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <div className="h-px bg-line" />
                    <button onClick={() => { withAnim(); fitView(); }} title="Fit to view" aria-label="Fit to view"
                      className="w-9 h-9 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-center text-[10px] font-semibold text-ink-muted tabular-nums bg-white border border-line rounded-md py-0.5">
                    {Math.round(view.k * 100)}%
                  </div>
                </div>

                {/* hint */}
                <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 text-[11px] text-ink-muted bg-white/85 backdrop-blur-sm border border-line rounded-md px-2 py-1">
                  <Move className="w-3.5 h-3.5" /> Drag to pan · scroll to zoom
                </div>
              </>
            )}
          </div>
        </div>

        <div className="xl:sticky xl:top-6">
          <DetailPanel
            node={selected}
            affById={affById}
            spById={spById}
            custById={custById}
            grouping={grouping}
            onClose={() => setSelected(null)}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function DetailPanel({
  node, affById, spById, custById, grouping, onClose,
}: {
  node: TNode | null;
  affById: Map<string, Affiliate>;
  spById: Map<string, SalesPerson>;
  custById: Map<string, Customer>;
  grouping: Grouping;
  onClose: () => void;
}) {
  if (!node) {
    return (
      <div className="bg-white rounded-xl border border-line p-6 text-center">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-surface text-ink-muted mb-3">
          <Info className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-ink">Select anyone in the tree</p>
        <p className="text-xs text-ink-muted mt-1">
          Click a node — sales person, affiliate, customer or client — to see their full profile and relationships here.
        </p>
      </div>
    );
  }

  const kindLabel: Record<NodeKind, string> = {
    apex: grouping === 'salesperson' ? 'Sales Team' : 'Affiliate Network',
    affiliate: 'Affiliate', salesperson: 'Sales Person', unassigned: 'Group',
    unknown: 'Unresolved', customer: 'Customer', client: 'Client (ship-to)',
  };
  const d = node.data;

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="p-5 border-b border-line flex items-start gap-3">
        <Avatar node={node} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{kindLabel[node.kind]}</p>
          <h3 className="text-base font-bold text-ink leading-tight break-words">{node.title}</h3>
          {node.subtitle && <p className="text-xs text-ink-muted mt-0.5 break-all">{node.subtitle}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="shrink-0 text-ink-muted hover:text-ink">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5">
        {node.kind === 'apex' && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Customers" value={fmtInt(node.customerCount ?? 0)} />
              <MiniStat label="Clients" value={fmtInt(node.clientCount ?? 0)} />
              <MiniStat label="Revenue" value={fmtMoney(node.revenue ?? 0)} />
            </div>
            <p className="text-xs text-ink-muted flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              The top of the hierarchy. Everyone below is grouped by the {grouping === 'salesperson' ? 'sales person who owns them' : 'affiliate that referred them'}.
            </p>
          </>
        )}

        {node.kind === 'affiliate' && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Customers" value={fmtInt(node.customerCount ?? 0)} />
              <MiniStat label="Clients" value={fmtInt(node.clientCount ?? 0)} />
              <MiniStat label="Revenue" value={fmtMoney(node.revenue ?? 0)} />
            </div>
            <div className="space-y-0">
              {d?.email && <Field label="Email"><a href={`mailto:${d.email}`} className="hover:text-bronze inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{d.email}</a></Field>}
              <Field label="Status">{d?.active === false ? 'Inactive' : 'Active'}</Field>
              {typeof d?.total_earnings === 'number' && (
                <Field label="Commissions"><span className="inline-flex items-center gap-1"><Wallet className="w-3.5 h-3.5 text-ink-muted" />{fmtMoney(d.total_earnings)}</span></Field>
              )}
              {d?.created_at && <Field label="Joined">{fmtDate(d.created_at)}</Field>}
            </div>
            <PanelLink href="/admin/affiliates" label="Open in Affiliates" />
          </>
        )}

        {node.kind === 'salesperson' && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Customers" value={fmtInt(node.customerCount ?? 0)} />
              <MiniStat label="Clients" value={fmtInt(node.clientCount ?? 0)} />
              <MiniStat label="Revenue" value={fmtMoney(node.revenue ?? 0)} />
            </div>
            <div className="space-y-0">
              {d?.email && <Field label="Email"><a href={`mailto:${d.email}`} className="hover:text-bronze inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{d.email}</a></Field>}
              {typeof d?.commission_rate === 'number' && (
                <Field label="Commission"><span className="inline-flex items-center gap-1"><Percent className="w-3.5 h-3.5 text-ink-muted" />{d.commission_rate}%</span></Field>
              )}
              <Field label="Status">{d?.active === false ? 'Inactive' : 'Active'}</Field>
              {typeof d?.total_earnings === 'number' && <Field label="Earnings">{fmtMoney(d.total_earnings)}</Field>}
            </div>
            <PanelLink href="/admin/sales-people" label="Open in Sales People" />
          </>
        )}

        {node.kind === 'customer' && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Invoices" value={fmtInt(node.invoiceCount ?? 0)} />
              <MiniStat label="Clients" value={fmtInt(node.clientCount ?? 0)} />
              <MiniStat label="Revenue" value={fmtMoney(node.revenue ?? 0)} />
            </div>
            <div className="space-y-0">
              {d?.email && <Field label="Email"><a href={`mailto:${d.email}`} className="hover:text-bronze inline-flex items-center gap-1 break-all"><Mail className="w-3.5 h-3.5 shrink-0" />{d.email}</a></Field>}
              {d?.phone && <Field label="Phone"><span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-ink-muted" />{d.phone}</span></Field>}
              {cityLine(d?.shipping_city, d?.shipping_state, d?.shipping_country) && (
                <Field label="Location">{cityLine(d?.shipping_city, d?.shipping_state, d?.shipping_country)}</Field>
              )}
              <Field label="Role"><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${getRoleBadgeClasses((d?.role as UserRole) || 'customer')}`}>{getRoleName((d?.role as UserRole) || 'customer')}</span></Field>
              <Field label="Currency">{d?.price_currency === 'USD' ? 'USD' : 'CAD'}</Field>
              <Field label="Affiliate">{resolveAffiliateName(d?.affiliate_id, affById, custById)}</Field>
              <Field label="Sales person">{resolveSalesPersonName(d?.default_sales_person_id, spById)}</Field>
              <Field label="Status">{d?.active === false ? 'Inactive' : 'Active'}</Field>
              {d?.last_invoice_at && <Field label="Last invoice">{fmtDate(d.last_invoice_at)}</Field>}
              {d?.created_at && <Field label="Joined">{fmtDate(d.created_at)}</Field>}
            </div>
            <PanelLink href={`/admin/customers/${d?.id}/takeover`} label="Open customer" />
            <PanelLink href={`/admin/customers?q=${encodeURIComponent(d?.email ?? '')}`} label="Find in Customers" subtle />
          </>
        )}

        {node.kind === 'client' && (
          <>
            <div className="space-y-0">
              {(() => {
                const parent = custById.get(d?.customer_id);
                const pname = parent ? (fullName(parent.first_name, parent.last_name) || parent.email) : null;
                return (
                  <Field label="Customer">
                    {pname ? (
                      <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-ink-muted" />{pname}</span>
                    ) : '—'}
                  </Field>
                );
              })()}
              {d?.address && <Field label="Address">{d.address}</Field>}
              {cityLine(d?.city, d?.state, d?.country) && <Field label="Location">{cityLine(d?.city, d?.state, d?.country)}</Field>}
              {d?.email && <Field label="Email"><a href={`mailto:${d.email}`} className="hover:text-bronze break-all">{d.email}</a></Field>}
              {d?.phone && <Field label="Phone">{d.phone}</Field>}
              {d?.created_at && <Field label="Added">{fmtDate(d.created_at)}</Field>}
            </div>
            {custById.get(d?.customer_id) && (
              <PanelLink href={`/admin/customers/${d?.customer_id}/takeover`} label="Open parent customer" />
            )}
          </>
        )}

        {(node.kind === 'unassigned' || node.kind === 'unknown') && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <MiniStat label="Customers" value={fmtInt(node.customerCount ?? 0)} />
              <MiniStat label="Revenue" value={fmtMoney(node.revenue ?? 0)} />
            </div>
            <p className="text-xs text-ink-muted flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              {node.kind === 'unassigned'
                ? 'These customers are not attributed to any sales person or affiliate. Bind them from the invoice form or the Customers editor.'
                : 'The attribution id on these customers does not resolve to a current record.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function resolveAffiliateName(
  id: string | null | undefined,
  affById: Map<string, Affiliate>,
  custById: Map<string, Customer>,
) {
  if (!id) return <span className="text-ink-muted">—</span>;
  const a = affById.get(id);
  if (a) return fullName(a.first_name, a.last_name) || a.email || 'Affiliate';
  const c = custById.get(id);
  if (c) return fullName(c.first_name, c.last_name) || c.email || 'Affiliate';
  return <span className="text-ink-muted">Unknown</span>;
}

function resolveSalesPersonName(id: string | null | undefined, spById: Map<string, SalesPerson>) {
  if (!id) return <span className="text-ink-muted">—</span>;
  const s = spById.get(id);
  if (s) return fullName(s.first_name, s.last_name) || s.email || 'Sales person';
  return <span className="text-ink-muted">Unknown</span>;
}
