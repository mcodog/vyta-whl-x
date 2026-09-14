'use client';

import React from 'react';
import { Truck, Store, CheckCircle2, Clock, Sparkles, Tag, Tags, Users, CheckSquare, Square, Globe } from 'lucide-react';
import { type QueueItem, statusLabel, isComplete, timeAgo } from '@/lib/warehouse/api';
import { sourceLabel, sourceBadgeClasses, STEALTH_HEALTH_MISSING_INFO_TOOLTIP } from '@/lib/orderSource';

interface Props {
  item: QueueItem;
  selected: boolean;
  isNew: boolean;
  onSelect: (id: string) => void;
  /** Whether this row is ticked for a bulk action. */
  checked: boolean;
  /** Toggle this row's bulk-selection checkbox. */
  onToggleCheck: (id: string) => void;
}

export default function QueueRow({ item, selected, isNew, onSelect, checked, onToggleCheck }: Props) {
  const isShipment = item.fulfillment_type === 'shipment';
  const done = isComplete(item.fulfillment_status);

  return (
    <div className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={() => onToggleCheck(item.id)}
        aria-label={checked ? 'Deselect order' : 'Select order'}
        aria-pressed={checked}
        className={`shrink-0 flex items-center justify-center px-1 rounded-md transition-colors ${
          checked ? 'text-indigo-600' : 'text-line hover:text-ink-muted'
        }`}
      >
        {checked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className={`flex-1 min-w-0 text-left rounded-lg border px-3 py-2.5 transition-colors ${
          selected
            ? 'border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-300'
            : checked
              ? 'border-indigo-300 bg-indigo-50/40'
              : isNew
                ? 'border-emerald-300 bg-emerald-50/60 hover:border-emerald-400'
                : 'border-line bg-white hover:border-ink/20'
        } ${done ? 'opacity-60' : ''}`}
      >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${
            isShipment ? 'bg-blue-500/10 text-blue-600' : 'bg-amber-500/10 text-amber-700'
          }`}
          title={isShipment ? 'Shipment' : 'Self-Pickup'}
        >
          {isShipment ? <Truck className="w-3.5 h-3.5" /> : <Store className="w-3.5 h-3.5" />}
        </span>
        <span className="font-mono text-xs font-semibold text-ink truncate">
          {item.invoice_number ? item.invoice_number : item.order_number || 'No invoice #'}
        </span>
        {item.status === 'draft' && (
          <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 shrink-0">
            Draft
          </span>
        )}
        {item.removed_from_queue && (
          <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-400/20 text-ink-muted shrink-0">
            Removed
          </span>
        )}
        {isNew && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500 text-white shrink-0">
            <Sparkles className="w-2.5 h-2.5" /> New
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-muted shrink-0">
          <Clock className="w-3 h-3" /> {timeAgo(item.created_at)}
        </span>
      </div>

      {/* Customer name gets its own line so it never fights the badges for
          width on the narrow queue column. */}
      <div className="mt-1 text-sm text-ink truncate">{item.customer_name || 'Guest'}</div>

      {/* Badges wrap onto their own row underneath. */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {item.source === 'stealth_health' && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sourceBadgeClasses(item.source)}`}
            title={STEALTH_HEALTH_MISSING_INFO_TOOLTIP}
          >
            <Globe className="w-2.5 h-2.5" /> {sourceLabel(item.source)}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            item.with_labels ? 'bg-vital/10 text-vital' : 'bg-ink/5 text-ink-muted'
          }`}
          title={
            item.with_labels
              ? 'Ships with product labels on the vials'
              : 'Ships without product labels'
          }
        >
          <Tags className="w-2.5 h-2.5" /> {item.with_labels ? 'Labeled' : 'Unlabeled'}
        </span>
        {item.ships_to_client && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              item.packing_list_emailed_at
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-indigo-500/10 text-indigo-600'
            }`}
            title={
              item.packing_list_emailed_at
                ? 'Packing list sent to client'
                : 'Ships to client — packing list not sent yet'
            }
          >
            <Users className="w-2.5 h-2.5" /> {item.packing_list_emailed_at ? 'List sent' : 'Client'}
          </span>
        )}
        {isShipment && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              item.has_label ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'
            }`}
            title={item.has_label ? 'Shipping label ready' : 'No shipping label yet'}
          >
            <Tag className="w-2.5 h-2.5" /> {item.has_label ? 'Ship label' : 'No ship label'}
          </span>
        )}
        <span
          className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
            done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-indigo-500/10 text-indigo-600'
          }`}
        >
          {done && <CheckCircle2 className="w-3 h-3" />}
          {statusLabel(item.fulfillment_status)}
        </span>
      </div>
      </button>
    </div>
  );
}
