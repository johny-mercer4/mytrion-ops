/** Widget-parity toast (cs-toast + severity inset bar), auto-dismissing. */
import { useEffect } from 'react';

export type ToastKind = 'success' | 'info' | 'error' | 'warning';

export interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return <div className={`cs-toast cs-toast-${toast.kind}`}>{toast.message}</div>;
}
