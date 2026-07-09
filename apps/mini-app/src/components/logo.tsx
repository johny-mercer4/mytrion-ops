import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Octane mark: a ring, a gap, and the amber->orange fuel drop. Inline SVG rather than a raster
 * asset so it stays crisp at any size and needs no network fetch inside Telegram.
 *
 * The ring is --logo-ring (black on light surfaces, WHITE on dark) and the gap is transparent, so
 * the mark reads on the user's Telegram theme instead of vanishing into a dark background. Only the
 * fuel drop is fixed-color — it IS the brand.
 *
 * If you have the official vector, drop it in and swap this component's paths — the geometry here
 * is traced from the logo, not exported from source.
 */
export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Octane"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="30" y1="24" x2="60" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--brand-amber)" />
          <stop offset="1" stopColor="var(--brand-orange)" />
        </linearGradient>
      </defs>
      {/* the ring — stroked, not a filled disc, so the gap stays transparent and picks up whatever
          surface the mark sits on (light card, dark Telegram theme, the fuel card's wash) */}
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--logo-ring)" strokeWidth="12" />
      {/* the fuel drop: a disc that nearly fills the ring, its top edge a shallow liquid meniscus */}
      <path
        d="M20 52
           C20 33 30 22 44 26
           C53 29 57 33 66 30
           C74 27 80 36 80 52
           A30 30 0 1 1 20 52 Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}

/**
 * Icon + OCTANE wordmark, side by side. The one lockup — used everywhere (header and splash).
 * Wordmark is Inter Tight 800 uppercase (octanefuel.com's typeface); sized off the icon (≈0.6×) so
 * the two always scale together.
 */
export function LogoLockup({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo size={size} />
      <span
        className="font-extrabold tracking-[0.02em] uppercase"
        style={{ fontSize: Math.round(size * 0.6), fontWeight: 800, lineHeight: 1 }}
      >
        OCTANE
      </span>
    </div>
  );
}

/** Alias kept so the larger splash/loading/error screens read intentionally; same icon + name. */
export function LogoStacked({ className, size = 40 }: { className?: string; size?: number }) {
  return <LogoLockup {...(className ? { className } : {})} size={size} />;
}
