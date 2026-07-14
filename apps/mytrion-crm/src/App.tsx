import { AppRouter } from './app/router';
import { ErrorBoundary } from './components/ErrorBoundary';
import styles from './App.module.css';

/**
 * Root. The router owns the auth boundary: worker routes sit behind the Zoho OAuth gate
 * (WorkerLayout → UserContextProvider); retired public routes like `/client` are rejected there.
 * The top-level boundary is the last resort — the app must never white-screen.
 */
export default function App() {
  return (
    <div className={styles.app}>
      <ErrorBoundary>
        <AppRouter />
      </ErrorBoundary>
    </div>
  );
}
