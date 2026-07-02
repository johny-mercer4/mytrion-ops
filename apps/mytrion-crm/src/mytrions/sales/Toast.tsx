import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

// Minimal in-module toast provider — no shared toast system exists yet in this
// app (see billing/ for reference; it doesn't use toasts). Sales needs one
// heavily (Automations run-action, Create forms, Carriers/DataCenter quick
// actions), so it's scoped locally rather than added to shared components.

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_META: Record<ToastKind, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-good/30 bg-good/12 text-good' },
  info: { icon: Info, className: 'border-primary/30 bg-primary/12 text-primary' },
  warning: { icon: AlertTriangle, className: 'border-warn/30 bg-warn/12 text-warn' },
  error: { icon: XCircle, className: 'border-bad/30 bg-bad/12 text-bad' },
};

let idSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++idSeq;
    setItems((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-100 flex flex-col items-center gap-2 px-4">
        {items.map((t) => {
          const meta = KIND_META[t.kind];
          const Icon = meta.icon;
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm font-semibold shadow-lg',
                meta.className,
              )}
            >
              <Icon className="size-4 flex-none" />
              <span className="text-foreground">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
