import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { completeZohoCallbackIfPresent, refreshWorkerFromMe } from '../api/auth';
import { getSession } from '../api/session';
import { AuthScreen } from '../app/AuthScreen';
import { LoginGate } from '../app/LoginGate';
import { contextFromWorker, devMockContext, type UserContext } from './userContext';

const Ctx = createContext<UserContext | null>(null);

type BootState =
  | { phase: 'loading' }
  | { phase: 'authed'; context: UserContext }
  | { phase: 'anon'; error?: string };

/** True if the URL looks like an OAuth callback (Zoho redirected back with a code/error). */
function hasOAuthCallback(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has('code') || q.has('error');
}

/** Resolve identity WITHOUT async work: an existing session, else the dev bypass, else anon. */
function syncBootState(): BootState {
  const s = getSession();
  if (s) return { phase: 'authed', context: contextFromWorker(s.worker) };
  const mock = devMockContext();
  if (mock) return { phase: 'authed', context: mock };
  return { phase: 'anon' };
}

// Module-level so React StrictMode's double effect-invocation (dev) can't exchange the one-time
// OAuth code twice — both invocations await the same promise.
let callbackExchange: Promise<boolean> | null = null;
function handleCallbackOnce(): Promise<boolean> {
  if (!callbackExchange) callbackExchange = completeZohoCallbackIfPresent();
  return callbackExchange;
}

/**
 * Auth boot + provider. On load we either (a) complete an in-flight Zoho OAuth callback, (b) resume
 * a stored session, (c) use the dev bypass, or (d) show the login gate. Identity is then provided
 * to the whole app; the backend re-verifies it (Bearer token) on every request.
 */
export function UserContextProvider({ children }: { children: ReactNode }) {
  // Only the OAuth-callback case needs an async round-trip; everything else resolves synchronously
  // (no loading flash for already-signed-in workers).
  const [state, setState] = useState<BootState>(() =>
    hasOAuthCallback() ? { phase: 'loading' } : syncBootState(),
  );

  useEffect(() => {
    if (state.phase !== 'loading') return;
    let cancelled = false;
    handleCallbackOnce()
      .then(() => {
        if (cancelled) return;
        setState(syncBootState()); // the callback stored a session on success
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ phase: 'anon', error: e instanceof Error ? e.message : 'Sign-in failed.' });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  // Once resumed from a stored session, refresh access from /auth/me in the background so an admin's
  // access edit takes effect on this load (not only after a full re-login). Non-blocking; the UI is
  // already rendered with the stored context and only re-renders if the resolved access changed.
  useEffect(() => {
    if (state.phase !== 'authed' || !getSession()) return;
    let cancelled = false;
    void refreshWorkerFromMe().then((changed) => {
      if (!cancelled && changed) setState(syncBootState());
    });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  if (state.phase === 'loading') {
    return (
      <AuthScreen
        phase="exchanging"
        title="Signing you in"
        body="Zoho confirmed your account — finishing the session and loading your workspace."
      />
    );
  }
  if (state.phase === 'anon') return <LoginGate initialError={state.error} />;
  return <Ctx.Provider value={state.context}>{children}</Ctx.Provider>;
}

/** The session user context. Throws if used outside the provider (a programming error). */
export function useUserContext(): UserContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUserContext must be used within <UserContextProvider>');
  return ctx;
}
