import { useEffect, useState } from 'react';
import { loadZohoContext, type ZohoContext } from '../zoho/embeddedApp';

export type ZohoUserState =
  | { status: 'loading' }
  | { status: 'ready'; context: ZohoContext }
  | { status: 'error'; error: string };

/** Initialize Zoho CRM auth and load the current-user context once, on mount. */
export function useZohoUser(): ZohoUserState {
  const [state, setState] = useState<ZohoUserState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadZohoContext()
      .then((context) => {
        if (!cancelled) setState({ status: 'ready', context });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
