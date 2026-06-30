import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { CONTEXT_PARAMS, readUserContext, type UserContext, type UserContextResult } from './userContext';

const Ctx = createContext<UserContext | null>(null);

/**
 * Reads the user context from the URL exactly ONCE (it's one-shot — we strip the params from the
 * address bar right after so the identity isn't bookmarked or re-shared), then provides it to the
 * whole app. On a missing/invalid context it renders `fallback(error)` instead of the tree.
 */
export function UserContextProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: (error: string) => ReactNode;
}) {
  // Capture before the first paint; never re-read (the params are gone after the strip below).
  const resultRef = useRef<UserContextResult | null>(null);
  if (resultRef.current === null) resultRef.current = readUserContext();
  const result = resultRef.current;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search) return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const p of CONTEXT_PARAMS) {
      if (url.searchParams.has(p)) {
        url.searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  if (!result.ok) return <>{fallback(result.error)}</>;
  return <Ctx.Provider value={result.context}>{children}</Ctx.Provider>;
}

/** The session user context. Throws if used outside the provider (a programming error). */
export function useUserContext(): UserContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUserContext must be used within <UserContextProvider>');
  return ctx;
}
