import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-good/30 bg-good/12 text-good',
  info: 'border-primary/30 bg-primary/12 text-primary',
  error: 'border-bad/30 bg-bad/12 text-bad',
};

const KIND_ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  error: XCircle,
};

/** Local toast queue — this app has no global toast library; each Mytrion tab that needs
 * transient feedback (advance/claim/mark-read confirmations) owns its own queue. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = KIND_ICON[toast.kind];
  return (
    <button
      type="button"
      onClick={() => onDismiss(toast.id)}
      className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-sm ${KIND_CLASS[toast.kind]}`}
    >
      <Icon className="size-3.5 flex-none" />
      {toast.message}
    </button>
  );
}
