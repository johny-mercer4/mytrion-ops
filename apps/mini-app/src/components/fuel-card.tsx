import * as React from 'react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

export type CardStatus = 'registered' | 'pending' | 'open';

const STATUS_COPY: Record<CardStatus, string> = {
  registered: 'Driver registered',
  pending: 'Invite sent',
  open: 'No driver yet',
};

/** Fuel cards are long; only the last four identify one in conversation. */
function maskNumber(cardNumber: string | null, cardId: string | null): string {
  const n = cardNumber?.trim();
  if (!n) return cardId ? `ID ${cardId}` : '—';
  return n.length <= 4 ? n : `•••• ${n.slice(-4)}`;
}

/**
 * The app's one bold element: an actual fuel card, not a list row. A trucking company thinks in
 * cards — a chip, a masked number, an embossed driver name — so the fleet reads as the physical
 * objects it is. Everything around it stays quiet.
 */
export function FuelCard({
  cardNumber,
  cardId,
  cardType,
  driverName,
  status,
  children,
  className,
}: {
  cardNumber: string | null;
  cardId: string | null;
  cardType?: string | null;
  driverName: string | null;
  status: CardStatus;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div className="relative p-4">
        {/* brand wash — the logo's gradient, kept to a whisper so the data stays legible */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            background:
              'radial-gradient(120% 100% at 100% 0%, var(--brand-amber) 0%, var(--brand-orange) 55%, transparent 75%)',
          }}
        />

        <div className="relative flex items-start justify-between">
          {/* the chip */}
          <div
            aria-hidden
            className="h-6 w-8 rounded-[5px] border border-black/10"
            style={{
              background: 'linear-gradient(150deg, var(--brand-amber), var(--brand-orange))',
            }}
          />
          <Logo size={22} className="opacity-90" />
        </div>

        <div className="relative mt-4 flex items-baseline gap-2">
          <p className="tabular font-mono text-lg font-semibold tracking-wider">
            {maskNumber(cardNumber, cardId)}
          </p>
          {cardType && (
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              {cardType}
            </span>
          )}
        </div>

        <div className="relative mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              Driver
            </p>
            <p
              className={cn(
                'truncate text-sm font-semibold tracking-wide uppercase',
                !driverName && 'text-muted-foreground normal-case tracking-normal',
              )}
            >
              {driverName ?? 'Unassigned'}
            </p>
          </div>
          <StatusChip status={status} />
        </div>
      </div>

      {children && <div className="border-t border-border p-4 pt-3">{children}</div>}
    </div>
  );
}

function StatusChip({ status }: { status: CardStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
        status === 'registered' && 'bg-success/12 text-success',
        status === 'pending' && 'bg-primary/15 text-foreground',
        status === 'open' && 'bg-muted text-muted-foreground',
      )}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

export { STATUS_COPY };
