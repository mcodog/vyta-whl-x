'use client';

import React, { useState } from 'react';

type NativeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>;

interface NumberInputProps extends NativeInputProps {
  /** Current numeric value, or `null`/`undefined` for an empty field. */
  value: number | null | undefined;
  /** Called with the parsed number, or `null` when the field is cleared. */
  onChange: (value: number | null) => void;
}

/**
 * A `type="number"` input that can be genuinely empty.
 *
 * Plain controlled number inputs bound to a numeric state always render a
 * value (typically `0`), so the field can never be blank and the leading zero
 * can't be deleted. This wrapper represents "no value" as `null`: an empty
 * field reports `null`, and a `null`/`undefined` value renders as blank.
 *
 * While focused it keeps the user's raw text so partial input like `1.` or a
 * momentarily-empty field survives re-renders (a plain `value={value}` binding
 * would otherwise strip the trailing dot or snap an empty field back to a
 * number).
 */
export default function NumberInput({ value, onChange, ...rest }: NumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const numericText = value == null || Number.isNaN(value) ? '' : String(value);
  const display = focused ? draft : numericText;

  return (
    <input
      {...rest}
      type="number"
      value={display}
      onFocus={(e) => {
        setDraft(numericText);
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '') {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
    />
  );
}
