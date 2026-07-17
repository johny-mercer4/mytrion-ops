import { Link } from 'react-router-dom';
import { FuelMark } from '../components/BrandMark';
import styles from './Screen.module.css';

/** 404 — unknown route or unknown Mytrion slug. */
export function NotFound() {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <FuelMark size={42} />
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.body}>That page doesn’t exist.</p>
        <Link className={styles.link} to="/main">
          ← Back to your Mytrions
        </Link>
      </div>
    </div>
  );
}
