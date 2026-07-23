import { describe, expect, it, vi } from 'vitest';
import { installRcConsoleFilter } from './rcConsoleFilter';

describe('installRcConsoleFilter', () => {
  it('drops vendor noise (incl. AGW-401), passes our logs, installs once', () => {
    const logSink = vi.fn();
    const errSink = vi.fn();
    const origLog = console.log;
    const origErr = console.error;
    console.log = logSink;
    console.error = errSink;

    try {
      installRcConsoleFilter();
      const wrappedLog = console.log;
      installRcConsoleFilter(); // idempotent — second install must not re-wrap
      expect(console.log).toBe(wrappedLog);

      console.log('rc-login-status-notify:', true, '+1954*208');
      console.log('rc-webphone-connection-status-notify:', 'connectionStatus-disconnected');
      console.log('[RingCentralExtensions] > WebSocketExtension > install');
      console.log('[WebSocketSubscription] > _obtainSubscription > recovered');
      expect(logSink).not.toHaveBeenCalled();

      // Pre-auth platform probe — string + object shapes the Embeddable dumps.
      console.error('AGW-401 Authorization header is not specified');
      console.error({
        errorCode: 'AGW-401',
        message: 'Authorization header is not specified',
        errors: [{ errorCode: 'AGW-401', message: 'Authorization header is not specified' }],
      });
      expect(errSink).not.toHaveBeenCalled();

      console.log('[inbox] crm_inbox_notification owner mismatch', { a: 1 });
      console.log('plain app log');
      expect(logSink).toHaveBeenCalledTimes(2);

      console.error('[billing] real failure');
      expect(errSink).toHaveBeenCalledTimes(1);
    } finally {
      console.log = origLog;
      console.error = origErr;
      delete (console as Console & { __mytrionRcConsoleFilter?: true }).__mytrionRcConsoleFilter;
    }
  });
});
