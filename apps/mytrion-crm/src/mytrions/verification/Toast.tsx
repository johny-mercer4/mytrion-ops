import { useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastState {
  kind: ToastKind;
  title: string;
  message?: string;
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-good/30 bg-good/10 text-good',
  info: 'border-primary/30 bg-primary/10 text-primary',
  error: 'border-bad/30 bg-bad/10 text-bad',
};

const KIND_ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  error: AlertCircle,
};

/** Minimal local toast — no shared toast lib exists in this app yet (checked: no sonner/react-hot-toast). */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  function show(kind: ToastKind, title: string, message?: string) {
    setToast(message === undefined ? { kind, title } : { kind, title, message });
    window.setTimeout(() => setToast(null), 3200);
  }

  return { toast, show };
}

export function ToastViewport({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  const Icon = KIND_ICON[toast.kind];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xs border bg-card px-4 py-3 shadow-lg ${KIND_CLASS[toast.kind]}`}>
        <Icon className="mt-0.5 size-4 flex-none" />
        <div>
          <div className="text-sm font-semibold text-foreground">{toast.title}</div>
          {toast.message ? <div className="text-xs text-muted-foreground">{toast.message}</div> : null}
        </div>
      </div>
    </div>
  );
}
