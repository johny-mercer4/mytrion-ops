import { AppRouter } from './app/router';
import { UserContextProvider } from './context/UserContextProvider';
import styles from './App.module.css';

/**
 * Root: establish the worker's identity (Zoho OAuth session), then route to the accessible
 * Mytrion(s). Signed-out visitors get the login gate; a failed callback shows its error inline.
 */
export default function App() {
  return (
    <div className={styles.app}>
      <UserContextProvider>
        <AppRouter />
      </UserContextProvider>
    </div>
  );
}
