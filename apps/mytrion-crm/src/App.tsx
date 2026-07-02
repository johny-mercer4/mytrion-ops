import { AppRouter } from './app/router';
import styles from './App.module.css';

/**
 * Root. The router owns the auth boundary: worker routes sit behind the Zoho OAuth gate
 * (WorkerLayout → UserContextProvider); the client sign-in page (/client) is a public sibling.
 */
export default function App() {
  return (
    <div className={styles.app}>
      <AppRouter />
    </div>
  );
}
