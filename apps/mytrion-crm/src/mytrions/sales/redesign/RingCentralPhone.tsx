/**
 * Boots RingCentral Embeddable inside Sales Mytrion (floating dialer widget).
 * Credentials come from GET /v1/ringcentral/embed-config — never from VITE_*.
 */
import { useEffect, useState } from 'react';
import { ApiError } from '@/api/transport';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';

type LoadState = 'idle' | 'loading' | 'ready' | 'off' | 'error';

export function RingCentralPhone() {
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

  // No `booted` ref guard: it would persist across React StrictMode's dev double-invoke while the
  // per-run `cancelled` token does not, leaving boot permanently stuck at 'loading'. The
  // getElementById(RC_ADAPTER_SCRIPT_ID) check below already prevents a real double-injection.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState('loading');
      try {
        const cfg = await fetchRingCentralEmbedConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.adapterUrl) {
          setState('off');
          return;
        }
        if (!document.getElementById(RC_ADAPTER_SCRIPT_ID)) {
          const script = document.createElement('script');
          script.id = RC_ADAPTER_SCRIPT_ID;
          script.src = cfg.adapterUrl;
          script.async = true;
          script.onerror = () => {
            // Remove the failed script so a later remount re-injects instead of finding a dead
            // element via getElementById and falsely reporting 'ready'.
            script.remove();
            if (!cancelled) {
              setError('Failed to load RingCentral adapter');
              setState('error');
            }
          };
          script.onload = () => {
            if (!cancelled) setState('ready');
          };
          document.body.appendChild(script);
        } else {
          setState('ready');
        }
      } catch (err) {
        if (cancelled) return;
        // 404 = flag/creds off — quiet. Anything else surfaces briefly.
        if (err instanceof ApiError && err.status === 404) {
          setState('off');
          return;
        }
        setError(err instanceof Error ? err.message : 'RingCentral unavailable');
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'off' || state === 'idle' || state === 'ready' || state === 'loading') {
    // Embeddable injects its own floating widget UI; we only surface load errors.
    return null;
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 24,
        bottom: 24,
        zIndex: 96,
        maxWidth: 280,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text2)',
        fontSize: 12,
        boxShadow: 'var(--shadow)',
      }}
    >
      Phone: {error ?? 'unavailable'}
    </div>
  );
}
