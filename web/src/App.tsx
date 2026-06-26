import { AppHeader } from './components/AppHeader';
import { StatusMessage } from './components/StatusMessage';
import { UserContextCard } from './features/userContext/UserContextCard';
import { useZohoUser } from './hooks/useZohoUser';
import styles from './App.module.css';

export default function App() {
  const state = useZohoUser();

  return (
    <div className={styles.app}>
      <AppHeader title="Octane Assistant" subtitle="Zoho CRM widget" />

      {state.status === 'loading' && <StatusMessage>Connecting to Zoho CRM…</StatusMessage>}

      {state.status === 'error' && (
        <StatusMessage tone="error">
          Couldn’t initialize Zoho CRM: {state.error}. (This widget must run inside Zoho CRM.)
        </StatusMessage>
      )}

      {state.status === 'ready' && <UserContextCard context={state.context} />}
    </div>
  );
}
