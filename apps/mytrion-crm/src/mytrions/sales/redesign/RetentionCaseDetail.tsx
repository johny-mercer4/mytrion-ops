/**
 * Retention case modal — call-first Phase 1:
 *   New → call → stage → (OoR) channel attempts → terminal stages close modal.
 * RingCentral call-end auto-logs an attempt while OoR; New→OoR after a call counts attempt 1.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import {
  setDialContext,
  subscribeRingCentral,
} from '@/components/ringcentral/ringcentralEvents';
import type { RetentionCaseEventRow } from '@/api/touchpointTypes';
import { useLoad } from '../../_shared/useLoad';
import { useSales } from './ctx';
import { s } from './dc';
import {
  RetentionCaseActions,
  type NewWizardStep,
  type PendingCallLog,
  type StatusPick,
} from './RetentionCaseActions';
import {
  RetentionCaseHeader,
  RetentionDetailSkeleton,
  RetentionEventTrail,
  RetentionInactivityBlock,
  RetentionMetaGrid,
} from './RetentionCaseMeta';
import {
  attemptEvent,
  bumpAttempts,
  isNewStatus,
  optimisticOutOfReach,
  pendingRcNote,
} from './retentionCaseActionsLogic';
import {
  fileToEvidenceDataUrl,
  formatUsPhone,
  loadRetentionCase,
  loadRetentionCaseContact,
  localRetentionEvent,
  logRetentionAttempt,
  recordRetentionOutcome,
  statusLabel,
  type RetentionCaseRow,
  type RetentionChannel,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';

interface Props {
  caseId: string;
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
  const [channel, setChannel] = useState<RetentionChannel>('telegram');
  const [attemptNote, setAttemptNote] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState<string | null>(seed?.contactPhone ?? null);
  const [phoneLoading, setPhoneLoading] = useState(!seed?.contactPhone?.trim());
  const [awaitingCallEnd, setAwaitingCallEnd] = useState(false);
  const [pendingCall, setPendingCall] = useState<PendingCallLog | null>(null);
  const [statusPick, setStatusPick] = useState<StatusPick>('');
  const [newWizardStep, setNewWizardStep] = useState<NewWizardStep>('call');

  const row = liveCase ?? seed;
  const rowRef = useRef(row);
  const busyRef = useRef(busy);
  const awaitingRef = useRef(awaitingCallEnd);
  const logRcRef = useRef<(call: PendingCallLog | null) => Promise<boolean>>(async () => false);
  rowRef.current = row;
  busyRef.current = busy;
  awaitingRef.current = awaitingCallEnd;

  const initialLoad = detail.loading && !row;
  const eventsLoading = detail.loading && !eventsHydrated && !!row;
  const forceStage = pendingCall != null && !!row && isNewStatus(row.statusCode);
  const forceAttempt = pendingCall != null && row?.statusCode === 'p1_out_of_reach';
  const blockClose = forceStage || forceAttempt;
  const phoneDisplay = formatUsPhone(contactPhone) || contactPhone?.trim() || '';

  useEffect(() => {
    setLiveCase(seed);
    setLiveEvents([]);
    setEventsHydrated(false);
    setBusy(false);
    setAttemptNote('');
    setChannel('telegram');
    setEvidenceFile(null);
    setEvidencePreview(null);
    setAwaitingCallEnd(false);
    setPendingCall(null);
    setStatusPick('');
    setNewWizardStep('call');
    const seeded = seed?.contactPhone?.trim() || null;
    setContactPhone(seeded);
    setPhoneLoading(!seeded);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on case switch only

  useEffect(() => {
    if (!detail.data || eventsHydrated) return;
    setLiveCase(detail.data.case);
    setLiveEvents(detail.data.events);
    setEventsHydrated(true);
    const fromCase =
      detail.data.case.contactPhone?.trim() || detail.data.contactPhone?.trim() || null;
    if (fromCase) {
      setContactPhone(fromCase);
      setPhoneLoading(false);
    }
  }, [detail.data, eventsHydrated]);

  useEffect(() => {
    if (row?.dissatisfactionReason) setReason(row.dissatisfactionReason);
    if (row?.reasonNote) setReasonNote(row.reasonNote);
  }, [row?.id, row?.dissatisfactionReason, row?.reasonNote]);

  // Instant path: denormalized phone on the case. Fallback: lazy DWH for older rows.
  useEffect(() => {
    const fromRow = row?.contactPhone?.trim() || null;
    if (fromRow) {
      setContactPhone(fromRow);
      setPhoneLoading(false);
      return;
    }
    let off = false;
    setPhoneLoading(true);
    void loadRetentionCaseContact(caseId)
      .then((phone) => {
        if (off) return;
        setContactPhone(phone);
        setPhoneLoading(false);
      })
      .catch(() => {
        if (off) return;
        setContactPhone(null);
        setPhoneLoading(false);
      });
    return () => {
      off = true;
    };
  }, [caseId, row?.contactPhone]);

  useEffect(() => {
    if (!evidenceFile) {
      setEvidencePreview(null);
      return;
    }
    const url = URL.createObjectURL(evidenceFile);
    setEvidencePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [evidenceFile]);

  useEffect(() => {
    return subscribeRingCentral((ev) => {
      if (ev.kind !== 'ended') return;
      if (ev.direction && ev.direction !== 'Outbound') return;
      const forThisCase =
        ev.retentionCaseId === caseId || (awaitingRef.current && !ev.retentionCaseId);
      if (!forThisCase) return;
      setAwaitingCallEnd(false);
      const call: PendingCallLog = {
        peer: ev.peer,
        ...(ev.sessionId ? { sessionId: ev.sessionId } : {}),
        ...(ev.result ? { result: ev.result } : {}),
        ...(ev.durationMs != null ? { durationMs: ev.durationMs } : {}),
      };
      setPendingCall(call);
      setChannel('ringcentral');
      const cur = rowRef.current;
      if (!cur) return;
      if (cur.statusCode === 'p1_out_of_reach') {
        void logRcRef.current(call);
        return;
      }
      if (isNewStatus(cur.statusCode)) setNewWizardStep('stage');
    });
  }, [caseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (blockClose) {
        pushToast(
          forceAttempt ? 'Retry the call log' : 'Pick a stage',
          forceAttempt
            ? 'RingCentral attempt did not save — retry'
            : 'Choose Out of Reach, Reached, Dissatisfied, or Vacation',
        );
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, blockClose, forceAttempt, pushToast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (!row?.isOpen || row.phaseCode !== 'phase_1_agent') return;
      if (row.statusCode !== 'p1_out_of_reach') return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        setEvidenceFile(file);
        pushToast('Screenshot pasted', file.name || 'clipboard image');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [row?.isOpen, row?.phaseCode, row?.statusCode, pushToast]);

  const requestClose = (): void => {
    if (forceAttempt) {
      pushToast('Retry the call log', 'RingCentral attempt did not save — retry');
      return;
    }
    if (forceStage) {
      pushToast('Pick a stage', 'Call ended — choose a stage before closing');
      return;
    }
    onClose();
  };

  const applyUpdate = (
    updated: RetentionCaseRow,
    events: RetentionCaseEventRow | RetentionCaseEventRow[],
    toastTitle: string,
    toastBody: string,
  ): void => {
    const list = Array.isArray(events) ? events : [events];
    setLiveCase(updated);
    setLiveEvents((prev) => {
      const ids = new Set(list.map((e) => e.id));
      return [...list, ...prev.filter((e) => !ids.has(e.id))];
    });
    setEventsHydrated(true);
    onUpdated(updated);
    pushToast(toastTitle, toastBody);
  };

  const clearAttemptUi = (opts?: { keepStage?: boolean }): void => {
    setPendingCall(null);
    setAwaitingCallEnd(false);
    setAttemptNote('');
    setEvidenceFile(null);
    setChannel('telegram');
    // After every attempt, surface the stage picker with OoR pre-selected.
    setStatusPick(opts?.keepStage ? 'out_of_reach' : '');
  };

  const logRcAttempt = async (call: PendingCallLog | null = pendingCall): Promise<boolean> => {
    const cur = rowRef.current;
    if (!cur || busyRef.current || cur.statusCode !== 'p1_out_of_reach') return false;
    const fromStatus = cur.statusCode;
    const note = pendingRcNote(call);
    setBusy(true);
    const optimistic = bumpAttempts(cur);
    setLiveCase(optimistic);
    onUpdated(optimistic);
    try {
      const updated = await logRetentionAttempt(caseId, 'ringcentral', note);
      const pooled = updated.statusCode === 'p1_open_pool';
      applyUpdate(
        updated,
        attemptEvent(caseId, fromStatus, updated, 'ringcentral', note),
        pooled ? 'Sent to Open Pool' : 'RingCentral attempt logged',
        pooled
          ? '5 attempts — Ryan + deal owner notified'
          : `${updated.outOfReachAttempts}/5 · choose stage below`,
      );
      clearAttemptUi({ keepStage: !pooled });
      if (pooled) onClose();
      return true;
    } catch (e) {
      setLiveCase(cur);
      onUpdated(cur);
      pushToast('Log failed', e instanceof Error ? e.message : 'Could not log call');
      return false;
    } finally {
      setBusy(false);
    }
  };
  logRcRef.current = logRcAttempt;

  const act = async (
    outcome: RetentionPhase1Outcome,
    extra?: {
      dissatisfactionReason?: RetentionDissatisfactionReason;
      reasonNote?: string;
    },
    opts?: { close?: boolean },
  ): Promise<void> => {
    if (busy || !row || forceAttempt) return;
    const fromStatus = row.statusCode;
    const callForAttempt = outcome === 'out_of_reach' ? pendingCall : null;
    setBusy(true);
    if (outcome === 'out_of_reach') {
      const optimistic = optimisticOutOfReach(row, !!callForAttempt);
      setLiveCase(optimistic);
      onUpdated(optimistic);
    }
    try {
      let updated = await recordRetentionOutcome(caseId, outcome, extra ?? {});
      const events: RetentionCaseEventRow[] = [
        localRetentionEvent(caseId, {
          fromStatus,
          toStatus: updated.statusCode,
          eventType: 'outcome_recorded',
          notes: statusLabel(updated.statusCode),
          ...(callForAttempt ? { channel: 'ringcentral' } : {}),
        }),
      ];

      if (outcome === 'out_of_reach' && callForAttempt) {
        try {
          const afterStage = updated.statusCode;
          updated = await logRetentionAttempt(
            caseId,
            'ringcentral',
            pendingRcNote(callForAttempt),
          );
          events.unshift(
            attemptEvent(
              caseId,
              afterStage,
              updated,
              'ringcentral',
              pendingRcNote(callForAttempt),
            ),
          );
          setPendingCall(null);
        } catch (e) {
          applyUpdate(
            updated,
            events,
            'Moved to Out of Reach',
            e instanceof Error ? e.message : 'Retry RingCentral attempt log',
          );
          setStatusPick('');
          return;
        }
      } else {
        setPendingCall(null);
      }

      applyUpdate(
        updated,
        events,
        'Status saved',
        callForAttempt && outcome === 'out_of_reach'
          ? `Moved to Out of Reach · RingCentral ${updated.outOfReachAttempts}/5`
          : statusLabel(updated.statusCode),
      );
      setStatusPick('');
      // Close after stage choice so the board card can move into the new column.
      if (opts?.close !== false) onClose();
    } catch (e) {
      setLiveCase(row);
      onUpdated(row);
      pushToast('Update failed', e instanceof Error ? e.message : 'Could not record outcome');
    } finally {
      setBusy(false);
    }
  };

  const onConfirmStage = (): void => {
    if (statusPick === 'reached') void act('reached');
    else if (statusPick === 'vacation') {
      const note = reasonNote.trim();
      void act('vacation', note ? { reasonNote: note } : undefined);
    } else if (statusPick === 'out_of_reach') void act('out_of_reach');
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

  const onCall = (): void => {
    if (!row || !contactPhone?.trim()) {
      pushToast('No phone', 'No DWH contact number for this carrier');
      return;
    }
    setDialContext({
      retentionCaseId: caseId,
      ...(row.zohoDealId ? { dealId: row.zohoDealId } : {}),
    });
    setAwaitingCallEnd(true);
    if (!clickToDial(contactPhone)) {
      setAwaitingCallEnd(false);
      pushToast('RingCentral not ready', 'Open the phone widget, then try again');
    }
  };

  const onLogOtherChannel = async (): Promise<void> => {
    if (busy || !row || forceAttempt) return;
    if (row.statusCode !== 'p1_out_of_reach') {
      pushToast('Mark Out of Reach first', 'Channel attempts start after OoR stage');
      return;
    }
    if (channel === 'ringcentral') {
      await logRcAttempt(pendingCall);
      return;
    }
    const note = attemptNote.trim() || undefined;
    if (!evidenceFile && !note) {
      pushToast('Proof required', 'Add a screenshot or a short note');
      return;
    }
    const fromStatus = row.statusCode;
    setBusy(true);
    const optimistic = bumpAttempts(row);
    setLiveCase(optimistic);
    onUpdated(optimistic);
    try {
      const evidenceUrl = evidenceFile ? await fileToEvidenceDataUrl(evidenceFile) : undefined;
      const updated = await logRetentionAttempt(caseId, channel, note, evidenceUrl);
      const pooled = updated.statusCode === 'p1_open_pool';
      applyUpdate(
        updated,
        attemptEvent(caseId, fromStatus, updated, channel, note, evidenceUrl),
        pooled ? 'Sent to Open Pool' : 'Attempt logged',
        pooled
          ? '5 attempts — Ryan + deal owner notified'
          : `${updated.outOfReachAttempts}/5 · choose stage below`,
      );
      clearAttemptUi({ keepStage: !pooled });
      if (pooled) onClose();
    } catch (e) {
      setLiveCase(row);
      onUpdated(row);
      pushToast('Log failed', e instanceof Error ? e.message : 'Could not log attempt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={requestClose}
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
        <RetentionCaseHeader
          loading={initialLoad}
          companyName={row?.companyName || 'Case'}
          carrierId={row?.carrierId ?? caseId}
          phoneDisplay={phoneDisplay}
          phoneLoading={!initialLoad && phoneLoading}
          onClose={requestClose}
        />

        <div
          className="ss-scroll"
          style={s('flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column;gap:16px')}
        >
          {detail.error && (
            <div style={s('color:var(--danger);font-size:13px')}>{detail.error}</div>
          )}

          {initialLoad && <RetentionDetailSkeleton />}

          {row && (
            <>
              <RetentionInactivityBlock row={row} />
              <RetentionMetaGrid row={row} />
              {row.isOpen &&
                row.phaseCode === 'phase_1_agent' &&
                row.statusCode !== 'p1_open_pool' && (
                  <RetentionCaseActions
                    row={row}
                    busy={busy}
                    contactPhone={contactPhone}
                    phoneLoading={phoneLoading}
                    newWizardStep={newWizardStep}
                    forceStage={forceStage}
                    forceAttempt={forceAttempt}
                    pendingCall={pendingCall}
                    reason={reason}
                    reasonNote={reasonNote}
                    channel={channel}
                    attemptNote={attemptNote}
                    evidenceFile={evidenceFile}
                    evidencePreview={evidencePreview}
                    statusPick={statusPick}
                    setStatusPick={setStatusPick}
                    setReason={setReason}
                    setReasonNote={setReasonNote}
                    setChannel={setChannel}
                    setAttemptNote={setAttemptNote}
                    setEvidenceFile={setEvidenceFile}
                    onCall={onCall}
                    onAct={act}
                    onDissatisfied={onDissatisfied}
                    onConfirmStage={onConfirmStage}
                    onLogPhoneCall={async () => {
                      await logRcAttempt(pendingCall);
                    }}
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
                  can claim it from the Open Pool tab (max 3 assignments).
                </div>
              )}
              {/* New stage: call-first — no timeline until a stage is chosen */}
              {!isNewStatus(row.statusCode) &&
                (eventsLoading ? (
                  <div style={s('display:flex;flex-direction:column;gap:8px')} aria-busy="true">
                    <div className="ss-skel" style={s('height:12px;width:30%')} />
                    <div className="ss-skel" style={s('height:56px')} />
                    <div className="ss-skel" style={s('height:56px')} />
                  </div>
                ) : (
                  <RetentionEventTrail events={liveEvents} />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
