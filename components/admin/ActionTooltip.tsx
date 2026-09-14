'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * A lightweight hover/focus tooltip that renders a white, shadowed box (with a
 * little arrow) in a portal — animated in and out with framer-motion. Used to
 * replace the native `title` tooltips on the invoice row action buttons so they
 * match the site's styling instead of the browser's default.
 */
export default function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left + r.width / 2 });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex"
    >
      {children}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, -100%)',
              }}
              className="z-[70] pointer-events-none whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-lg ring-1 ring-line/60"
            >
              {label}
              <span className="absolute left-1/2 -bottom-[3px] -translate-x-1/2 w-1.5 h-1.5 rotate-45 bg-white border-b border-r border-line/60" />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
