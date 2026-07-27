/**
 * Dial-context correlation: which Lead / Deal / retention case an outbound call belongs to.
 *
 * This is the hinge the whole post-call chain hangs off — the forced Lead status wizard, the
 * mytrion_calls row, and the Mytrion_Call_Attempts bump all key off the id carried on the `ended`
 * event. A call that ends without one is silently dropped everywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postCallEvent = vi.fn(async (_payload: Record<string, unknown>) => undefined);
vi.mock('@/api/ringcentral', () => ({
  postRingCentralCallEvent: (payload: unknown) => postCallEvent(payload as Record<string, unknown>),
}));

/** Stand in for the Embeddable iframe so isFromRcWidget() trusts our synthetic messages. */
function installFakeWidget(): Window {
  const frame = document.createElement('iframe');
  frame.id = 'rc-widget-adapter-frame';
  frame.src = 'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/app.html';
  document.body.appendChild(frame);
  return frame.contentWindow as Window;
}

/** Deliver a widget postMessage exactly as the real listener would receive it. */
function widgetMessage(source: Window, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin: 'https://apps.ringcentral.com' }));
}

const ringing = (sessionId: string) => ({
  type: 'rc-active-call-notify',
  call: { sessionId, direction: 'Outbound', to: '+15551234567', telephonyStatus: 'Ringing' },
});
const connected = (sessionId: string) => ({
  type: 'rc-active-call-notify',
  call: { sessionId, direction: 'Outbound', to: '+15551234567', telephonyStatus: 'CallConnected' },
});
const ended = (sessionId: string) => ({
  type: 'rc-call-end-notify',
  call: { sessionId, direction: 'Outbound', to: '+15551234567', telephonyStatus: 'NoCall' },
});

let events: Array<Record<string, unknown>>;
let widget: Window;
let unsubscribe: () => void;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  postCallEvent.mockClear();
  document.body.innerHTML = '';
  widget = installFakeWidget();
  events = [];
  const mod = await import('./ringcentralEvents');
  unsubscribe = mod.subscribeRingCentral((e) => events.push(e as unknown as Record<string, unknown>));
  mod.setDialContext({ leadId: 'LEAD1' });
});

afterEach(() => {
  unsubscribe?.();
  vi.useRealTimers();
});

describe('outbound call → lead correlation', () => {
  it('tags a short call that ends within the dial window', () => {
    widgetMessage(widget, ringing('s1'));
    widgetMessage(widget, connected('s1'));
    vi.advanceTimersByTime(5_000);
    widgetMessage(widget, ended('s1'));

    const end = events.find((e) => e.kind === 'ended');
    expect(end?.leadId).toBe('LEAD1');
  });

  it('still tags a call that lasts longer than the dial-context TTL', () => {
    widgetMessage(widget, ringing('s1'));
    widgetMessage(widget, connected('s1'));
    // A perfectly ordinary sales call. The dial context TTL is 30s from the CLICK, so re-reading it
    // at hang-up time loses the lead and the post-call wizard never opens.
    vi.advanceTimersByTime(4 * 60_000);
    widgetMessage(widget, ended('s1'));

    const end = events.find((e) => e.kind === 'ended');
    expect(end?.leadId).toBe('LEAD1');
  });

  it('forwards the id to the backend on the ended event', () => {
    widgetMessage(widget, ringing('s1'));
    widgetMessage(widget, connected('s1'));
    vi.advanceTimersByTime(3 * 60_000);
    widgetMessage(widget, ended('s1'));

    const posted = postCallEvent.mock.calls.map(([p]) => p);
    expect(posted.find((p) => p.kind === 'ended')?.leadId).toBe('LEAD1');
  });

  it('does not leak one call’s lead onto a later, untagged call', async () => {
    widgetMessage(widget, ringing('s1'));
    widgetMessage(widget, ended('s1'));

    // Agent takes/places an unrelated call long after, with no dial click in between.
    vi.advanceTimersByTime(10 * 60_000);
    widgetMessage(widget, ringing('s2'));
    widgetMessage(widget, ended('s2'));

    const second = events.filter((e) => e.sessionId === 's2').find((e) => e.kind === 'ended');
    expect(second?.leadId).toBeUndefined();
  });
});
