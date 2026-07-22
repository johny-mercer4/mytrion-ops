import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  getImpersonation,
  mytrionIdFromPath,
  setImpersonation,
  type Impersonation,
} from '../api/impersonation';
import type { MytrionId } from '../access/mytrions.config';

interface ImpersonationCtx {
  /** Mytrion the current route belongs to, or null on `/main` picker. */
  mytrionId: MytrionId | null;
  /** Rep for THIS Mytrion only, or null (acting as self / outside a Mytrion). */
  actingAs: Impersonation | null;
  setActingAs(imp: Impersonation | null): void;
}

const Ctx = createContext<ImpersonationCtx | null>(null);

/**
 * Mirrors per-Mytrion act-as into React. Switching Mytrion or returning to the picker
 * rebinds `actingAs` to that route's slot (null on `/main`).
 */
export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const mytrionId = useMemo(() => mytrionIdFromPath(pathname), [pathname]);
  const [actingAs, setState] = useState<Impersonation | null>(() =>
    getImpersonation(mytrionIdFromPath(pathname)),
  );

  useEffect(() => {
    setState(getImpersonation(mytrionId));
  }, [mytrionId]);

  const setActingAs = useCallback(
    (imp: Impersonation | null) => {
      if (!mytrionId) return;
      setImpersonation(imp, mytrionId);
      setState(imp);
    },
    [mytrionId],
  );

  const value = useMemo(
    () => ({ mytrionId, actingAs, setActingAs }),
    [mytrionId, actingAs, setActingAs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImpersonation(): ImpersonationCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useImpersonation must be used within <ImpersonationProvider>');
  return c;
}
