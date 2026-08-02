import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { backendErrorInfo, supportBotHeaders } from './octaneClient.js';
import { noteGatewayLeaseState, type GatewayLeaseState } from './runtimeHealth.js';

interface LeaseResponse {
  acquired: boolean;
  fencingToken: number;
  expiresAt: number;
}

export interface GatewayLeaderLease {
  isLeader(): boolean;
  readonly pollSignal: AbortSignal;
  waitForLeadership(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function postLease(
  path: 'acquire' | 'release',
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.octaneBase}/v1/support-bot/gateway-lease/${path}`, {
    method: 'POST',
    headers: supportBotHeaders(true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(backendErrorInfo(payload, response.status).message);
  return payload;
}

function parseAcquire(payload: Record<string, unknown>): LeaseResponse {
  const acquired = payload['acquired'];
  const fencingToken = Number(payload['fencingToken']);
  const expiresAt = Date.parse(String(payload['expiresAt'] ?? ''));
  if (
    typeof acquired !== 'boolean' ||
    !Number.isSafeInteger(fencingToken) ||
    fencingToken <= 0 ||
    !Number.isFinite(expiresAt)
  ) {
    throw new Error('Backend returned a malformed gateway lease');
  }
  return { acquired, fencingToken, expiresAt };
}

/** Start renewable leader election. Disabled in local development unless explicitly enabled. */
export async function startGatewayLeaderLease(): Promise<GatewayLeaderLease> {
  // A configured instance label may be shared by rolling-deploy processes. Always append a
  // process-unique nonce so two live pollers can never renew as the same lease holder.
  const holderNonce = `${process.pid}:${randomUUID()}`;
  const holderLabel = (process.env['GATEWAY_INSTANCE_ID'] ?? hostname()).slice(
    0,
    Math.max(1, 199 - holderNonce.length),
  );
  const holderId = `${holderLabel}:${holderNonce}`;
  let leader = !config.gatewayLeaseEnabled;
  let fencingToken = 0;
  let expiresAt = leader ? Number.MAX_SAFE_INTEGER : 0;
  let stopped = false;
  let renewInFlight: Promise<void> | null = null;
  let pollController = new AbortController();
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  if (!leader) pollController.abort();
  noteGatewayLeaseState(leader ? 'disabled' : 'unavailable');

  const setState = (state: GatewayLeaseState, error?: unknown): void => {
    if (state !== 'leader' && leader) pollController.abort();
    if (state === 'leader' && (!leader || pollController.signal.aborted)) {
      pollController = new AbortController();
    }
    leader = state === 'leader' || state === 'disabled';
    noteGatewayLeaseState(state, error);
  };

  const scheduleExpiry = (): void => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const expectedExpiry = expiresAt;
    expiryTimer = setTimeout(() => {
      if (!stopped && expiresAt === expectedExpiry && Date.now() >= expiresAt) {
        setState('unavailable', new Error('gateway lease expired'));
      }
    }, Math.max(1, expiresAt - Date.now()));
    expiryTimer.unref();
  };

  const renew = async (): Promise<void> => {
    if (!config.gatewayLeaseEnabled || stopped) return;
    if (renewInFlight) return renewInFlight;
    renewInFlight = (async () => {
      const requestStartedAt = Date.now();
      try {
        const result = parseAcquire(await postLease('acquire', {
          botIdentity: config.botIdentity,
          holderId,
          ttlSeconds: config.gatewayLeaseTtlSeconds,
        }));
        fencingToken = result.fencingToken;
        if (result.acquired) {
          // Use a conservative local deadline measured from request start. Comparing the DB's
          // absolute timestamp with a skewed container clock can otherwise create two pollers.
          expiresAt = requestStartedAt + config.gatewayLeaseTtlSeconds * 1_000;
          setState('leader');
          scheduleExpiry();
        } else {
          if (expiryTimer) clearTimeout(expiryTimer);
          expiryTimer = null;
          setState('standby');
        }
      } catch (error) {
        if (leader && Date.now() < expiresAt) noteGatewayLeaseState('leader', error);
        else setState('unavailable', error);
      }
    })().finally(() => {
      renewInFlight = null;
    });
    return renewInFlight;
  };

  await renew();
  const renewTimer = setInterval(() => void renew(), config.gatewayLeaseRenewMs);
  renewTimer.unref();

  return {
    isLeader: () => leader && Date.now() < expiresAt,
    get pollSignal() {
      return pollController.signal;
    },
    async waitForLeadership(signal: AbortSignal): Promise<void> {
      while (!stopped && !signal.aborted && !(leader && Date.now() < expiresAt)) {
        await renew();
        if (!leader) await wait(Math.min(config.gatewayLeaseRenewMs, 2_000), signal);
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(renewTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      const releaseToken = fencingToken;
      const wasLeader = leader;
      pollController.abort();
      leader = false;
      if (config.gatewayLeaseEnabled && wasLeader && releaseToken > 0) {
        await postLease('release', {
          botIdentity: config.botIdentity,
          holderId,
          fencingToken: releaseToken,
        }).catch(() => undefined);
      }
    },
  };
}
