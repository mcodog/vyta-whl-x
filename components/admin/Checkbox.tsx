'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Check, Minus } from 'lucide-react';

/**
 * A custom checkbox that matches the admin design system (vital accent, rounded
 * square, soft focus ring) with a small framer-motion pop on the check mark.
 * Supports an indeterminate ("mixed") state for the header "select all" control.
 */
export default function Checkbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={`relative flex items-center justify-center w-[18px] h-[18px] rounded-[6px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vital/40 disabled:opacity-50 disabled:cursor-not-allowed ${
        on
          ? 'bg-vital border-vital'
          : 'bg-white border-line hover:border-vital/60'
      }`}
    >
      {on && (
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="text-white"
        >
          {indeterminate
            ? <Minus className="w-3 h-3" strokeWidth={3.5} />
            : <Check className="w-3 h-3" strokeWidth={3.5} />}
        </motion.span>
      )}
    </button>
  );
}
