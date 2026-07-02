import { useState } from 'react';
import { FuelMark } from '../components/BrandMark';
import { beginZohoLogin } from '../api/auth';
import { ApiError } from '../api/transport';
import styles from './Screen.module.css';

/**
 * Unauthenticated gate: the only way into the portal is a Zoho sign-in. The button asks the backend
 * for the authorize URL and redirects the browser to Zoho; on return the provider completes the
 * exchange. `initialError` surfaces a failed/cancelled callback from the previous attempt.
 */
export function LoginGate({ initialError }: { initialError?: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      await beginZohoLogin(); // navigates away on success
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'FEATURE_DISABLED'
          ? 'Zoho sign-in is not enabled on the server yet.'
          : e instanceof Error
            ? e.message
            : 'Could not start sign-in.';
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <FuelMark size={42} />
        <h1 className={styles.title}>Sign in to Mytrion</h1>
        <p className={styles.body}>Use your Zoho account to access the Mytrion portal.</p>
        <button className={styles.button} onClick={signIn} disabled={busy}>
          {busy ? 'Redirecting…' : 'Sign in with Zoho'}
        </button>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}
