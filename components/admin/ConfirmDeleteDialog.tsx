'use client';

import React from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Generic destructive-action confirmation modal. Used for single and bulk
 * deletes across the admin tables (orders, invoices).
 */
export default function ConfirmDeleteDialog({
  title,
  message,
  confirmLabel = 'Delete Permanently',
  loading = false,
  error,
  onConfirm,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm max-h-[90vh] overflow-y-auto">
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
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {loading ? 'Deleting…' : confirmLabel}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink hover:bg-line/20 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
