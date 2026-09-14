'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Shown while a request is still loading but has crossed the "slow" threshold.
 * Gives the user a way to manually retry instead of staring at a skeleton.
 */
export function SlowLoadingNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4 px-4 py-3 bg-vital/10 border border-vital/20 rounded-xl text-sm text-ink">
      <RefreshCw className="w-4 h-4 text-vital animate-spin" />
      <span className="text-ink-muted">This is taking a while.</span>
      <button
        onClick={onReload}
        className="font-semibold text-vital hover:text-ink underline-offset-2 hover:underline transition-colors"
      >
        Click here to reload
      </button>
    </div>
  );
}

/**
 * Shown when a request fails. Surfaces a friendly message plus a retry button.
 */
export function LoadingError({
  onRetry,
  className = '',
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-12 px-4 text-center ${className}`}
    >
      <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-500" />
      </div>
      <p className="text-sm font-medium text-ink">Please try again later</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-all"
      >
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}
