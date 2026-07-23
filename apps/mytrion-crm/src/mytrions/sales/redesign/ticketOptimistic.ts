/**
 * Optimistic ticket chat bubbles — show the agent's send instantly while Desk POST + thread
 * reconcile run in the background.
 */
import { byTicketMsgTime, type TicketMsgVM } from './live';

export type PendingTicketMsg = { id: string; msg: TicketMsgVM };

function fmtLocalBytes(n: number): string {
  if (n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build the bubble(s) to show immediately for a composer send. */
export function buildPendingMsgs(
  ticketId: string,
  text: string,
  file: File | null,
): PendingTicketMsg[] {
  const stamp = Date.now();
  const out: PendingTicketMsg[] = [];
  if (text) {
    out.push({
      id: `p-c-${stamp}`,
      msg: { from: 'me', type: 'comment', text, time: 'Just now', ts: stamp },
    });
  }
  if (file) {
    out.push({
      id: `p-a-${stamp}`,
      msg: {
        from: 'me',
        type: 'attachment',
        text: '',
        time: 'Just now',
        ts: stamp,
        file: {
          name: file.name,
          size: fmtLocalBytes(file.size),
          attId: '', // not downloadable until Desk reconcile
          ticketId,
        },
      },
    });
  }
  return out;
}

function coveredByServer(pending: TicketMsgVM, server: TicketMsgVM[]): boolean {
  return server.some((s) => {
    if (s.from !== 'me' || s.type !== pending.type) return false;
    if (pending.type === 'attachment') {
      return !!pending.file?.name && s.file?.name === pending.file.name;
    }
    return s.text === pending.text;
  });
}

/**
 * Server thread + any pending sends not yet reflected in Desk, re-sorted chronologically so an
 * optimistic bubble (or a live message that lands mid-send) can never sit out of time order next
 * to Desk messages. Server rows are already sorted; sorting the union keeps them stable.
 */
export function mergeTicketThread(
  server: TicketMsgVM[],
  pending: PendingTicketMsg[],
): TicketMsgVM[] {
  if (!pending.length) return server;
  const extras = pending.filter((p) => !coveredByServer(p.msg, server)).map((p) => p.msg);
  return extras.length ? [...server, ...extras].sort(byTicketMsgTime) : server;
}

/** Drop pending rows that already appear on the server (after reload / WS). */
export function prunePending(
  pending: PendingTicketMsg[],
  server: TicketMsgVM[],
): PendingTicketMsg[] {
  if (!pending.length) return pending;
  return pending.filter((p) => !coveredByServer(p.msg, server));
}
