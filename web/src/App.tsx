import { useZohoUser } from './hooks/useZohoUser';
import { UserContextCard } from './components/UserContext';

export default function App(): JSX.Element {
  const state = useZohoUser();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Octane Assistant</h1>
        <span className="sub">Zoho CRM widget</span>
      </header>

      {state.status === 'loading' && <p className="status">Connecting to Zoho CRM…</p>}

      {state.status === 'error' && (
        <p className="status err">
          Couldn’t initialize Zoho CRM: {state.error}. (This widget must run inside Zoho CRM.)
        </p>
      )}

      {state.status === 'ready' && <UserContextCard context={state.context} />}
    </div>
  );
}
