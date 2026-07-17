import { Link } from 'react-router-dom';
import { FuelMark } from '../components/BrandMark';
import styles from './Screen.module.css';

/** 403 — the user is known but not allowed into the requested Mytrion. */
export function Forbidden({ reason }: { reason: string }) {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <FuelMark size={42} />
        <h1 className={styles.title}>No access</h1>
        <p className={styles.body}>{reason}</p>
        <Link className={styles.link} to="/main">
          ← Back to your Mytrions
        </Link>
      </div>
    </div>
  );
}
