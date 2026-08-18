import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getImpersonation, setImpersonation, type Impersonation } from '../api/impersonation';

interface ImpersonationCtx {
  /** The active global "View as" identity, or null (acting as self). */
  actingAs: Impersonation | null;
  setActingAs(imp: Impersonation | null): void;
}

const Ctx = createContext<ImpersonationCtx | null>(null);

/**
 * Global "View as" state — one identity across the whole app, persisted in localStorage (see
 * api/impersonation.ts). Was per-Mytrion; it is global now so a chosen user survives navigation
 * between sections, and EffectiveUserProvider re-resolves that user's access so the UI renders as them.
 */
export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [actingAs, setState] = useState<Impersonation | null>(() => getImpersonation());

  const setActingAs = useCallback((imp: Impersonation | null) => {
    setImpersonation(imp);
    setState(imp);
  }, []);

  const value = useMemo(() => ({ actingAs, setActingAs }), [actingAs, setActingAs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImpersonation(): ImpersonationCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useImpersonation must be used within <ImpersonationProvider>');
  return c;
}
