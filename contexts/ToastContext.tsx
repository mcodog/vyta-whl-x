'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, Loader2, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';
export type ToastPosition = 'top' | 'bottom';

/** An optional inline action button (e.g. "Undo") rendered inside the toast. */
export interface ToastAction {
  label: string;
  /** Invoked when the action is clicked. The toast dismisses afterwards. */
  onClick: () => void;
}

export interface ToastOptions {
  /** Corner the toast anchors to. Defaults to top-right. */
  position?: ToastPosition;
  /** Auto-dismiss delay in ms, or null to keep it until updated/dismissed. */
  duration?: number | null;
  /** Optional action button (e.g. an Undo) shown before the dismiss control. */
  action?: ToastAction;
}

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  position: ToastPosition;
  action?: ToastAction;
}

interface ToastContextType {
  /** Show a toast. Defaults to the "error" style. */
  showToast: (message: string, type?: ToastType, opts?: ToastOptions) => number;
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  /**
   * Show a sticky spinner toast (bottom-right by default) and return its id.
   * Pass that id to `update` to morph it into a success/error once done.
   */
  loading: (message: string, opts?: ToastOptions) => number;
  /** Morph an existing toast's message/type in place. */
  update: (id: number, message: string, type: ToastType, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION = 4500;

const variants: Record<
  ToastType,
  { icon: React.ReactNode; ring: string; iconColor: string }
> = {
  success: {
    icon: <CheckCircle className="w-5 h-5" />,
    ring: 'border-green-200',
    iconColor: 'text-green-600',
  },
  error: {
    icon: <AlertCircle className="w-5 h-5" />,
    ring: 'border-red-200',
    iconColor: 'text-red-500',
  },
  info: {
    icon: <Info className="w-5 h-5" />,
    ring: 'border-line',
    iconColor: 'text-bronze',
  },
  loading: {
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    ring: 'border-line',
    iconColor: 'text-bronze',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = (id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  };

  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Start (or restart) the auto-dismiss timer unless the toast is sticky.
  const armDismiss = useCallback(
    (id: number, type: ToastType, duration?: number | null) => {
      clearTimer(id);
      const sticky = type === 'loading' || duration === null;
      if (sticky) return;
      const t = setTimeout(() => dismiss(id), duration ?? DEFAULT_DURATION);
      timers.current.set(id, t);
    },
    [dismiss],
  );

  const showToast = useCallback(
    (message: string, type: ToastType = 'error', opts?: ToastOptions) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev,
        { id, message, type, position: opts?.position ?? 'top', action: opts?.action },
      ]);
      armDismiss(id, type, opts?.duration);
      return id;
    },
    [armDismiss],
  );

  const success = useCallback(
    (message: string, opts?: ToastOptions) => showToast(message, 'success', opts),
    [showToast],
  );
  const error = useCallback(
    (message: string, opts?: ToastOptions) => showToast(message, 'error', opts),
    [showToast],
  );
  const info = useCallback(
    (message: string, opts?: ToastOptions) => showToast(message, 'info', opts),
    [showToast],
  );

  const loading = useCallback(
    (message: string, opts?: ToastOptions) =>
      showToast(message, 'loading', { position: 'bottom', ...opts, duration: null }),
    [showToast],
  );

  const update = useCallback(
    (id: number, message: string, type: ToastType, opts?: ToastOptions) => {
      setToasts((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                message,
                type,
                position: opts?.position ?? t.position,
                // Only replace the action when the caller supplies opts; passing
                // opts without `action` clears any prior action.
                action: opts ? opts.action : t.action,
              }
            : t,
        ),
      );
      armDismiss(id, type, opts?.duration);
    },
    [armDismiss],
  );

  const renderToast = (toast: Toast) => {
    const v = variants[toast.type];
    const fromY = toast.position === 'bottom' ? 16 : -16;
    const exitY = toast.position === 'bottom' ? 8 : -8;
    return (
      <motion.div
        key={toast.id}
        layout
        initial={{ opacity: 0, y: fromY, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: exitY, scale: 0.96 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className={`pointer-events-auto w-full sm:w-auto sm:min-w-[300px] sm:max-w-md bg-white rounded-xl border ${v.ring} shadow-lg px-4 py-3 flex items-start gap-3`}
        role="alert"
      >
        <span className={`flex-shrink-0 mt-0.5 ${v.iconColor}`}>{v.icon}</span>
        <p className="flex-1 text-sm text-ink leading-snug">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              dismiss(toast.id);
            }}
            className="flex-shrink-0 text-sm font-semibold text-bronze hover:text-bronze/80 transition-colors -my-0.5 px-2 py-0.5 rounded-md hover:bg-bronze/10"
          >
            {toast.action.label}
          </button>
        )}
        <button
          onClick={() => dismiss(toast.id)}
          className="flex-shrink-0 text-ink-muted hover:text-ink transition-colors -mr-1"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    );
  };

  const topToasts = toasts.filter((t) => t.position === 'top');
  const bottomToasts = toasts.filter((t) => t.position === 'bottom');

  return (
    <ToastContext.Provider
      value={{ showToast, success, error, info, loading, update, dismiss }}
    >
      {children}
      {/* Top-right stack (default) */}
      <div className="fixed top-4 inset-x-0 sm:inset-x-auto sm:right-4 z-[100] flex flex-col items-center sm:items-end gap-2 px-4 sm:px-0 pointer-events-none">
        <AnimatePresence initial={false}>{topToasts.map(renderToast)}</AnimatePresence>
      </div>
      {/* Bottom-right stack (progress / loading toasts) */}
      <div className="fixed bottom-4 inset-x-0 sm:inset-x-auto sm:right-4 z-[100] flex flex-col items-center sm:items-end gap-2 px-4 sm:px-0 pointer-events-none">
        <AnimatePresence initial={false}>{bottomToasts.map(renderToast)}</AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
