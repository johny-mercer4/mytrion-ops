/**
 * Retention case detail — centered modal with Phase 1 actions + event trail.
 * Mutations update board + timeline instantly (no refetch wait).
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import { setDialContext } from '@/components/ringcentral/ringcentralEvents';
import type { RetentionCaseEventRow } from '@/api/touchpointTypes';
import { useLoad } from '../../_shared/useLoad';
import { useSales } from './ctx';
import { s } from './dc';
import { Icon } from './icons';
import { RetentionCaseActions } from './RetentionCaseActions';
import {
  cadenceExplain,
  deadlineCaption,
  freqLabel,
  isOverdue,
  loadRetentionCase,
  loadRetentionCaseContact,
  localRetentionEvent,
  logRetentionAttempt,
  quietCaption,
  recordRetentionOutcome,
  statusLabel,
  type RetentionCaseRow,
  type RetentionChannel,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';

interface Props {
  caseId: string;
  /** Board row for instant paint while events fetch from the app DB. */
  seed?: RetentionCaseRow | null;
  onClose: () => void;
  onUpdated: (row: RetentionCaseRow) => void;
}

export function RetentionCaseDetail({ caseId, seed = null, onClose, onUpdated }: Props) {
  const { pushToast } = useSales();
  const detail = useLoad(() => loadRetentionCase(caseId), [caseId]);
  const [liveCase, setLiveCase] = useState<RetentionCaseRow | null>(seed);
  const [liveEvents, setLiveEvents] = useState<RetentionCaseEventRow[]>([]);
  const [eventsHydrated, setEventsHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<RetentionDissatisfactionReason | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [channel, setChannel] = useState<RetentionChannel>('ringcentral');
  const [attemptNote, setAttemptNote] = useState('');
  const [contactPhone, setContactPhone] = useState<string | null>(null);

  const row = liveCase ?? seed;
  const initialLoad = detail.loading && !row;
  const eventsLoading = detail.loading && !eventsHydrated && !!row;

  useEffect(() => {
    setLiveCase(seed);
    setLiveEvents([]);
    setEventsHydrated(false);
    setBusy(false);
    setAttemptNote('');
    setChannel('ringcentral');
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on case switch only

  // Hydrate once from the server. Skip if the agent already mutated (avoids stale overwrite).
  useEffect(() => {
    if (!detail.data || eventsHydrated) return;
    setLiveCase(detail.data.case);
    setLiveEvents(detail.data.events);
    setEventsHydrated(true);
  }, [detail.data, eventsHydrated]);

  useEffect(() => {
    if (row?.dissatisfactionReason) setReason(row.dissatisfactionReason);
    if (row?.reasonNote) setReasonNote(row.reasonNote);
  }, [row?.id, row?.dissatisfactionReason, row?.reasonNote]);

  useEffect(() => {
    let off = false;
    setContactPhone(null);
    void loadRetentionCaseContact(caseId)
      .then((phone) => {
        if (!off) setContactPhone(phone);
      })
      .catch(() => {
        if (!off) setContactPhone(null);
      });
    return () => {
      off = true;
    };
  }, [caseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyUpdate = (
    updated: RetentionCaseRow,
    event: RetentionCaseEventRow,
    toastTitle: string,
    toastBody: string,
  ): void => {
    setLiveCase(updated);
    setLiveEvents((prev) => [event, ...prev.filter((e) => e.id !== event.id)]);
    setEventsHydrated(true);
    onUpdated(updated);
    pushToast(toastTitle, toastBody);
  };

  const act = async (
    outcome: RetentionPhase1Outcome,
    extra?: {
      dissatisfactionReason?: RetentionDissatisfactionReason;
      reasonNote?: string;
    },
  ): Promise<void> => {
    if (busy || !row) return;
    const fromStatus = row.statusCode;
    setBusy(true);
    try {
      const updated = await recordRetentionOutcome(caseId, outcome, extra ?? {});
      applyUpdate(
        updated,
        localRetentionEvent(caseId, {
          fromStatus,
          toStatus: updated.statusCode,
          eventType: 'outcome_recorded',
          notes: statusLabel(updated.statusCode),
        }),
        'Case updated',
        statusLabel(updated.statusCode),
      );
    } catch (e) {
      pushToast('Update failed', e instanceof Error ? e.message : 'Could not record outcome');
    } finally {
      setBusy(false);
    }
  };

  const onDissatisfied = (e: FormEvent): void => {
    e.preventDefault();
    if (!reason) {
      pushToast('Reason required', 'Pick a dissatisfaction reason');
      return;
    }
    if (reason === 'switched_other' && !reasonNote.trim()) {
      pushToast('Note required', 'Add a brief note for Switched / other');
      return;
    }
    const note = reasonNote.trim();
    void act('dissatisfied', {
      dissatisfactionReason: reason,
      ...(note ? { reasonNote: note } : {}),
    });
  };

  const onLogPhoneCall = async (): Promise<void> => {
    if (busy || !row) return;
    setBusy(true);
    const fromStatus = row.statusCode;
    const note = attemptNote.trim() || undefined;
    try {
      if (contactPhone?.trim()) {
        if (row.zohoDealId) setDialContext({ dealId: row.zohoDealId });
        if (clickToDial(contactPhone)) {
          pushToast('Calling via RingCentral', contactPhone);
        } else {
          pushToast('RingCentral not ready', 'Open the phone widget, then try again');
        }
      }
      const updated = await logRetentionAttempt(caseId, 'ringcentral', note);
      const pooled = updated.statusCode === 'p1_open_pool';
      applyUpdate(
        updated,
        localRetentionEvent(caseId, {
          fromStatus,
          toStatus: updated.statusCode,
          eventType: 'comms_attempt',
          channel: 'ringcentral',
          notes: note ?? `RC attempt ${updated.outOfReachAttempts}/5`,
        }),
        'Phone call logged',
        `${updated.outOfReachAttempts}/5${pooled ? ' — sent to Open Pool' : ''}`,
      );
      setAttemptNote('');
    } catch (e) {
      pushToast('Log failed', e instanceof Error ? e.message : 'Could not log call');
    } finally {
      setBusy(false);
    }
  };

  const onLogOtherChannel = async (): Promise<void> => {
    if (busy || !row) return;
    if (channel === 'ringcentral') {
      await onLogPhoneCall();
      return;
    }
    setBusy(true);
    const fromStatus = row.statusCode;
    const note = attemptNote.trim() || undefined;
    try {
      const updated = await logRetentionAttempt(caseId, channel, note);
      const pooled = updated.statusCode === 'p1_open_pool';
      applyUpdate(
        updated,
        localRetentionEvent(caseId, {
          fromStatus,
          toStatus: updated.statusCode,
          eventType: 'comms_attempt',
          channel,
          notes: note ?? `${channel} attempt ${updated.outOfReachAttempts}/5`,
        }),
        'Attempt logged',
        `${updated.outOfReachAttempts}/5${pooled ? ' — sent to Open Pool' : ''}`,
      );
      setAttemptNote('');
    } catch (e) {
      pushToast('Log failed', e instanceof Error ? e.message : 'Could not log attempt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={s(
        'position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,7,14,.58);backdrop-filter:blur(3px)',
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Retention case detail"
        aria-busy={initialLoad}
        onClick={(e) => e.stopPropagation()}
        style={s(
          'width:min(560px,100%);max-height:min(90vh,820px);display:flex;flex-direction:column;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow);overflow:hidden;animation:ss-fadein .18s ease both',
        )}
      >
        <div
          style={s(
            'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0',
          )}
        >
          <div style={s('min-width:0')}>
            {initialLoad ? (
              <>
                <div className="ss-skel" style={s('height:18px;width:55%;margin-bottom:8px')} />
                <div className="ss-skel" style={s('height:12px;width:30%')} />
              </>
            ) : (
              <>
                <div
                  style={s(
                    'font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;letter-spacing:.04em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                  )}
                >
                  {row?.companyName || 'Case'}
                </div>
                <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>
                  {row?.carrierId ?? caseId}
                  {contactPhone ? ` · ${contactPhone}` : ''}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ss-ico-btn"
            aria-label="Close"
            style={s(
              'width:34px;height:34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0',
            )}
          >
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div
          className="ss-scroll"
          style={s('flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column;gap:16px')}
        >
          {detail.error && (
            <div style={s('color:var(--danger);font-size:13px')}>{detail.error}</div>
          )}

          {initialLoad && <DetailSkeleton />}

          {row && (
            <>
              <MetaGrid row={row} />
              <div
                style={s(
                  'padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--alt);font-size:12px;color:var(--muted);line-height:1.45',
                )}
              >
                <strong style={s('color:var(--text2)')}>Log → leave result.</strong> Choose an
                outcome, then log each attempt with stage + result. Returned closes via hourly sync.
              </div>
              {row.isOpen &&
                row.phaseCode === 'phase_1_agent' &&
                row.statusCode !== 'p1_open_pool' && (
                <RetentionCaseActions
                  row={row}
                  busy={busy}
                  contactPhone={contactPhone}
                  reason={reason}
                  reasonNote={reasonNote}
                  channel={channel}
                  attemptNote={attemptNote}
                  setReason={setReason}
                  setReasonNote={setReasonNote}
                  setChannel={setChannel}
                  setAttemptNote={setAttemptNote}
                  onAct={act}
                  onDissatisfied={onDissatisfied}
                  onLogPhoneCall={onLogPhoneCall}
                  onLogOtherChannel={onLogOtherChannel}
                />
              )}
              {row.isOpen && row.phaseCode !== 'phase_1_agent' && (
                <div
                  style={s(
                    'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.45',
                  )}
                >
                  <strong style={s('color:var(--text)')}>Handed to Retention.</strong> Wait 10 BD
                  for a new transaction — closed on fuel; otherwise CITI (timer-driven).
                </div>
              )}
              {row.statusCode === 'p1_open_pool' && (
                <div
                  style={s(
                    'padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.45',
                  )}
                >
                  <strong style={s('color:var(--text)')}>In Sales Open Pool.</strong> Another agent
                  can claim it (max 3 assignments). Claim from the Pool tab.
                </div>
              )}
              {eventsLoading ? (
                <div style={s('display:flex;flex-direction:column;gap:8px')} aria-busy="true">
                  <div className="ss-skel" style={s('height:12px;width:30%')} />
                  <div className="ss-skel" style={s('height:56px')} />
                  <div className="ss-skel" style={s('height:56px')} />
                </div>
              ) : (
                <EventTrail events={liveEvents} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')} aria-hidden="true">
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ss-skel" style={s('height:58px;border-radius:var(--radius-md)')} />
        ))}
      </div>
      <div className="ss-skel" style={s('height:72px;border-radius:var(--radius-md)')} />
      <div className="ss-skel" style={s('height:120px;border-radius:var(--radius-md)')} />
    </div>
  );
}

function MetaGrid({ row }: { row: RetentionCaseRow }) {
  const overdue = isOverdue(row);
  const cells: [string, string, string?][] = [
    ['Status', statusLabel(row.statusCode)],
    ['Frequency', freqLabel(row.transactionFrequency), cadenceExplain(row.transactionFrequency)],
    ['Inactivity', quietCaption(row)],
    ['Deadline', deadlineCaption(row)],
    ['90d gallons', row.gallons90d != null ? Math.round(row.gallons90d).toLocaleString() : '—'],
    ['Call attempts', `${row.outOfReachAttempts}/5`],
    ['Assignment', String(row.assignmentCount)],
    ['Agent', row.agentName || '—'],
  ];
  return (
    <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
      {cells.map(([label, value, hint]) => (
        <div
          key={label}
          style={s(
            'padding:10px 12px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border)',
          )}
          title={hint}
        >
          <div
            style={s(
              'font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)',
            )}
          >
            {label}
          </div>
          <div
            style={s(
              `font-size:13px;font-weight:700;margin-top:4px;color:${label === 'Deadline' && overdue ? 'var(--danger)' : 'var(--text)'}`,
            )}
          >
            {value}
          </div>
          {hint ? (
            <div style={s('font-size:10px;color:var(--faint);margin-top:3px;line-height:1.3')}>{hint}</div>
          ) : null}
        </div>
      ))}
      {row.reasonNote && (
        <div
          style={s(
            'grid-column:1/-1;padding:10px 12px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border)',
          )}
        >
          <div
            style={s(
              'font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)',
            )}
          >
            Note
          </div>
          <div style={s('font-size:13px;margin-top:4px;color:var(--text2);line-height:1.45')}>
            {row.reasonNote}
          </div>
        </div>
      )}
    </div>
  );
}

function EventTrail({ events }: { events: RetentionCaseEventRow[] }) {
  if (events.length === 0) {
    return <div style={s('font-size:12px;color:var(--muted)')}>No events yet.</div>;
  }
  return (
    <div>
      <div
        style={s(
          'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:8px',
        )}
      >
        Timeline
      </div>
      <div style={s('display:flex;flex-direction:column;gap:8px')}>
        {events.map((ev) => (
          <div
            key={ev.id}
            style={s(
              'padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface)',
            )}
          >
            <div style={s('display:flex;justify-content:space-between;gap:8px;font-size:11px')}>
              <span style={s('font-weight:700;color:var(--accent)')}>{ev.eventType}</span>
              <span style={s('color:var(--muted)')}>
                {new Date(ev.occurredAt).toLocaleString()}
              </span>
            </div>
            <div style={s('font-size:12px;color:var(--text2);margin-top:4px')}>
              {ev.fromStatus ? `${statusLabel(ev.fromStatus)} → ` : ''}
              {statusLabel(ev.toStatus)}
              {ev.channel ? ` · ${ev.channel}` : ''}
            </div>
            {ev.notes && (
              <div style={s('font-size:12px;color:var(--muted);margin-top:4px')}>{ev.notes}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
