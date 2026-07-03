import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { getImpersonation, setImpersonation, type Impersonation } from '../api/impersonation';

interface ImpersonationCtx {
  /** The rep an admin is currently acting as, or null (acting as self). */
  actingAs: Impersonation | null;
  setActingAs(imp: Impersonation | null): void;
}

const Ctx = createContext<ImpersonationCtx | null>(null);

/**
 * Holds the admin "act as agent" selection. Backed by the localStorage store the transport reads
 * synchronously (api/impersonation.ts) so header attachment doesn't depend on React; this provider
 * just mirrors it into state so the UI (banner/picker) reacts.
 */
export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [actingAs, setState] = useState<Impersonation | null>(() => getImpersonation());
  const setActingAs = useCallback((imp: Impersonation | null) => {
    setImpersonation(imp);
    setState(imp);
  }, []);
  return <Ctx.Provider value={{ actingAs, setActingAs }}>{children}</Ctx.Provider>;
}

export function useImpersonation(): ImpersonationCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useImpersonation must be used within <ImpersonationProvider>');
  return c;
}
