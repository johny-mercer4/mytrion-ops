/**
 * Admin-wide transient toasts. Module-level pub/sub so panels deep in the tree can notify without
 * prop drilling; <AdminToastHost /> renders the stack once at the Admin root.
 *
 * Ported from scope/toast.tsx rather than reused: that stack is `position: absolute` inside the
 * scope's own positioned root and is styled with scope-local CSS variables, so neither its
 * placement nor its colours survive outside it.
 */
import { useEffect, useState } from 'react';
import s from './toast.module.css';

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

export const adminToast = {
  success: (title: string, message?: string, duration?: number) => show('success', title, message, duration),
  error: (title: string, message?: string, duration?: number) => show('error', title, message, duration),
  warning: (title: string, message?: string, duration?: number) => show('warning', title, message, duration),
  info: (title: string, message?: string, duration?: number) => show('info', title, message, duration),
};

const TOAST_ICON: Record<ToastType, string> = {
  success: 'M5 13l4 4L19 7',
  error: 'M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z',
  warning: 'M12 8v5m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

const TOAST_CLASS: Record<ToastType, string> = {
  success: s.success,
  error: s.error,
  warning: s.warning,
  info: s.info,
};

/** Oldest toasts fall off, so a burst of failures can't wall off the corner of the screen. */
const MAX_VISIBLE = 4;

export function AdminToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const onToast: Listener = (t) => {
      setToasts((prev) => [...prev, t].slice(-MAX_VISIBLE));
      timers.set(
        t.id,
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
          timers.delete(t.id);
        }, t.duration),
      );
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      timers.forEach((h) => clearTimeout(h));
    };
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  // The region renders even with nothing in it, rather than mounting on the first toast: a live
  // region that enters the DOM already holding its text is typically never announced at all.
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${s.toast} ${TOAST_CLASS[t.type]}`}>
          <span className={s.icon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d={TOAST_ICON[t.type]} />
            </svg>
          </span>
          <div className={s.body}>
            <div className={s.title}>{t.title}</div>
            {t.message ? <div className={s.msg}>{t.message}</div> : null}
          </div>
          <button type="button" className={s.close} aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
