import { describe, expect, it, vi } from 'vitest';
import { installRcConsoleFilter } from './rcConsoleFilter';

describe('installRcConsoleFilter', () => {
  it('drops vendor noise, passes our logs, never touches warn/error, installs once', () => {
    const sink = vi.fn();
    // Pre-wrap so the filter binds onto OUR spy as the "original".
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = sink;

    try {
      installRcConsoleFilter();
      const wrapped = console.log;
      installRcConsoleFilter(); // idempotent — second install must not re-wrap
      expect(console.log).toBe(wrapped);

      console.log('rc-login-status-notify:', true, '+1954*208');
      console.log('rc-webphone-connection-status-notify:', 'connectionStatus-disconnected');
      console.log('[RingCentralExtensions] > WebSocketExtension > install');
      console.log('[WebSocketSubscription] > _obtainSubscription > recovered');
      expect(sink).not.toHaveBeenCalled();

      console.log('[inbox] crm_inbox_notification owner mismatch', { a: 1 });
      console.log('plain app log');
      expect(sink).toHaveBeenCalledTimes(2);

      // warn is not wrapped at all.
      expect(console.warn).toBe(origWarn);
    } finally {
      console.log = origLog;
      delete (console as Console & { __mytrionRcConsoleFilter?: true }).__mytrionRcConsoleFilter;
    }
  });
});
