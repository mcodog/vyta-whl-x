'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, MapPin } from 'lucide-react';

export interface ParsedAddress {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface Suggestion extends ParsedAddress {
  label: string;
}

interface Props {
  value: string;
  /** Fired as the user types the street field. */
  onChange: (street: string) => void;
  /** Fired when a suggestion is picked — fills the rest of the address. */
  onSelect: (address: ParsedAddress) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Street-address input with autocomplete backed by /api/shipping/address-
 * autocomplete (Photon/OSM). Degrades to a plain text input if the endpoint
 * returns nothing.
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  disabled,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const suppressRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Skip the fetch triggered by programmatically filling the field on select.
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/shipping/address-autocomplete?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!cancelled) {
          const results: Suggestion[] = data.results || [];
          setSuggestions(results);
          setOpen(results.length > 0);
          setActiveIdx(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choose = (s: Suggestion) => {
    suppressRef.current = true;
    onSelect({
      line1: s.line1,
      city: s.city,
      state: s.state,
      postalCode: s.postalCode,
      country: s.country,
    });
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        choose(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={className}
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
        </div>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-line rounded-xl shadow-lg max-h-64 overflow-auto py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-start gap-2 transition-colors ${
                  i === activeIdx ? 'bg-surface' : 'hover:bg-surface'
                }`}
              >
                <MapPin className="w-4 h-4 text-ink-muted flex-shrink-0 mt-0.5" />
                <span className="text-ink">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
