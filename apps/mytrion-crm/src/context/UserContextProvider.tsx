import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { completeZohoCallbackIfPresent, refreshWorkerFromMe } from '../api/auth';
import { bindHorizonTelegramAfterLogin, resetHorizonTelegramBind } from '../api/horizonTelegram';
import { getSession, SESSION_CHANGED_EVENT } from '../api/session';
import { fetchViewAsContext } from '../api/viewAs';
import { isAdmin } from '../access/resolveAccess';
import { AuthScreen } from '../app/AuthScreen';
import { LoginGate } from '../app/LoginGate';
import { isTelegramWebView } from '../telegram/webApp';
import { useImpersonation } from './ImpersonationProvider';
import { contextFromWorker, devMockContext, type UserContext } from './userContext';

/**
 * The EFFECTIVE identity every RBAC gate reads: the "View as" target while an admin is previewing,
 * else the real signed-in worker. Consumers call `useUserContext()`.
 */
const Ctx = createContext<UserContext | null>(null);
/**
 * The REAL signed-in identity, never impersonated — for the header account cluster and the View-as
 * picker/Exit (which must keep working while previewing a non-admin). Consumers call `useRealUserContext()`.
 */
const RealCtx = createContext<UserContext | null>(null);
/** Lets profile picture uploads re-read the stored session without a full reload. */
const ReloadCtx = createContext<(() => void) | null>(null);

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
    const sync = (): void => {
      void refreshWorkerFromMe().then((changed) => {
        if (!cancelled && changed) setState(syncBootState());
      });
    };
    sync();
    /**
     * Re-check on tab focus as well as on mount. An admin editing someone's access in another tab
     * (or telling them over chat) previously required the affected user to hard-reload before the
     * change took effect, which read as "the override isn't working". Coming back to the tab is the
     * natural moment to re-resolve, and /auth/me is cheap; the UI only re-renders if the grant
     * actually changed.
     */
    const onFocus = (): void => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [state.phase]);

  // Horizon Mini App: after Zoho session is live, bind Telegram identity. Soft-fail; never blocks CRM.
  useEffect(() => {
    if (state.phase !== 'authed' || !getSession()) {
      resetHorizonTelegramBind();
      return;
    }
    void bindHorizonTelegramAfterLogin();
    const onFocus = (): void => {
      if (document.visibilityState === 'visible') void bindHorizonTelegramAfterLogin();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [state.phase]);

  // A definitively rejected refresh token clears the stored session. React previously kept the
  // stale in-memory user alive, so every HR panel continued issuing 401 requests until a manual
  // reload. Follow same-tab session changes and cross-tab storage changes back to the login gate.
  useEffect(() => {
    const syncSession = (): void => setState(syncBootState());
    window.addEventListener(SESSION_CHANGED_EVENT, syncSession);
    window.addEventListener('storage', syncSession);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, syncSession);
      window.removeEventListener('storage', syncSession);
    };
  }, []);

  const reloadFromSession = useCallback((): void => {
    setState(syncBootState());
  }, []);

  if (state.phase === 'loading') {
    return (
      <AuthScreen
        phase="exchanging"
        title="Signing you in"
        body={
          isTelegramWebView()
            ? 'Stay in this window — Mytrion is finishing sign-in.'
            : 'Zoho confirmed your account — finalizing identity.'
        }
      />
    );
  }
  if (state.phase === 'anon') return <LoginGate initialError={state.error} />;
  return (
    <ReloadCtx.Provider value={reloadFromSession}>
      <RealCtx.Provider value={state.context}>{children}</RealCtx.Provider>
    </ReloadCtx.Provider>
  );
}

/**
 * Overlays the "View as" target's access onto `useUserContext()` so every RBAC gate — the Mytrion
 * list, tabs, Settings, the HR manage buttons — renders as the previewed user, while the real admin
 * stays available via `useRealUserContext()`. Only admins get the preview; for everyone else this is a
 * pass-through. Mount BELOW UserContextProvider and ImpersonationProvider.
 */
export function EffectiveUserProvider({ children }: { children: ReactNode }) {
  const real = useRealUserContext();
  const { actingAs } = useImpersonation();
  const [effective, setEffective] = useState<UserContext>(real);

  useEffect(() => {
    // Self, or a non-admin who somehow has an act-as set: no UI override, always your own context.
    if (!actingAs || !isAdmin(real)) {
      setEffective(real);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    // Show the real context until the target's access resolves — never a broken intermediate.
    setEffective(real);
    fetchViewAsContext(actingAs.zohoUserId, controller.signal)
      .then((ctx) => {
        if (!cancelled) setEffective(ctx);
      })
      .catch(() => {
        /* keep the real context on failure — the backend still enforces the target's real limits */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [actingAs, real]);

  return <Ctx.Provider value={effective}>{children}</Ctx.Provider>;
}

/**
 * The effective user context — the View-as target while previewing, else the signed-in worker. Falls
 * back to the real context when no EffectiveUserProvider is mounted (e.g. isolated component tests), so
 * it never throws just because the preview layer is absent.
 */
export function useUserContext(): UserContext {
  const effective = useContext(Ctx);
  const real = useContext(RealCtx);
  const ctx = effective ?? real;
  if (!ctx) throw new Error('useUserContext must be used within <UserContextProvider>');
  return ctx;
}

/** The REAL signed-in identity, never impersonated. For the account cluster + the View-as picker. */
export function useRealUserContext(): UserContext {
  const ctx = useContext(RealCtx);
  if (!ctx) throw new Error('useRealUserContext must be used within <UserContextProvider>');
  return ctx;
}

/** Re-read identity from the stored session (e.g. after uploading a profile picture). */
export function useReloadUserContext(): () => void {
  const reload = useContext(ReloadCtx);
  if (!reload) throw new Error('useReloadUserContext must be used within <UserContextProvider>');
  return reload;
}
