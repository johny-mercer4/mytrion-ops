/**
 * Octane Scope — transient toast notifications (port of the widget's asToast).
 * Module-level pub/sub so deep components (risk CRUD) can notify without prop
 * drilling; <ScopeToastHost /> renders the stack inside the scope root.
 */
import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  message?: string | undefined;
  duration: number;
}

type Listener = (t: ToastItem) => void;

let seq = 0;
const listeners = new Set<Listener>();

function show(type: ToastType, title: string, message?: string, duration?: number): void {
  const item: ToastItem = {
    id: ++seq,
    type,
    title,
    message: message || undefined,
    duration: duration ?? (type === 'error' ? 6000 : 4000),
  };
  listeners.forEach((l) => l(item));
}

export const scopeToast = {
  success: (title: string, message?: string) => show('success', title, message),
  error: (title: string, message?: string) => show('error', title, message),
  warning: (title: string, message?: string) => show('warning', title, message),
  info: (title: string, message?: string) => show('info', title, message),
};

const TOAST_ICON: Record<ToastType, string> = {
  success: 'M5 13l4 4L19 7',
  error: 'M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z',
  warning: 'M12 8v5m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

export function ScopeToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const onToast: Listener = (t) => {
      setToasts((prev) => [...prev, t]);
      timers.set(
        t.id,
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), t.duration),
      );
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      timers.forEach((h) => clearTimeout(h));
    };
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  if (!toasts.length) return null;
  return (
    <div className="oct-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`oct-toast oct-toast--${t.type}`} role="status">
          <span className="oct-toast__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d={TOAST_ICON[t.type]} />
            </svg>
          </span>
          <div className="oct-toast__body">
            <div className="oct-toast__title">{t.title}</div>
            {t.message ? <div className="oct-toast__msg">{t.message}</div> : null}
          </div>
          <button
            type="button"
            className="oct-toast__close"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
