import styles from './MytrionPageLoader.module.css';

export function MytrionPageLoader({
  label,
  detail = 'Preparing the latest workspace data',
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className={styles.loader} role="status" aria-busy="true" aria-live="polite">
      <span className={styles.mark} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  );
}
