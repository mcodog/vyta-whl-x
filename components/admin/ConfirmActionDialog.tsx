'use client';

import React from 'react';
import { X, AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';

type Tone = 'default' | 'warning';

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Icon shown on the confirm button. */
  icon?: LucideIcon;
  /** Colour treatment of the confirm button. `warning` = amber, else ink. */
  tone?: Tone;
  loading?: boolean;
  /** Disables the confirm button (e.g. nothing eligible to act on). */
  confirmDisabled?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

const CONFIRM_CLASSES: Record<Tone, string> = {
  default: 'bg-ink text-white hover:bg-ink/90',
  warning: 'bg-amber-500/10 border border-amber-500/20 text-amber-600 hover:bg-amber-500/20',
};

/**
 * Generic (non-destructive) confirmation modal for bulk admin actions such as
 * creating shipment records or buying labels. Mirrors ConfirmDeleteDialog's
 * layout but with a neutral/amber tone and a caller-supplied body.
 */
export default function ConfirmActionDialog({
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  icon: Icon,
  tone = 'default',
  loading = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="text-sm text-ink-muted mb-5">{message}</div>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              className={`inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${CONFIRM_CLASSES[tone]}`}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                Icon && <Icon className="w-4 h-4" />
              )}
              {confirmLabel}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
