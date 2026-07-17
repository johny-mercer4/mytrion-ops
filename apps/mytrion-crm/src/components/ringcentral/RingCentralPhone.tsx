import { useEffect, useState } from 'react';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';
import { X, Info, CheckCircle, AlertCircle } from 'lucide-react';

type ToastType = 'info' | 'success' | 'error';
interface ToastMsg {
  id: number;
  type: ToastType;
  title: string;
  message: string;
}

let toastId = 0;

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

    void (async () => {
      try {
        const cfg = await fetchRingCentralEmbedConfig();
        if (cancelled || !cfg.enabled || !cfg.adapterUrl) return;
        if (document.getElementById(RC_ADAPTER_SCRIPT_ID)) return;

        const script = document.createElement('script');
        script.id = RC_ADAPTER_SCRIPT_ID;
        script.src = cfg.adapterUrl;
        script.async = true;
        script.onerror = () => {
          addToast('error', 'Phone Failed', 'Could not load RingCentral Embeddable widget.');
          script.remove();
        };
        document.body.appendChild(script);
      } catch (err) {
        // quiet fail
      }
    })();

    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data.type !== 'string') return;
      
      if (data.type === 'rc-call-ring-notify') {
        addToast('info', 'Incoming Call', `Call ringing from: ${data.call?.from || 'Unknown'}`);
      } else if (data.type === 'rc-call-start-notify') {
        addToast('success', 'Call Started', `Call started with: ${data.call?.to || data.call?.from || 'Unknown'}`);
      } else if (data.type === 'rc-call-end-notify') {
        addToast('info', 'Call Ended', 'Call ended.');
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      cancelled = true;
      window.removeEventListener('message', handleMessage);
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
