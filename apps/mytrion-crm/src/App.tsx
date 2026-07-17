import { AppRouter } from './app/router';
import { ErrorBoundary } from './components/ErrorBoundary';
import styles from './App.module.css';

import { ThemeProvider } from './hooks/useTheme';
import { Toaster } from 'sonner';

/**
 * Root. The router owns the auth boundary: worker routes sit behind the Zoho OAuth gate
 * (WorkerLayout → UserContextProvider); retired public routes like `/client` are rejected there.
 * The top-level boundary is the last resort — the app must never white-screen.
 */
export default function App() {
  return (
    <div className={styles.app}>
      <ErrorBoundary>
        <ThemeProvider>
          <AppRouter />
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </ErrorBoundary>
    </div>
  );
}
