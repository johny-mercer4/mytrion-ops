/**
 * RingCentral Embeddable → app event bridge for Sales Mytrion.
 *
 * The Embeddable widget streams telephony state over `window.postMessage`. This module owns a single
 * listener that normalizes those raw events into one {@link RingCentralCallEvent}, de-duplicates the
 * repeats Embeddable emits for a given phase, computes talk duration, tags outbound calls with the
 * Data Center lead/deal they were dialed from, forwards every event to the ops backend for the audit
 * trail, and fans out to UI subscribers (toasts / sign-in badge).
 *
 * Event contract: https://ringcentral.github.io/ringcentral-embeddable/docs/integration/events/
 *   rc-login-status-notify · rc-active-call-notify · rc-ringout-call-notify · rc-call-end-notify
 */
import { postRingCentralCallEvent, type RingCentralCallEventPayload } from '@/api/ringcentral';

export type RingCentralEventKind = RingCentralCallEventPayload['kind'];

export interface RingCentralCallEvent extends RingCentralCallEventPayload {
  /** The other party's number — the callee for outbound, the caller for inbound. */
  peer: string;
  /** Epoch ms when we observed the event (UI-only; the backend stamps its own audit time). */
  at: number;
}

type Listener = (event: RingCentralCallEvent) => void;

interface RawParty {
  phoneNumber?: string;
}
interface RawCall {
  id?: string;
  sessionId?: string;
  direction?: string;
  from?: string | RawParty;
  to?: string | RawParty;
  telephonyStatus?: string;
  result?: string;
  startTime?: string | number;
}
interface WidgetMessage {
  type?: string;
  call?: RawCall;
  loggedIn?: boolean;
  loginNumber?: string;
}

const listeners = new Set<Listener>();
/** sessionId → last phase we already emitted, so a repeated same-phase notify is ignored. */
const lastKind = new Map<string, RingCentralEventKind>();
/** sessionId → epoch ms the call connected, for a reliable talk-duration on end. */
const connectedAt = new Map<string, number>();
let started = false;
let loginState: boolean | null = null;

/** Outbound calls are tagged with the lead/deal they were dialed from within this window. */
const DIAL_CTX_TTL_MS = 30_000;
let dialContext: { leadId?: string; dealId?: string; at: number } | null = null;

/** Record which Data Center entity the next outbound call belongs to (call right before dialing). */
export function setDialContext(ctx: { leadId?: string; dealId?: string }): void {
  dialContext = { ...ctx, at: Date.now() };
}

function freshDialContext(): { leadId?: string; dealId?: string } {
  if (!dialContext || Date.now() - dialContext.at > DIAL_CTX_TTL_MS) return {};
  const { leadId, dealId } = dialContext;
  return { ...(leadId ? { leadId } : {}), ...(dealId ? { dealId } : {}) };
}

function numOf(v: string | RawParty | undefined): string {
  if (!v) return '';
  return typeof v === 'string' ? v : (v.phoneNumber ?? '');
}

/** Map RingCentral `telephonyStatus` to our coarse call phase (null = not a phase we surface). */
function statusToKind(status: string | undefined): RingCentralEventKind | null {
  switch (status) {
    case 'Ringing':
      return 'ringing';
    case 'CallConnected':
    case 'OnHold':
      return 'connected';
    case 'NoCall':
      return 'ended';
    default:
      return null;
  }
}

function startMsOf(call: RawCall): number {
  if (typeof call.startTime === 'number') return call.startTime;
  if (typeof call.startTime === 'string') {
    const parsed = Date.parse(call.startTime);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function buildCallEvent(kind: RingCentralEventKind, call: RawCall, sessionId: string): RingCentralCallEvent {
  const from = numOf(call.from);
  const to = numOf(call.to);
  const direction =
    call.direction === 'Inbound' || call.direction === 'Outbound' ? call.direction : undefined;
  const peer = direction === 'Outbound' ? to || from : from || to;

  let durationMs: number | undefined;
  if (kind === 'ended') {
    const connected = sessionId ? connectedAt.get(sessionId) : undefined;
    const start = connected ?? startMsOf(call);
    if (start) durationMs = Math.max(0, Date.now() - start);
  }

  return {
    kind,
    at: Date.now(),
    peer,
    ...(sessionId ? { sessionId } : {}),
    ...(direction ? { direction } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(call.telephonyStatus ? { telephonyStatus: call.telephonyStatus } : {}),
    ...(call.result ? { result: call.result } : {}),
    ...(typeof call.startTime === 'string' ? { startTime: call.startTime } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(direction === 'Outbound' ? freshDialContext() : {}),
  };
}

function emit(event: RingCentralCallEvent): void {
  for (const listener of Array.from(listeners)) {
    // One bad subscriber must not stop the others — or the backend capture below.
    try {
      listener(event);
    } catch {
      /* ignore */
    }
  }
  const { peer: _peer, at: _at, ...payload } = event;
  void postRingCentralCallEvent(payload).catch(() => {});
}

function handleCall(kind: RingCentralEventKind, call: RawCall): void {
  const sessionId = call.sessionId ?? call.id ?? '';
  if (sessionId) {
    if (lastKind.get(sessionId) === kind) return; // same phase already surfaced
    lastKind.set(sessionId, kind);
    if (kind === 'connected') connectedAt.set(sessionId, Date.now());
  }
  emit(buildCallEvent(kind, call, sessionId));
  if (kind === 'ended' && sessionId) {
    lastKind.delete(sessionId);
    connectedAt.delete(sessionId);
  }
}

function onMessage(e: MessageEvent): void {
  const data = e.data as WidgetMessage | null;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

  switch (data.type) {
    case 'rc-login-status-notify': {
      const isIn = Boolean(data.loggedIn);
      if (loginState === isIn) return; // ignore repeats
      loginState = isIn;
      emit({
        kind: isIn ? 'login' : 'logout',
        at: Date.now(),
        peer: data.loginNumber ?? '',
        ...(data.loginNumber ? { from: data.loginNumber } : {}),
      });
      return;
    }
    case 'rc-active-call-notify':
    case 'rc-ringout-call-notify': {
      if (!data.call) return;
      const kind = statusToKind(data.call.telephonyStatus);
      if (kind) handleCall(kind, data.call);
      return;
    }
    case 'rc-call-end-notify': {
      if (data.call) handleCall('ended', data.call);
      return;
    }
    default:
  }
}

/**
 * Subscribe to normalized RingCentral events. The first subscriber attaches the singleton window
 * listener (kept for the app's lifetime); unsubscribing only detaches that one callback. Backend
 * capture happens inside {@link emit} regardless of how many UI subscribers there are.
 */
export function subscribeRingCentral(listener: Listener): () => void {
  listeners.add(listener);
  if (!started) {
    window.addEventListener('message', onMessage);
    started = true;
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Current known sign-in state (null until the widget first reports it). */
export function ringCentralLoginState(): boolean | null {
  return loginState;
}
