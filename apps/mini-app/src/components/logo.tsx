import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Octane mark: a black ring, a white gap, and the amber->orange fuel drop. Inline SVG rather
 * than a raster asset so it stays crisp at any size, needs no network fetch inside Telegram, and
 * inherits nothing from the theme (the mark is fixed-color by design).
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
      {/* outer black ring */}
      <circle cx="50" cy="50" r="50" fill="#000000" />
      {/* white gap */}
      <circle cx="50" cy="50" r="37" fill="#ffffff" />
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

/** Mark + wordmark, for the header and the launch screen. */
export function LogoLockup({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo size={size} />
      <span className="text-base font-bold tracking-tight">Octane</span>
    </div>
  );
}
