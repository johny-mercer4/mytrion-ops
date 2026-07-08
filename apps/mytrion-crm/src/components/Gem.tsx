import { Sparkle } from './icons';
import styles from './Gem.module.css';

/** The assistant "gem" avatar — gradient circle (4285F4→9B72CB→D96570) with the sparkle. */
export function Gem({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.gem} style={{ width: size, height: size }}>
      <Sparkle size={Math.round(size * 0.53)} />
    </span>
  );
}
