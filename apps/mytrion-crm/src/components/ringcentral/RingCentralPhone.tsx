/**
 * Boots RingCentral Embeddable inside Mytrion (floating dialer widget).
 * Credentials come from GET /v1/ringcentral/embed-config — never from VITE_*.
 *
 * Load failures stay silent (no toast): offline backend / disabled flag / adapter CDN
 * blips must not spam the UI. The Embeddable widget surfaces its own dialer chrome.
 */
import { useEffect } from 'react';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';

export function RingCentralPhone() {
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
          // Dead script node would block a later remount from re-injecting.
          script.remove();
        };
        document.body.appendChild(script);
      } catch {
        // Quiet: NETWORK / 404 / disabled — phone simply stays unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
