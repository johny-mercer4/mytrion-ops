import { useState, type FormEvent } from 'react';
import {
  clearClientSession,
  clientLogin,
  getClientSession,
  type ClientSession,
} from '../api/clientAuth';
import { FuelMark } from '../components/BrandMark';
import screen from './Screen.module.css';

/**
 * CLIENT sign-in — a separate, standalone page (route `/client`), deliberately OUTSIDE the worker
 * Zoho OAuth gate. Carrier accounts are provisioned by Octane admins (Carrier User Management);
 * there is intentionally NO sign-up. A successful login mints a locked-down customer session
 * (audience 'customer', scoped to the carrier's own data) — the same account the future Telegram
 * mini-app will use.
 */
export function ClientLogin() {
  const [session, setSession] = useState<ClientSession | null>(() => getClientSession());
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !login.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      setSession(await clientLogin(login.trim(), password));
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <div className={screen.screen}>
        <div className={screen.card}>
          <FuelMark size={42} />
          <h1 className={screen.title}>Signed in</h1>
          <p className={screen.body}>
            You're signed in as <strong>{session.client.login ?? 'carrier user'}</strong> for
            carrier <strong>{session.client.carrierId}</strong>. The carrier portal and Telegram
            mini-app experience are on their way — your access is ready.
          </p>
          <button
            type="button"
            className={screen.button}
            onClick={() => {
              clearClientSession();
              setSession(null);
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={screen.screen}>
      <div className={screen.card}>
        <FuelMark size={42} />
        <h1 className={screen.title}>Client sign in</h1>
        <p className={screen.body}>
          Sign in with the login and password provided by your Octane representative. Client
          accounts are provisioned by Octane — there is no self sign-up.
        </p>
        <form className={screen.form} onSubmit={(e) => void submit(e)}>
          <input
            className={screen.input}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Login"
            autoComplete="username"
            aria-label="Login"
          />
          <input
            className={screen.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            aria-label="Password"
          />
          {error && (
            <p className={screen.error} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className={screen.button} disabled={busy || !login.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
