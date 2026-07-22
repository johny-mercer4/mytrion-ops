import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Octane mark: a ring, a gap, and the amber->orange fuel drop. Inline SVG rather than a raster
 * asset so it stays crisp at any size and needs no network fetch inside Telegram. Paths are the
 * exact geometry from the official vector (octane_logo_v_black.svg), cropped to the icon's bounding
 * box within that file's 214.86x148.09 viewBox — the gradients use the same userSpaceOnUse
 * coordinates as the source, so they still line up correctly under the crop.
 *
 * The ring is --logo-ring (black on light surfaces, WHITE on dark) and the gap is transparent, so
 * the mark reads on the user's Telegram theme instead of vanishing into a dark background. The fuel
 * drop is fixed-color — it IS the brand — and is two layers (a base fill + a lighter highlight),
 * not one flat gradient.
 */
export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  const dropId = useId();
  const accentId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="57.16 1.71 99.36 99.36"
      role="img"
      aria-label="Octane"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={dropId} x1="117.67" y1="77.85" x2="97.62" y2="28.21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff520a" />
          <stop offset="1" stopColor="#ffdd1e" />
        </linearGradient>
        <linearGradient id={accentId} x1="130.79" y1="34.5" x2="107.26" y2="45.97" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffba18" />
          <stop offset="1" stopColor="#ffdd1e" />
        </linearGradient>
      </defs>
      {/* the ring — a filled donut (evenodd), not a stroke, so the gap stays transparent and picks
          up whatever surface the mark sits on (light card, dark Telegram theme, the fuel card's wash) */}
      <path
        fillRule="evenodd"
        fill="var(--logo-ring)"
        d="M106.84,101.07c-27.37,0-49.56-22.24-49.56-49.68S79.47,1.71,106.84,1.71s49.56,22.24,49.56,49.68-22.19,49.68-49.56,49.68h0ZM106.84,18.47c-18.13,0-32.84,14.74-32.84,32.92s14.7,32.92,32.84,32.92,32.84-14.74,32.84-32.92-14.7-32.92-32.84-32.92h0Z"
      />
      {/* highlight sliver, drawn under the drop so only its edge peeks past the drop's silhouette */}
      <path
        fillRule="evenodd"
        fill={`url(#${accentId})`}
        d="M102.74,36.71s6.89,3.54,11.26,2.41c4.37-1.13,6.89-3.83,12.07-4.02,5.44-.2,6.78,2.63,6.84,4.83.07,2.8-.59,8.85-10.06,6.84-9.46-2.01-20.11-10.06-20.11-10.06h0Z"
      />
      {/* the fuel drop */}
      <path
        fillRule="evenodd"
        fill={`url(#${dropId})`}
        d="M92.56,31.08c7.76-.46,11.93,6.89,21.72,10.86,15.64,6.34,18.07-.56,18.44-3.13,1.83,3.77,2.86,8.01,2.86,12.49,0,15.82-12.82,28.64-28.64,28.64s-28.64-12.82-28.64-28.64c0-5.57,1.6-10.77,4.35-15.16,1.44-1.8,4.58-4.73,9.91-5.05h0Z"
      />
    </svg>
  );
}

/** The wordmark's bounding box within the source file's 214.86x148.09 viewBox (below the icon). */
const WORDMARK_VIEWBOX = '0 116 214.86 28';
const WORDMARK_ASPECT = 214.86 / 28;

/**
 * The OCTANE wordmark — not a font, the exact letterform paths from the official vector
 * (octane_logo_v_black.svg). Themed via --logo-ring (same token as the ring: black on light,
 * white on dark) so it never goes invisible against the app's dark-default background.
 */
