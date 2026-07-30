/** Widget-parity toast (cs-toast + severity inset bar), auto-dismissing. */
import { useEffect, useRef } from 'react';

export type ToastKind = 'success' | 'info' | 'error' | 'warning';

export interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  /*
   * The countdown must depend on the toast IDENTITY only, never on the handler.
   *
   * Every caller passes an inline arrow (`onDismiss={() => setToast(null)}`), so `onDismiss` is a new
   * function on every parent render. With it in the deps the effect re-ran each time — clearing the
   * pending timeout and starting a fresh 3.5s one. A panel re-renders on every keystroke and every
   * background reload, so a toast raised just before a refresh (which is exactly when they are
   * raised: save → notify → reload) kept resetting and outstayed its 3.5s by seconds, and one raised
   * while someone was typing in a search box never left at all.
   *
   * Holding the handler in a ref keeps the latest callback without making it a dependency.
   */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const t = setTimeout(() => dismiss.current(), 3500);
    return () => clearTimeout(t);
  }, [toast.id]);

  return <div className={`cs-toast cs-toast-${toast.kind}`}>{toast.message}</div>;
}
