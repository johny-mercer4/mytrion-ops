/**
 * Boots RingCentral Embeddable inside Mytrion (floating dialer widget).
 * Credentials come from GET /v1/ringcentral/embed-config — never from VITE_*.
 */
import { useEffect, useState, useCallback } from 'react';
import { ApiError } from '@/api/transport';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';
import { X, TriangleAlert, Check, Info } from 'lucide-react';

type ToastTone = 'info' | 'success' | 'error';

interface ToastMsg {
  id: string;
  title: string;
  msg: string;
  tone: ToastTone;
}

export function RingCentralPhone() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const pushToast = useCallback((title: string, msg: string, tone: ToastTone) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, msg, tone }]);
    // Auto-dismiss after 4.5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // PostMessage interception for Call Events
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data.type !== 'string') return;
      
      if (data.type === 'rc-call-ring-notify') {
        const from = data.call?.from || 'Unknown';
        pushToast('Incoming Call', `Ringing from ${from}`, 'info');
      } else if (data.type === 'rc-call-start-notify') {
        const to = data.call?.to || 'Unknown';
        pushToast('Call Started', `Connected to ${to}`, 'success');
      } else if (data.type === 'rc-call-end-notify') {
        pushToast('Call Ended', `The call has finished.`, 'info');
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pushToast]);

  // Load the adapter
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cfg = await fetchRingCentralEmbedConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.adapterUrl) {
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
              pushToast('Phone Error', 'Failed to load RingCentral adapter', 'error');
            }
          };
          document.body.appendChild(script);
        }
      } catch (err) {
        if (cancelled) return;
        // 404 = flag/creds off — quiet. Anything else surfaces briefly.
        if (err instanceof ApiError && err.status === 404) {
          return;
        }
        pushToast('Phone Error', err instanceof Error ? err.message : 'RingCentral unavailable', 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  if (toasts.length === 0) {
    // Embeddable injects its own floating widget UI; we only surface load errors.
    return null;
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 96, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map((toast) => {
        const isErr = toast.tone === 'error';
        const isOk = toast.tone === 'success';
        
        return (
          <div
            key={toast.id}
            role="status"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              padding: '13px 14px 13px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              border: `1px solid ${isErr ? 'color-mix(in srgb,var(--danger) 35%,var(--border))' : isOk ? 'color-mix(in srgb,var(--ok) 35%,var(--border))' : 'var(--border)'}`,
              boxShadow: 'var(--shadow)',
              animation: 'ss-pop .2s both',
              maxWidth: 320,
              color: 'var(--text)',
            }}
          >
            <span style={{ 
              width: 28, height: 28, borderRadius: 'var(--radius-md)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isErr ? 'color-mix(in srgb,var(--danger) 16%,transparent)' : isOk ? 'color-mix(in srgb,var(--ok) 16%,transparent)' : 'color-mix(in srgb,var(--text) 8%,transparent)',
              color: isErr ? 'var(--danger)' : isOk ? 'var(--ok)' : 'var(--text)' 
            }}>
              {isErr ? <TriangleAlert size={16} strokeWidth={2.4} /> : isOk ? <Check size={16} strokeWidth={2.4} /> : <Info size={16} strokeWidth={2.4} />}
            </span>
            <div style={{ minWidth: 0, flex: 1, marginTop: 4 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{toast.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4, marginTop: 3 }}>{toast.msg}</div>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)'
              }}
              aria-label="Dismiss message"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
