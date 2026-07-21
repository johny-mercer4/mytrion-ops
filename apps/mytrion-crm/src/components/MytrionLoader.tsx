import type { CSSProperties } from 'react';
import styles from './MytrionLoader.module.css';

export interface MytrionLoaderProps {
  /** Primary status line under the brand (e.g. "Sales Mytrion"). */
  text: string;
  /**
   * Accent color for rings / sweep / brand. Prefer a CSS color or token
   * (`#38bef0`, `var(--rocket)`). Defaults to global `--accent`.
   */
  themeColor?: string;
}

/**
 * Single entry loader for all Mytrions — used by MytrionGuard Suspense only.
 * Shells must not mount a second boot splash on top of this.
 */
export function MytrionLoader({ text, themeColor }: MytrionLoaderProps) {
  const style = {
    ['--loader-accent' as string]: themeColor ?? 'var(--accent)',
    ['--loader-accent-soft' as string]: themeColor
      ? `color-mix(in srgb, ${themeColor} 18%, transparent)`
      : 'var(--accent-soft)',
  } as CSSProperties;

  return (
    <div className={styles.overlay} style={style} role="status" aria-busy="true" aria-live="polite">
      <div className={styles.sweepTrack}>
        <div className={styles.sweep} />
      </div>
      <div className={styles.ringContainer}>
        <div className={styles.ringBorder} />
        <div className={styles.ringSpin1} />
        <div className={styles.ringSpin2} />
        <div className={styles.brand}>
          My<span className={styles.brandAccent}>trion</span>
        </div>
      </div>
      <div className={styles.textContainer}>
        <div className={styles.loadingText}>{text}</div>
      </div>
    </div>
  );
}
