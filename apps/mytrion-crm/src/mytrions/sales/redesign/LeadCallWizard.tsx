/**
 * Post-call Lead status wizard. When an agent's OUTBOUND, agent-initiated call to a Lead ends
 * (correlated by the dial context's leadId), a FORCED modal appears: the agent must set the Lead
 * `Status` and — for Unqualified / Not Interested — the matching reason picklist before it closes.
 * There is no CRM dependency between the fields (verified), so the Status→reason pairing is enforced
 * here in the UI. Deals never trigger this (their calls only produce a mytrion_calls row).
 *
 * Mounted once at the shell level (LeadCallWizardHost) so it fires no matter which tab the call was
 * started from (Leads kanban, list, or the Lead modal).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeRingCentral } from '@/components/ringcentral/ringcentralEvents';
import { getImpersonation } from '@/api/impersonation';
import { updateLead, type LeadEditFields } from '@/api/dataCenter';
import { s } from './dc';
import { Icon } from './icons';
import { readDcCache } from './dcCache';
import { invalidateDcCache } from './dcCache';
import type { LeadVM } from './dataCenterLive';
import { STATUS_OPTIONS, OUTCOME_OPTIONS, reasonFieldFor, resolveWizardStatus } from './leadStatusFlow';
import { LeadStatusPicker } from './LeadStatusPicker';

// The status picklist + reason logic moved to leadStatusFlow (shared with the manual editor).
// Re-export so existing tests importing reasonFieldFor from this module keep working.
export { reasonFieldFor };

/** The just-ended call as the wizard needs it. */
interface PendingLeadCall {
  leadId: string;
  /** Pre-selected next status from current-status stepping ('' when the lead's status is unknown). */
  preselect: string;
  peer: string;
  result?: string;
  durationMs?: number;
  /** The acted-as agent (admin View-as) whose lead this is — passed to the owner-scoped update. */
  actAsId?: string;
}

