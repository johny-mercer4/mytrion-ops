import { Sparkle } from './icons';
import styles from './BrandMark.module.css';

/** The orange "fuel spark" chip (gradient circle + four-point sparkle). */
export function FuelMark({ size = 30 }: { size?: number }) {
  return (
    <span className={styles.fuel} style={{ width: size, height: size }}>
      <Sparkle size={Math.round(size * 0.53)} style={{ color: '#fff' }} />
    </span>
  );
}

/** Brand lockup: MYTRION PLATFORM wordmark. */
export function BrandMark() {
  return (
    <span className={styles.brand}>
      <span className={styles.word}>
        MYTRION<span className={styles.ai}> HORIZON</span>
      </span>
    </span>
  );
}
