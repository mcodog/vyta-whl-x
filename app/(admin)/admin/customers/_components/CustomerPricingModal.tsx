'use client';

import React from 'react';
import { X } from 'lucide-react';
import CustomerPricingPanel from './CustomerPricingPanel';

interface Props {
  customer: any;
  onClose: () => void;
  onApplied?: () => void;
}

const customerName = (c: any) => {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return n || c.email;
};

export default function CustomerPricingModal({ customer, onClose, onApplied }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink truncate">Pricing · {customerName(customer)}</h2>
            <p className="text-xs text-ink-muted truncate">{customer.email}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5">
          <CustomerPricingPanel customer={customer} onApplied={onApplied} variant="card" />
        </div>
      </div>
    </div>
  );
}
