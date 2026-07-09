import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Ported from apps/mytrion-crm/src/components/ui/button.tsx (same base-ui primitive + CVA
// structure, same token names), retuned for a phone: 48px targets and a 12px radius instead of
// mytrion-crm's compact 36px / 3px desktop-admin scale.
const buttonVariants = cva(
  "group/button inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The primary action carries the logo's gradient — the one place brand outshouts data.
        default:
          'bg-[linear-gradient(135deg,var(--brand-amber),var(--brand-orange))] text-primary-foreground hover:brightness-105',
        outline: 'border-border bg-card hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 48px: a comfortable thumb target, not a desktop 36px control.
        default: 'h-12 px-4',
        sm: 'h-10 px-3.5 text-xs',
        lg: 'h-14 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = React.forwardRef<
  React.ComponentRef<typeof ButtonPrimitive>,
  ButtonPrimitive.Props & VariantProps<typeof buttonVariants>
>(function Button({ className, variant = 'default', size = 'default', ...props }, ref) {
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
