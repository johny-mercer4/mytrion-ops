const startedAt = Date.now();
let lastPollSuccessAt = 0;
let lastPollFailureAt = 0;
let lastPollError = '';
export type GatewayLeaseState = 'disabled' | 'leader' | 'standby' | 'unavailable';
let leaseState: GatewayLeaseState = 'disabled';
let lastLeaseSuccessAt = 0;
let lastLeaseError = '';

export function noteGatewayLeaseState(state: GatewayLeaseState, error?: unknown): void {
  leaseState = state;
  if (error === undefined) {
    lastLeaseSuccessAt = Date.now();
    lastLeaseError = '';
  } else {
    lastLeaseError = error instanceof Error ? error.name : String(error);
  }
}

export function noteTelegramPollSuccess(): void {
  lastPollSuccessAt = Date.now();
  lastPollError = '';
}

export function noteTelegramPollFailure(error: unknown): void {
  lastPollFailureAt = Date.now();
  lastPollError = error instanceof Error ? error.name : 'TELEGRAM_POLL_ERROR';
}

export function runtimeHealthSnapshot(now = Date.now()): {
  ok: boolean;
  telegramPolling: {
    lastSuccessAgeMs: number | null;
    lastFailureAgeMs: number | null;
    lastError: string | null;
  };
  leadership: {
    state: GatewayLeaseState;
    lastSuccessAgeMs: number | null;
    lastError: string | null;
  };
} {
  const startupGrace = now - startedAt <= 90_000;
  const lastSuccessAgeMs = lastPollSuccessAt ? now - lastPollSuccessAt : null;
  const pollingOk = startupGrace || (lastSuccessAgeMs !== null && lastSuccessAgeMs <= 120_000);
  const ok = leaseState === 'standby'
    ? true
    : leaseState === 'unavailable'
      ? startupGrace
      : pollingOk;
  return {
    ok,
    telegramPolling: {
      lastSuccessAgeMs,
      lastFailureAgeMs: lastPollFailureAt ? now - lastPollFailureAt : null,
      lastError: lastPollError || null,
    },
    leadership: {
      state: leaseState,
      lastSuccessAgeMs: lastLeaseSuccessAt ? now - lastLeaseSuccessAt : null,
      lastError: lastLeaseError || null,
    },
  };
}