function fmtDuration(ms?: number): string {
  const secs = Math.round((ms ?? 0) / 1000);
  if (secs <= 0) return 'no answer';
  const m = Math.floor(secs / 60);
  const rem = secs % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

function LeadCallWizard({
  call,
  lead,
  pushToast,
  onDone,
}: {
  call: PendingLeadCall;
  lead: LeadVM | null;
  pushToast: (title: string, msg: string) => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<string>(call.preselect);
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const reasonSpec = reasonFieldFor(status);
  const valid = status !== '' && (!reasonSpec || reason !== '');

  // Closable: ESC dismisses the wizard (the call is still logged — only the status update is skipped).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onDone();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onDone]);

  const submit = useCallback(async () => {
    if (!valid || busy) return;
    setBusy(true);
    const changes: LeadEditFields = { Status: status };
    if (reasonSpec) changes[reasonSpec.field] = reason;
    if (note.trim()) changes.Description = note.trim();
    try {
      await updateLead(call.leadId, changes, call.actAsId);
      invalidateDcCache('sales:leads');
      pushToast('Lead updated', `Status set to ${STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}`);
      onDone();
    } catch (err: unknown) {
      setBusy(false);
      pushToast("Couldn't update", err instanceof Error ? err.message : 'Try again');
    }
  }, [valid, busy, status, reason, reasonSpec, note, call, pushToast, onDone]);

  const title = lead?.contact && lead.contact !== '—' ? lead.contact : lead?.company || call.peer || 'Lead';

  return (
    <div
      onClick={() => {
        if (!busy) onDone();
      }}
      style={s('position:fixed;inset:0;z-index:150;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,7,14,.58);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)')}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log the call outcome"
        onClick={(e) => e.stopPropagation()}
        style={s('width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}
      >
        {/* Header: the call that just ended */}
        <div style={s('flex-shrink:0;padding:18px 22px;border-bottom:1px solid var(--border)')}>
          <div style={s('display:flex;align-items:center;gap:10px')}>
            <span style={s('width:34px;height:34px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent)')}>
              <Icon name="calls" size={16} />
            </span>
            <div style={s('flex:1;min-width:0')}>
              <div style={s('font-size:15px;font-weight:700')}>Call ended — update {title}</div>
              <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px")}>
                {call.peer} · {fmtDuration(call.durationMs)}{call.result ? ` · ${call.result}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!busy) onDone();
              }}
              aria-label="Close"
              className="ss-ico-btn"
              style={s('flex-shrink:0;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-md);border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer')}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
          <div style={s('font-size:11px;color:var(--muted);margin-top:10px')}>
            Set the lead status to log this call — or close to skip.
          </div>
        </div>

        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:18px 22px;display:flex;flex-direction:column;gap:14px')}>
          {/* Status picker — blueprint-allowed statuses from the lead's current status */}
          <div>
            <div style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>Lead status</div>
            <LeadStatusPicker
              options={OUTCOME_OPTIONS}
              value={status}
              onChange={(v) => {
                setStatus(v);
                setReason(''); // reset the dependent reason when the status changes
              }}
            />
          </div>

          {/* Dependent reason (only for Unqualified / Not Interested) */}
          {reasonSpec && (
            <div>
              <div style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--danger);margin-bottom:8px')}>
                {status === 'Unqualified' ? 'Unqualified reason' : 'Not-interested reason'} — required
              </div>
              <div style={s('display:flex;flex-direction:column;gap:6px')} role="radiogroup" aria-label="Reason">
                {reasonSpec.options.map((r) => {
                  const active = reason === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setReason(r)}
                      style={s(`text-align:left;padding:9px 12px;border-radius:var(--radius-md);border:1px solid ${active ? 'var(--danger)' : 'var(--border)'};background:${active ? 'color-mix(in srgb,var(--danger) 8%,var(--alt))' : 'var(--alt)'};color:${active ? 'var(--danger)' : 'var(--text)'};font-size:12.5px;font-weight:700;cursor:pointer`)}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional note */}
          <div>
            <div style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>Note (optional)</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              rows={3}
              placeholder="Anything worth recording on the lead…"
              className="ss-in"
              style={s('width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box')}
            />
          </div>
        </div>

        <div style={s('flex-shrink:0;padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button
            onClick={() => void submit()}
            disabled={!valid || busy}
            style={s(`display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 20px;border-radius:var(--radius-md);border:none;background:${!valid || busy ? 'var(--muted)' : 'var(--accent)'};color:#fff;font-weight:700;font-size:13px;cursor:${!valid || busy ? 'not-allowed' : 'pointer'};opacity:${!valid || busy ? '.6' : '1'}`)}
          >
            {busy && <Icon name="spinner" size={15} style={{ animation: 'ss-spin .7s linear infinite' }} />}
            {busy ? 'Saving…' : 'Save status'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shell-level host: subscribes to RingCentral call events and, on a finished outbound call tagged
 * with a leadId, opens the forced status wizard for that lead. Mount once in the Sales shell.
 */
export function LeadCallWizardHost({ pushToast }: { pushToast: (title: string, msg: string) => void }) {
  const [pending, setPending] = useState<PendingLeadCall | null>(null);
  // Latest handler for the subscription without re-subscribing on every render.
  const pushRef = useRef(pushToast);
  pushRef.current = pushToast;

  useEffect(() => {
    return subscribeRingCentral((ev) => {
      if (ev.kind !== 'ended') return;
      if (ev.direction && ev.direction !== 'Outbound') return;
      const leadId = ev.leadId;
      if (!leadId) return; // only lead calls open the wizard (deals only log)
      const actAsId = getImpersonation()?.zohoUserId;
      // Gate + auto-advance off the lead's CURRENT status (from the DC leads cache): already-
      // categorized statuses don't force the wizard; calling-phase statuses pre-select the next
      // step (New Lead → First → Second → Third Call, stays at Third).
      const cachedStatus =
        readDcCache<LeadVM[]>(`sales:leads:${actAsId ?? 'self'}`)?.data?.find((l) => l.id === leadId)?.status ??
        null;
      const decision = resolveWizardStatus(cachedStatus);
      if (!decision.show) return; // already-categorized lead → just log the call, no forced wizard
      setPending((cur) =>
        // If a wizard is already open (e.g. a second call event for the same session), keep it.
        cur
          ? cur
          : {
              leadId,
              preselect: decision.preselect,
              peer: ev.peer,
              ...(ev.result ? { result: ev.result } : {}),
              ...(ev.durationMs != null ? { durationMs: ev.durationMs } : {}),
              ...(actAsId ? { actAsId } : {}),
            },
      );
    });
  }, []);

  if (!pending) return null;

  // Resolve the lead's display from the cached Leads list (populated when the agent worked leads).
  const actAs = getImpersonation()?.zohoUserId ?? 'self';
  const cached = readDcCache<LeadVM[]>(`sales:leads:${actAs}`)?.data ?? [];
  const lead = cached.find((l) => l.id === pending.leadId) ?? null;

  return <LeadCallWizard call={pending} lead={lead} pushToast={pushToast} onDone={() => setPending(null)} />;
}
