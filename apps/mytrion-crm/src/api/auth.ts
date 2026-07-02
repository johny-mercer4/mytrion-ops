/**
 * Zoho OAuth sign-in flow for the portal (authorization-code, backend is the confidential client):
 *   1. beginZohoLogin()  → ask the backend for the authorize URL + a signed state, stash the state,
 *      and send the browser to Zoho.
 *   2. Zoho redirects back to the app origin with ?code&state.
 *   3. completeZohoCallbackIfPresent() → relay code+state to the backend, which verifies the state,
 *      exchanges the code, reads the worker's Zoho identity, and returns a Bearer session we store.
 *
 * The backend signs+verifies the state (real CSRF gate); we also compare the echoed state against
 * the one we stashed to catch cross-tab confusion early.
 */
import { request, ApiError } from './transport';
import { clearSession, setSession, type StoredSession } from './session';

const STATE_KEY = 'octane.oauth.state';

interface LoginStart {
  authorizeUrl: string;
  state: string;
}

/** Step 1 — redirects the browser to Zoho. Never returns on success (navigation away). */
export async function beginZohoLogin(): Promise<void> {
  const data = (await request('GET', '/auth/zoho/login')) as LoginStart;
  try {
    sessionStorage.setItem(STATE_KEY, data.state);
  } catch {
    /* private mode — the backend-signed state is still verified server-side */
  }
  window.location.assign(data.authorizeUrl);
}

/** Query keys Zoho appends to the redirect that we strip from the address bar after handling. */
const CALLBACK_PARAMS = ['code', 'state', 'location', 'accounts-server', 'error'] as const;

function stripCallbackParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const p of CALLBACK_PARAMS) {
    if (url.searchParams.has(p)) {
      url.searchParams.delete(p);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * Step 3 — if the URL carries an OAuth callback, complete it and store the session.
 * Returns true when a session was established, false when there was no callback to handle.
 * Throws ApiError on a genuine failure (bad/expired code, state mismatch).
 */
export async function completeZohoCallbackIfPresent(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const oauthError = params.get('error');

  if (!code || !state) {
    // The user may have denied consent → Zoho returns ?error without a code.
    if (oauthError) {
      stripCallbackParams();
      throw new ApiError(`Zoho sign-in was cancelled or failed (${oauthError}).`, 'OAUTH_DENIED', 400);
    }
    return false;
  }

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
  // Clean the address bar first so a refresh can't replay a one-time (now consumed) code.
  stripCallbackParams();

  if (expected && expected !== state) {
    throw new ApiError('Sign-in state did not match — please try again.', 'OAUTH_STATE', 400);
  }

  const session = (await request('POST', '/auth/zoho/callback', { body: { code, state } })) as StoredSession;
  setSession(session);
  return true;
}

/** Drop the session and bounce back through Zoho sign-in. */
export function logout(): void {
  clearSession();
  void beginZohoLogin();
}
