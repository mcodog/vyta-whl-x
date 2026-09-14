'use client';

import React from 'react';
import { DollarSign, Plus, Minus } from 'lucide-react';

interface NumericStepperProps {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Ref to the underlying text input — used for keyboard focus navigation. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Extra key handler on the input (e.g. arrow-key row navigation). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export default function NumericStepper({
  value,
  onChange,
  min = 0,
  step = 1,
  placeholder = '0.00',
  disabled = false,
  inputRef,
  onKeyDown,
}: NumericStepperProps) {
  const handleIncrement = () => {
    const currentValue = parseFloat(value) || 0;
    const newValue = currentValue + step;
    onChange(newValue.toFixed(2));
  };

  const handleDecrement = () => {
    const currentValue = parseFloat(value) || 0;
    const newValue = Math.max(min, currentValue - step);
    onChange(newValue.toFixed(2));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Allow empty string or valid numbers (including decimal input)
    if (inputValue === '' || /^\d*\.?\d*$/.test(inputValue)) {
      onChange(inputValue);
    }
  };

  const handleBlur = () => {
    // Format to 2 decimal places on blur if valid
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      onChange(Math.max(min, numValue).toFixed(2));
    } else if (value === '') {
      // Keep empty if user clears the field
      onChange('');
    }
  };

  return (
    <div className="relative flex items-center">
      {/* Decrement Button */}
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || parseFloat(value) <= min}
        className="px-3 py-2.5 bg-surface border border-line border-r-0 rounded-l-lg hover:bg-line/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-ink-muted hover:text-ink"
        title="Decrease by 1"
      >
        <Minus className="w-4 h-4" />
      </button>

      {/* Input Field */}
      <div className="relative flex-1">
        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-10 pr-4 py-2.5 bg-surface border-y border-line focus:outline-none focus:ring-2 focus:ring-vital/40 focus:z-10 text-ink text-sm disabled:opacity-50 disabled:cursor-not-allowed text-center font-semibold tabular-nums"
        />
      </div>

      {/* Increment Button */}
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled}
        className="px-3 py-2.5 bg-surface border border-line border-l-0 rounded-r-lg hover:bg-line/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-ink-muted hover:text-ink"
        title="Increase by 1"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
