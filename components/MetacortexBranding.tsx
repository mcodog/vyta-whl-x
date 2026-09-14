'use client';

import React from 'react';

interface MetacortexBrandingProps {
  size?: 'sm' | 'md';
  className?: string;
}

// Metacortex Logo - 2x2 grid of colored squares
function MetacortexLogo({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm'
    ? 'w-4 h-4 gap-0.5'
    : 'w-6 h-6 gap-1';

  const squareClasses = size === 'sm'
    ? 'w-1.5 h-1.5 rounded-sm'
    : 'w-2.5 h-2.5 rounded-sm';

  return (
    <div className={`grid grid-cols-2 ${sizeClasses}`}>
      <div className={`${squareClasses} bg-blue-500`}></div>
      <div className={`${squareClasses} bg-emerald-500`}></div>
      <div className={`${squareClasses} bg-yellow-400`}></div>
      <div className={`${squareClasses} bg-slate-500`}></div>
    </div>
  );
}

export default function MetacortexBranding({ size = 'sm', className = '' }: MetacortexBrandingProps) {
  return (
    <a
      href="https://metacortexdefi.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors ${className}`}
    >
      <MetacortexLogo size={size} />
      <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>
        Payments by <span className="font-medium">Metacortex</span>
      </span>
    </a>
  );
}

export { MetacortexLogo };
