import type { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface DetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

const SIZE_CLASS: Record<NonNullable<DetailDialogProps['size']>, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

// Record-detail modal convention: title + status badges header, scrollable
// multi-section body, footer with secondary/primary actions.
export function DetailDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  badges,
  footer,
  children,
  size = 'lg',
}: DetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SIZE_CLASS[size], 'max-h-[88vh] overflow-hidden p-0')}>
        <DialogHeader className="gap-1.5 border-b px-5 pt-5 pb-4">
          <DialogTitle className="font-heading text-lg font-bold">{title}</DialogTitle>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
          {badges ? <div className="flex flex-wrap gap-1.5 pt-1">{badges}</div> : null}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <DialogFooter className="mx-0 mb-0 rounded-b-xl">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
