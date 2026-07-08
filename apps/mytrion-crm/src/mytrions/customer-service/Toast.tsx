import { useEffect } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-good/30 bg-good/10 text-good',
  info: 'border-primary/30 bg-primary/10 text-primary',
  error: 'border-bad/30 bg-bad/10 text-bad',
};

const KIND_ICON: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  error: XCircle,
};

/** Self-contained toast for read-only-preview notices ("Edit Application", "Add Client", etc). */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const Icon = KIND_ICON[toast.kind];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-xs border px-4 py-2.5 text-sm font-semibold shadow-lg',
          KIND_CLASS[toast.kind],
        )}
      >
        <Icon className="size-4 flex-none" />
        {toast.message}
      </div>
    </div>
  );
}
