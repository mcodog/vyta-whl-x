'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Search, X, Check } from 'lucide-react';
import { rankBySearch } from '@/lib/search';

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface MultiSelectCustomerProps {
  customers: Customer[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

const getCustomerName = (customer: Customer) => {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
  return name || customer.email;
};

export default function MultiSelectCustomer({
  customers,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = 'Search customers...',
}: MultiSelectCustomerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // The input box we anchor the dropdown to. The dropdown itself is rendered
  // with `position: fixed` (see menuStyle) so it escapes any ancestor with
  // `overflow: hidden/auto` — e.g. a scrollable modal — instead of being
  // clipped by it.
  const triggerRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // Anchor the fixed-position dropdown to the trigger, flipping above it when
  // there isn't room below (and more room above).
  const updateMenuPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const MENU_MAX_H = 256; // matches max-h-64 below
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < MENU_MAX_H && r.top > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      left: r.left,
      width: r.width,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // While open, keep the dropdown pinned to the trigger as the page/modal
  // scrolls or resizes. Position is computed in a layout effect so it's set
  // before paint (no first-frame flash at the wrong spot).
  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    // Capture-phase so we also catch scrolls inside nested scroll containers.
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const filteredCustomers = rankBySearch(customers, searchQuery, [
    { value: (c) => c.first_name, weight: 3 },
    { value: (c) => c.last_name, weight: 3 },
    { value: (c) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), weight: 2 },
    { value: (c) => c.email, weight: 1 },
  ]);

  const selectedCustomers = customers.filter((c) => selectedIds.includes(c.id));

  const handleToggleCustomer = (customerId: string) => {
    if (selectedIds.includes(customerId)) {
      onChange(selectedIds.filter((id) => id !== customerId));
    } else {
      onChange([...selectedIds, customerId]);
    }
  };

  const handleSelectAll = () => {
    onChange(customers.map((c) => c.id));
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange([]);
  };

  const handleRemoveCustomer = (customerId: string) => {
    onChange(selectedIds.filter((id) => id !== customerId));
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Input Container with Chips */}
      <div
        ref={triggerRef}
        className={`min-h-[42px] w-full px-3 py-2 bg-surface border border-line rounded-lg focus-within:ring-2 focus-within:ring-bronze/40 focus-within:border-transparent ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'
        }`}
        onClick={() => !disabled && setIsOpen(true)}
      >
        <div className="flex flex-wrap gap-2 items-center">
          {/* Selected Customer Chips */}
          {selectedCustomers.map((customer) => (
            <div
              key={customer.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-bronze/10 text-bronze text-xs rounded-md"
            >
              <span className="font-medium">{getCustomerName(customer)}</span>
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveCustomer(customer.id);
                  }}
                  className="hover:bg-bronze/20 rounded transition-colors"
                  type="button"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          {/* Search Input */}
          <div className="flex-1 min-w-[120px] flex items-center">
            <Search className="w-4 h-4 text-ink-muted mr-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => !disabled && setIsOpen(true)}
              placeholder={selectedCustomers.length === 0 ? placeholder : ''}
              disabled={disabled}
              className="flex-1 bg-transparent outline-none text-ink text-sm placeholder-ink-muted disabled:cursor-not-allowed"
            />
          </div>

          {/* Clear Button */}
          {selectedCustomers.length > 0 && !disabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="text-ink-muted hover:text-ink transition-colors"
              type="button"
              title="Clear all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Dropdown — fixed-positioned so a scrollable/overflow-hidden ancestor
          (like a modal) can't clip it. */}
      {isOpen && !disabled && (
        <div
          style={menuStyle}
          className="z-[60] bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-hidden"
        >
          {/* Select All Button */}
          <div className="p-2 border-b border-line bg-surface">
            <button
              onClick={handleSelectAll}
              className="w-full px-3 py-2 text-xs font-medium text-ink hover:bg-bronze/10 rounded transition-colors text-left"
              type="button"
            >
              Select All ({customers.length})
            </button>
          </div>

          {/* Customer List */}
          <div className="overflow-y-auto max-h-48">
            {filteredCustomers.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-ink-muted">
                No customers found
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const isSelected = selectedIds.includes(customer.id);
                return (
                  <button
                    key={customer.id}
                    onClick={() => handleToggleCustomer(customer.id)}
                    className="w-full px-4 py-2.5 hover:bg-surface transition-colors text-left flex items-center justify-between group"
                    type="button"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {getCustomerName(customer)}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {customer.email}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-bronze flex-shrink-0 ml-2" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
