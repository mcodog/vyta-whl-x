'use client';

import React, { useId } from 'react';

/**
 * VYTA Biosciences logo lockup.
 * ---------------------------------------------------------------------------
 * The mark is the brand's V: a navy blade on the left, a Bio Teal leaf rising
 * on the right, and the vitality dot in the gap between them. The wordmark is
 * drawn as geometry rather than typeset, per the guidelines ("logo wordmark is
 * custom artwork — do not typeset it"); only the BIOSCIENCES sub-line is set.
 *
 * Everything the storefront, the portals, the emails and the PDFs show as the
 * VYTA logo comes through here, so swapping in official artwork later is a
 * one-file change.
 *
 * Sizing follows the guidelines: 32px minimum for the icon, 160px minimum for
 * the full lockup. `tone="light"` is the reversed lockup for navy grounds.
 */

export type VytaTone = 'color' | 'light' | 'mono';

const NAVY = '#07203A';
const OCEAN = '#0E3F5F';
const VITAL_BLUE = '#1B5D83';
const BIO_TEAL = '#438B9E';
const AQUA = '#6EB2B8';
const MIST = '#BBD6D6';

/** Wordmark / sub-line ink for each tone. */
function wordmarkInk(tone: VytaTone): { word: string; sub: string } {
  if (tone === 'light') return { word: '#FFFFFF', sub: 'rgba(255,255,255,0.62)' };
  if (tone === 'mono') return { word: 'currentColor', sub: 'currentColor' };
  return { word: NAVY, sub: BIO_TEAL };
}

/**
 * The icon on its own. Square, and safe down to the 32px minimum: the blade,
 * leaf and dot all stay legible because none of them relies on a hairline.
 */
export function VytaMark({
  size = 40,
  tone = 'color',
  className = '',
  title,
}: {
  size?: number;
  tone?: VytaTone;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const bladeId = `vyta-blade-${uid}`;
  const leafId = `vyta-leaf-${uid}`;
  const dotId = `vyta-dot-${uid}`;

  // Reversed and single-colour lockups drop the gradients: on a navy ground the
  // navy blade would disappear, so the blade lifts to Mist/white and the leaf
  // keeps the Aqua end of the ramp for separation.
  const blade = tone === 'color' ? `url(#${bladeId})` : tone === 'light' ? '#FFFFFF' : 'currentColor';
  const leaf = tone === 'color' ? `url(#${leafId})` : tone === 'light' ? AQUA : 'currentColor';
  const dot = tone === 'color' ? `url(#${dotId})` : tone === 'light' ? MIST : 'currentColor';
  const veinOpacity = tone === 'color' ? 0.55 : 0.3;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 112 112"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {tone === 'color' && (
        <defs>
          <linearGradient id={bladeId} x1="8%" y1="0%" x2="95%" y2="88%">
            <stop offset="0%" stopColor={NAVY} />
            <stop offset="52%" stopColor={VITAL_BLUE} />
            <stop offset="100%" stopColor={OCEAN} />
          </linearGradient>
          <linearGradient id={leafId} x1="15%" y1="100%" x2="88%" y2="0%">
            <stop offset="0%" stopColor={OCEAN} />
            <stop offset="45%" stopColor={BIO_TEAL} />
            <stop offset="100%" stopColor={AQUA} />
          </linearGradient>
          <linearGradient id={dotId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={AQUA} />
            <stop offset="100%" stopColor={BIO_TEAL} />
          </linearGradient>
        </defs>
      )}

      {/* Left blade — the V's descending stroke: a broad shoulder at the top
          tapering to the vertex the leaf also meets. */}
      <path
        d="M4 26 C4 52 25 84 53 105 C49 78 46 52 48 30 C37 13 11 16 4 26 Z"
        fill={blade}
      />

      {/* Right leaf — vitality rising out of that same vertex. */}
      <path
        d="M100 5 C107 47 88 85 57 106 C54 62 71 24 100 5 Z"
        fill={leaf}
      />
      {/* Leaf vein: the light sweep that keeps the leaf from reading as a slab. */}
      <path
        d="M92 19 C78 46 65 79 60 100"
        stroke="#FFFFFF"
        strokeOpacity={veinOpacity}
        strokeWidth="2.9"
        strokeLinecap="round"
        fill="none"
      />

      {/* The vitality dot, held in the open gap between blade and leaf. */}
      <circle cx="58" cy="43" r="7.5" fill={dot} />
    </svg>
  );
}

/**
 * The VYTA wordmark, drawn as geometry. The A is a bare apex (no crossbar) and
 * the letters are widely tracked, matching the brand artwork.
 */
export function VytaWordmark({
  height = 26,
  tone = 'color',
  withSubline = true,
  className = '',
}: {
  height?: number;
  tone?: VytaTone;
  withSubline?: boolean;
  className?: string;
}) {
  const { word, sub } = wordmarkInk(tone);
  // The sub-line adds roughly a third again to the lockup height.
  const viewH = withSubline ? 74 : 54;
  const width = (height / viewH) * 200;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 200 ${viewH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g
        stroke={word}
        strokeWidth="3.4"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
      >
        {/* V */}
        <path d="M10 9 L26 45 L42 9" />
        {/* Y */}
        <path d="M62 9 L76 29 L90 9" />
        <path d="M76 29 L76 45" />
        {/* T */}
        <path d="M106 9 L142 9" />
        <path d="M124 9 L124 45" />
        {/* A — bare apex, no crossbar */}
        <path d="M158 45 L174 9 L190 45" />
      </g>
      {withSubline && (
        <text
          x="100"
          y="68"
          textAnchor="middle"
          fill={sub}
          fontSize="11"
          letterSpacing="5.4"
          fontFamily="var(--font-inter), Inter, system-ui, sans-serif"
          fontWeight="500"
        >
          BIOSCIENCES
        </text>
      )}
    </svg>
  );
}

/**
 * The full lockup. `horizontal` is the nav/header form, `stacked` the hero and
 * loading-screen form. Clear space is baked in as a gap of half the icon width.
 */
export default function VytaLogo({
  variant = 'horizontal',
  size = 40,
  tone = 'color',
  withSubline = true,
  className = '',
}: {
  variant?: 'horizontal' | 'stacked' | 'mark' | 'wordmark';
  /** Icon height in px; the wordmark is scaled from it. */
  size?: number;
  tone?: VytaTone;
  withSubline?: boolean;
  className?: string;
}) {
  if (variant === 'mark') {
    return <VytaMark size={size} tone={tone} className={className} title="VYTA Biosciences" />;
  }
  if (variant === 'wordmark') {
    return (
      <span className={`inline-flex items-center ${className}`} role="img" aria-label="VYTA Biosciences">
        <VytaWordmark height={size * 0.7} tone={tone} withSubline={withSubline} />
      </span>
    );
  }
  if (variant === 'stacked') {
    return (
      <span
        className={`inline-flex flex-col items-center ${className}`}
        role="img"
        aria-label="VYTA Biosciences"
        style={{ gap: size * 0.28 }}
      >
        <VytaMark size={size} tone={tone} />
        <VytaWordmark height={size * 0.62} tone={tone} withSubline={withSubline} />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center ${className}`}
      role="img"
      aria-label="VYTA Biosciences"
      style={{ gap: size * 0.32 }}
    >
      <VytaMark size={size} tone={tone} />
      <VytaWordmark height={size * (withSubline ? 0.72 : 0.46)} tone={tone} withSubline={withSubline} />
    </span>
  );
}
