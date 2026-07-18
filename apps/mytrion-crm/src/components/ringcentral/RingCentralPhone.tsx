import { useEffect, useState } from 'react';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';
import { subscribeRingCentral, type RingCentralCallEvent } from './ringcentralEvents';
import { X, Info, CheckCircle, AlertCircle } from 'lucide-react';

type ToastType = 'info' | 'success' | 'error';
interface ToastMsg {
  id: number;
  type: ToastType;
  title: string;
  message: string;
}

let toastId = 0;

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Map a normalized call event to a toast, or null for events we don't surface. */
function toastFor(e: RingCentralCallEvent): { type: ToastType; title: string; message: string } | null {
  const peer = e.peer || 'Unknown number';
  switch (e.kind) {
    case 'login':
      return { type: 'success', title: 'RingCentral connected', message: e.peer ? `Signed in as ${e.peer}` : 'Signed in.' };
    case 'logout':
      return { type: 'info', title: 'RingCentral signed out', message: 'Open the phone widget to sign back in.' };
    case 'ringing':
      return e.direction === 'Outbound'
        ? { type: 'info', title: 'Dialing…', message: peer }
        : { type: 'info', title: 'Incoming call', message: `From ${peer}` };
    case 'connected':
      return { type: 'success', title: 'Call connected', message: peer };
    case 'ended': {
      const parts = [peer];
      if (e.durationMs !== undefined) parts.push(fmtDuration(e.durationMs));
      if (e.result) parts.push(e.result);
      return { type: 'info', title: 'Call ended', message: parts.join(' · ') };
    }
    default:
      return null;
  }
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

        const script = document.createElement('script');
        script.id = RC_ADAPTER_SCRIPT_ID;
        script.src = cfg.adapterUrl;
        script.async = true;
        // Stay quiet on load failure — never toast Phone/backend load errors (matches dial sites).
        script.onerror = () => {
          console.warn('[ringcentral] Embeddable adapter failed to load');
          script.remove();
        };
        document.body.appendChild(script);
      } catch {
        // Widget unavailable (RC disabled / not configured) — fail silently.
      }
    })();

    // 2) Surface normalized call-lifecycle + sign-in events (also captured server-side by the bridge).
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
          borderLeft: `4px solid ${t.type === 'error' ? 'var(--danger)' : t.type === 'success' ? 'var(--success)' : 'var(--accent)'}`,
          padding: '12px 16px',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          minWidth: '280px',
          color: 'var(--text)'
        }}>
          {t.type === 'error' && <AlertCircle size={20} color="var(--danger)" />}
          {t.type === 'success' && <CheckCircle size={20} color="var(--success)" />}
          {t.type === 'info' && <Info size={20} color="var(--accent)" />}

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
