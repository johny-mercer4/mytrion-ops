import styles from './MytrionLoader.module.css';

export function MytrionLoader({ appName }: { appName: string }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.sweepTrack}>
        <div className={styles.sweep} />
      </div>
      <div className={styles.ringContainer}>
        <div className={styles.ringBorder} />
        <div className={styles.ringSpin1} />
        <div className={styles.ringSpin2} />
        <div className={styles.brand}>
          {appName}
          <br />
          <span className={styles.brandAccent}>Mytrion</span>
        </div>
      </div>
      <div className={styles.textContainer}>
        <div className={styles.loadingText}>Connecting to {appName}</div>
      </div>
    </div>
  );
}
