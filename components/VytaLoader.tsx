'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { VytaMark } from './VytaLogo';

interface VytaLoaderProps {
  /**
   * Wordmark shown above the trace. Defaults to the internal-panel brand so it
   * reads the same as the admin sidebar.
   */
  brand?: string;
  /** Small uppercase caption under the wordmark, e.g. "Admin Panel". */
  label?: string;
  /** Optional status line, e.g. "Verifying access". A live ellipsis is appended. */
  message?: string;
}

// The house "one clean peak" HPLC purity trace, scaled to a 240×96 viewBox:
// a flat baseline with a couple of faint solvent blips and one sharp, symmetric
// peak right-of-centre — the visual shorthand for a 99%+ purity result and the
// same signature used in the marketing LabResultsShowcase. Drawing it live is
// the loading metaphor: the panel is "running the sample".
const TRACE_D =
  'M 0 72 L 44 72 L 52 67 L 60 72 L 108 72 C 124 72 128 18 140 18 ' +
  'C 152 18 156 72 172 72 L 200 72 L 208 67 L 216 72 L 240 72';

// Faint instrument grid behind the trace.
const V_GRID = [48, 96, 144, 192];
const H_GRID = [24, 48];

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

export default function VytaLoader({
  brand = 'VYTA',
  label = 'Admin Panel',
  message,
}: VytaLoaderProps) {
  const reduce = useReducedMotion();

  // One shared draw/hold/fade cycle so the trace, glow and scan line stay in
  // lockstep. Static (fully drawn, no fade) under reduced motion.
  const traceTransition = reduce
    ? undefined
    : {
        duration: 2.6,
        times: [0, 0.72, 1],
        ease: EASE,
        repeat: Infinity,
        repeatDelay: 0.2,
      };
  const drawAnim = reduce
    ? { pathLength: 1, opacity: 1 }
    : { pathLength: [0, 1, 1], opacity: [1, 1, 0] };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      role="status"
      aria-live="polite"
      className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-white px-6"
    >
      {/* Soft vital halo so the white panel still feels branded. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 42%, rgba(67, 139, 158, 0.08), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* The mark, then the wordmark with an aqua light-sweep across it. */}
        <VytaMark size={56} className="mb-5" />
        <div className="font-display text-2xl sm:text-3xl font-semibold tracking-[0.3em] select-none pl-[0.3em]">
          <span className="animate-vyta-shimmer">{brand}</span>
        </div>

        {/* Purity-scan chromatogram. */}
        <svg
          viewBox="0 0 240 96"
          className="mt-6 w-[220px] sm:w-[264px] h-auto"
          fill="none"
          aria-hidden="true"
        >
          {/* Instrument grid */}
          {V_GRID.map((x) => (
            <line
              key={`v${x}`}
              x1={x}
              y1={8}
              x2={x}
              y2={84}
              stroke="#07203A"
              strokeOpacity={0.05}
              strokeWidth={1}
            />
          ))}
          {H_GRID.map((y) => (
            <line
              key={`h${y}`}
              x1={0}
              y1={y}
              x2={240}
              y2={y}
              stroke="#07203A"
              strokeOpacity={0.05}
              strokeWidth={1}
            />
          ))}
          {/* Baseline */}
          <line x1={0} y1={72} x2={240} y2={72} stroke="#07203A" strokeOpacity={0.12} strokeWidth={1} />

          {/* Blurred vital underglow */}
          <motion.path
            d={TRACE_D}
            stroke="#6EB2B8"
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="blur-[3px]"
            initial={{ pathLength: 0, opacity: reduce ? 0.35 : 0 }}
            animate={reduce ? { pathLength: 1, opacity: 0.35 } : { pathLength: [0, 1, 1], opacity: [0.45, 0.45, 0] }}
            transition={traceTransition}
          />
          {/* Crisp vital trace */}
          <motion.path
            d={TRACE_D}
            stroke="#438B9E"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: reduce ? 1 : 0 }}
            animate={drawAnim}
            transition={traceTransition}
          />
          {/* Scan head sweeping in step with the pen. */}
          {!reduce && (
            <motion.line
              x1={0}
              y1={8}
              x2={0}
              y2={84}
              stroke="#438B9E"
              strokeWidth={1.5}
              strokeOpacity={0.5}
              initial={{ x: 0, opacity: 0 }}
              animate={{ x: [0, 240, 240], opacity: [0.5, 0.5, 0] }}
              transition={traceTransition}
            />
          )}
        </svg>

        {/* Caption */}
        {label && (
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-vital">
            {label}
          </p>
        )}

        {/* Status line with a live ellipsis. */}
        {message && (
          <p className="mt-2 flex items-center text-sm text-ink-muted">
            {message}
            <span aria-hidden="true" className="ml-0.5 inline-flex">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={reduce ? undefined : { opacity: [0.2, 1, 0.2] }}
                  transition={
                    reduce
                      ? undefined
                      : { duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }
                  }
                >
                  .
                </motion.span>
              ))}
            </span>
          </p>
        )}

        {/* Screen-reader announcement (the visuals above are decorative). */}
        <span className="sr-only">Loading {label || brand}</span>
      </div>
    </motion.div>
  );
}
