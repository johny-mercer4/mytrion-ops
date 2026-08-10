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
          {/* sonner renders its own position:fixed container, so its `offset` prop is the only
              way to clear the mobile tab bar. 0 on a desktop. */}
          <Toaster
            position="bottom-right"
            richColors
            offset="calc(16px + var(--layout-bottom-inset, 0px))"
          />
        </ThemeProvider>
      </ErrorBoundary>
    </div>
  );
}