export function Wordmark({ className, height = 20 }: { className?: string; height?: number }) {
  const width = Math.round(height * WORDMARK_ASPECT);
  return (
    <svg width={width} height={height} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Octane" className={cn('shrink-0', className)}>
      <path
        fill="var(--logo-ring)"
        d="M36.29,135.01c-.5,1.36-1.17,2.5-2.03,3.42-.86.92-1.87,1.66-3.03,2.21-1.16.56-2.41.98-3.73,1.27-1.33.29-2.71.47-4.14.55-1.43.08-2.85.1-4.27.07-1.4.03-2.82,0-4.26-.07-1.44-.08-2.82-.26-4.15-.55-1.33-.29-2.57-.71-3.72-1.27-1.15-.56-2.16-1.29-3.03-2.21-.86-.92-1.54-2.06-2.03-3.42-.49-1.36-.73-2.98-.73-4.86s.24-3.59.73-4.96c.49-1.37,1.16-2.52,2.03-3.45.86-.93,1.87-1.66,3.03-2.19,1.15-.54,2.4-.94,3.72-1.21,1.33-.27,2.71-.45,4.15-.51,1.44-.07,2.86-.09,4.26-.06,1.41-.03,2.83,0,4.27.06,1.43.07,2.81.24,4.14.51,1.33.27,2.57.68,3.73,1.21,1.16.54,2.17,1.27,3.03,2.19.86.93,1.53,2.07,2.03,3.45.49,1.37.74,3.02.72,4.96.01,1.88-.23,3.5-.72,4.86h0ZM28.67,128.04c-.28-.6-.66-1.12-1.14-1.55-.48-.43-1.04-.79-1.68-1.06-.65-.27-1.34-.49-2.08-.66-.74-.16-1.51-.28-2.31-.34-.8-.06-1.59-.1-2.37-.11-.78,0-1.57.03-2.37.1-.8.07-1.56.19-2.3.35-.73.17-1.42.38-2.07.66-.65.27-1.21.63-1.69,1.06-.48.43-.86.95-1.14,1.55-.28.6-.42,1.31-.43,2.12.03.82.18,1.54.46,2.15.28.61.66,1.13,1.14,1.56.47.43,1.03.79,1.67,1.06.64.27,1.33.49,2.07.64.74.15,1.5.26,2.3.32.79.06,1.58.09,2.36.09-.01,0-.02,0-.02.01,0,0,0,.01.02.01.03,0,.04,0,.03-.01,0,0-.02-.01-.03-.01,1.17,0,2.35-.07,3.53-.22,1.18-.14,2.25-.42,3.2-.83.95-.41,1.72-1,2.33-1.76.6-.76.91-1.77.94-3.01,0-.81-.14-1.52-.43-2.12h0ZM49.89,134.04c.55.43,1.19.77,1.9,1.02.71.25,1.45.43,2.22.56.77.12,1.53.2,2.3.24.77.03,1.48.05,2.14.05.3,0,.74,0,1.31,0,.57,0,1.22-.03,1.95-.07.73-.04,1.52-.1,2.38-.16.85-.07,1.72-.16,2.61-.28.89-.12,1.77-.27,2.65-.45.88-.19,1.7-.4,2.46-.65v6.42c-2.22.67-4.48,1.14-6.79,1.41-2.31.27-4.65.38-7.03.34-.22,0-.44,0-.64.01-.2,0-.42.01-.64.01-1.35,0-2.69-.06-4.04-.18-1.35-.12-2.63-.34-3.86-.66-1.23-.32-2.37-.77-3.43-1.34-1.06-.57-1.99-1.31-2.77-2.23-.79-.92-1.4-2.03-1.84-3.33-.44-1.3-.66-2.85-.66-4.63v-.02c0-1.8.22-3.35.67-4.66.45-1.31,1.07-2.42,1.85-3.34.79-.92,1.72-1.66,2.79-2.23,1.08-.57,2.23-1.01,3.46-1.34,1.23-.32,2.53-.54,3.89-.65,1.36-.11,2.71-.16,4.06-.16s2.58.02,3.83.06c1.25.04,2.48.12,3.71.25,1.23.12,2.45.3,3.68.53,1.23.23,2.48.54,3.76.93v6.44c-.67-.22-1.39-.41-2.14-.58-.75-.16-1.51-.31-2.29-.42-.77-.12-1.54-.22-2.31-.3-.77-.08-1.5-.14-2.2-.19-1.64-.11-3.27-.16-4.89-.16-.78,0-1.56.03-2.36.09-.79.06-1.55.17-2.29.33-.73.16-1.42.37-2.06.65-.64.27-1.2.62-1.68,1.05-.48.43-.86.94-1.15,1.55-.28.61-.43,1.33-.45,2.15.03.92.21,1.7.54,2.35.34.65.78,1.18,1.34,1.62h0ZM94.42,124.32v17.81h-7.9v-17.81h-11.64v-6.46h11.64v-.02h7.9v.02h11.64v6.46h-11.64ZM134.72,142.31l-2.46-3.74h-17.58l-2.46,3.74h-8.99l15.2-24.47h10.04l15.22,24.47h-8.99ZM123.48,124.75l-4.69,7.37h9.36l-4.67-7.37h0ZM171.72,142.35l-17.37-14.61v14.61h-7.9v-24.48h7.84l17.37,14.61v-14.61h7.9v24.48h-7.84ZM212.5,136.49v5.84h-28.88v-24.53l28.88.18v5.66h-20.98v3.6h19.99v5.66h-19.99v3.6h20.98Z"
      />
    </svg>
  );
}

/** Icon + OCTANE wordmark, side by side. The one lockup — used everywhere (header and splash). */
export function LogoLockup({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo size={size} />
      <Wordmark height={Math.round(size * 0.62)} />
    </div>
  );
}
