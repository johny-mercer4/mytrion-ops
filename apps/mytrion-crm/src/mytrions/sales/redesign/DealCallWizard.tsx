/**
 * Post-call Deal note wizard. When an agent's OUTBOUND call to a Deal ends (correlated by the dial
 * context's dealId), a FORCED modal requires a note before it closes — the note is saved to the deal's
 * Zoho `Description`. Deals have no status flow, so this is note-only; it mirrors the Lead wizard's
 * forced-close pattern (ESC/backdrop nag, no dismiss until saved). Mounted once at the shell level.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeRingCentral } from '@/components/ringcentral/ringcentralEvents';
import { getImpersonation } from '@/api/impersonation';
import { updateDeal } from '@/api/dataCenter';
import { s } from './dc';
import { Icon } from './icons';
import { readDcCache, invalidateDcCache } from './dcCache';
import type { DealVM } from './dataCenterLive';

interface PendingDealCall {
  dealId: string;
  peer: string;
  result?: string;
  durationMs?: number;
  /** The acted-as agent (admin View-as) whose deal this is — passed to the owner-scoped update. */
  actAsId?: string;
}

function fmtDuration(ms?: number): string {
  const secs = Math.round((ms ?? 0) / 1000);
  if (secs <= 0) return 'no answer';
  const m = Math.floor(secs / 60);
  const rem = secs % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

function DealCallWizard({
  call,
  deal,
  pushToast,
  onDone,
}: {
  call: PendingDealCall;
  deal: DealVM | null;
  pushToast: (title: string, msg: string) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const valid = note.trim() !== '';

  // Forced: ESC nags until a note is saved (matches the retention/lead blockClose pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        pushToast('Add a note', 'Enter a note about the call before closing.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pushToast]);

  const submit = useCallback(async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await updateDeal(call.dealId, { Description: note.trim() }, call.actAsId);
      invalidateDcCache('sales:deals');
      pushToast('Deal updated', 'Note saved to the deal.');
      onDone();
    } catch (err: unknown) {
      setBusy(false);
      pushToast("Couldn't save note", err instanceof Error ? err.message : 'Try again');
    }
  }, [valid, busy, note, call, pushToast, onDone]);

  const title = deal?.company || deal?.name || call.peer || 'Deal';

  return (
    <div
      onClick={() => pushToast('Add a note', 'Enter a note about the call before closing.')}
      style={s('position:fixed;inset:0;z-index:150;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,7,14,.58);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)')}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log the deal call note"
        onClick={(e) => e.stopPropagation()}
        style={s('width:100%;max-width:480px;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}
      >
        <div style={s('flex-shrink:0;padding:18px 22px;border-bottom:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:10px')}>
            <span style={s('width:34px;height:34px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent)')}>
              <Icon name="calls" size={16} />
            </span>
            <div style={s('flex:1;min-width:0')}>
              <div style={s('font-size:15px;font-weight:700')}>Call ended — note for {title}</div>
              <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>
                {call.peer} · {fmtDuration(call.durationMs)}{call.result ? ` · ${call.result}` : ''}
              </div>
            </div>
          </div>
          <div style={s('font-size:11px;color:var(--muted);margin-top:10px')}>
            Add a note about this call. Required before you continue.
          </div>
        </div>

        <div style={s('padding:18px 22px')}>
          <div style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>Call note — required</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            rows={4}
            autoFocus
            placeholder="What happened on the call…"
            className="ss-in"
            style={s('width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box')}
          />
        </div>

        <div style={s('flex-shrink:0;padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button
            onClick={() => void submit()}
            disabled={!valid || busy}
            style={s(`display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 20px;border-radius:var(--radius-md);border:none;background:${!valid || busy ? 'var(--muted)' : 'var(--accent)'};color:#fff;font-weight:700;font-size:13px;cursor:${!valid || busy ? 'not-allowed' : 'pointer'};opacity:${!valid || busy ? '.6' : '1'}`)}
          >
            {busy && <Icon name="spinner" size={15} style={{ animation: 'ss-spin .7s linear infinite' }} />}
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shell-level host: on a finished outbound call tagged with a dealId, opens the forced note wizard.
 * Mount once in the Sales shell (beside LeadCallWizardHost).
 */
export function DealCallWizardHost({ pushToast }: { pushToast: (title: string, msg: string) => void }) {
  const [pending, setPending] = useState<PendingDealCall | null>(null);
  const pushRef = useRef(pushToast);
  pushRef.current = pushToast;

  useEffect(() => {
    return subscribeRingCentral((ev) => {
      if (ev.kind !== 'ended') return;
      if (ev.direction && ev.direction !== 'Outbound') return;
      const dealId = ev.dealId;
      if (!dealId) return; // only deal calls open this wizard (leads have their own)
      const actAsId = getImpersonation()?.zohoUserId;
      setPending((cur) =>
        cur
          ? cur
          : {
              dealId,
              peer: ev.peer,
              ...(ev.result ? { result: ev.result } : {}),
              ...(ev.durationMs != null ? { durationMs: ev.durationMs } : {}),
              ...(actAsId ? { actAsId } : {}),
            },
      );
    });
  }, []);

  if (!pending) return null;

  // Resolve the deal's display from the cached Deals list (populated when the agent worked deals).
  const actAs = getImpersonation()?.zohoUserId ?? 'self';
  const cached = readDcCache<DealVM[]>(`sales:deals:${actAs}`)?.data ?? [];
  const deal = cached.find((d) => d.id === pending.dealId) ?? null;

  return <DealCallWizard call={pending} deal={deal} pushToast={pushToast} onDone={() => setPending(null)} />;
}
