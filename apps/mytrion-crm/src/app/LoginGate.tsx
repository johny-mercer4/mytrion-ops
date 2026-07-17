import { useState } from 'react';
import { beginZohoLogin } from '../api/auth';
import { ApiError } from '../api/transport';
import { AuthScreen } from './AuthScreen';
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
    <AuthScreen
      phase={busy ? 'redirecting' : 'idle'}
      title={busy ? 'Connecting to Zoho' : 'Sign in to Mytrion'}
      body={
        busy
          ? 'Opening Zoho securely — you’ll confirm your account, then we’ll bring you back here.'
          : 'Use your Zoho account to access the Mytrion portal.'
      }
      error={error}
      action={
        busy ? null : (
          <button type="button" className={styles.button} onClick={() => void signIn()}>
            Sign in with Zoho
          </button>
        )
      }
    />
  );
}
