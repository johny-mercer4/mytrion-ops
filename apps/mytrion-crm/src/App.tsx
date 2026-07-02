import { AppRouter } from './app/router';
import { UserContextProvider } from './context/UserContextProvider';
import { StatusMessage } from './components/StatusMessage';
import styles from './App.module.css';

/**
 * Root: read the user context from the URL (passed by the Zoho shim — no SDK), then route to the
 * accessible Mytrion(s). A missing/invalid context renders the "open from CRM" fallback.
 */
export default function App() {
  return (
    <div className={styles.app}>
      <UserContextProvider
        fallback={(error) => (
          <main className={styles.main}>
            <StatusMessage tone="error">{error}</StatusMessage>
          </main>
        )}
      >
        <AppRouter />
      </UserContextProvider>
    </div>
  );
}
