import { useEffect, useState } from 'react';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { installRcConsoleFilter } from './rcConsoleFilter';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';
import { subscribeRingCentral, type RingCentralCallEvent } from './ringcentralEvents';
import { X, AlertCircle } from 'lucide-react';

type ToastType = 'error';
interface ToastMsg {
  id: number;
  type: ToastType;
  title: string;
  message: string;
}

let toastId = 0;

/**
 * UI toasts for RingCentral — call lifecycle (dialing / connected / ended) stays silent;
 * backend audit still captures every event via {@link subscribeRingCentral}. Only surface
 * session loss (and explicit RC errors if we add them later).
 */
function toastFor(e: RingCentralCallEvent): { type: ToastType; title: string; message: string } | null {
  if (e.kind === 'logout') {
    return {
      type: 'error',
      title: 'RingCentral session ended',
      message: 'Open the phone widget and sign in again to place calls.',
    };
  }
  return null;
}

export function RingCentralPhone() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const addToast = (type: ToastType, title: string, message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    let cancelled = false;

    // 1) Load the Embeddable adapter (no shared secrets by default — agents sign in in the widget).
    void (async () => {
      try {
        const cfg = await fetchRingCentralEmbedConfig();
        if (cancelled || !cfg.enabled || !cfg.adapterUrl) return;
        if (document.getElementById(RC_ADAPTER_SCRIPT_ID)) return;

        // Silence the vendor bundle's rc-*-notify / extension console spam. Installed only
        // when the adapter actually loads, strictly before any adapter code runs.
        installRcConsoleFilter();

        const script = document.createElement('script');
        script.id = RC_ADAPTER_SCRIPT_ID;
        script.src = cfg.adapterUrl;
        script.async = true;
        script.onerror = () => {
          console.warn('[ringcentral] Embeddable adapter failed to load');
          script.remove();
          if (!cancelled) {
            addToast('error', 'RingCentral failed to load', 'Refresh the page or check your network, then try again.');
          }
        };
        document.body.appendChild(script);
      } catch {
        // Widget unavailable (RC disabled / not configured) — fail silently.
      }
    })();

    // 2) Keep the event bridge alive (backend audit). Toast only session end / RC errors.
    const unsubscribe = subscribeRingCentral((event) => {
      if (cancelled) return;
      const t = toastFor(event);
      if (t) addToast(t.type, t.title, t.message);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      const script = document.getElementById(RC_ADAPTER_SCRIPT_ID);
      if (script) script.remove();
      const frame = document.getElementById('rc-widget-adapter-frame');
      if (frame) frame.remove();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      left: '24px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: 'var(--surface)',
          borderLeft: '4px solid var(--danger)',
          padding: '12px 16px',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          minWidth: '280px',
          color: 'var(--text)'
        }}>
          <AlertCircle size={20} color="var(--danger)" />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{t.title}</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{t.message}</div>
          </div>

          <button
            onClick={() => removeToast(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex'
            }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
