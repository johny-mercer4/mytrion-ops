import { AppRouter } from './app/router';
import { ErrorBoundary } from './components/ErrorBoundary';
import styles from './App.module.css';

/**
 * Root. The router owns the auth boundary: worker routes sit behind the Zoho OAuth gate
 * (WorkerLayout → UserContextProvider); the client sign-in page (/client) is a public sibling.
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
