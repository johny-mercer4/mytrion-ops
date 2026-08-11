import { useEffect, useRef, useState } from 'react';
import { MYTRIONS } from '../../access/mytrions.config';
import { findTab, tabsFor } from '../../access/tabRegistry';
import { getEffectiveAccess, type EffectiveAccessResponse } from '../../api/permissionSets';
import { useModalFocus } from '../_shared/useModalFocus';
import s from './admin.module.css';

/**
 * "Why can this person see that?"
 *
 * Permission sets are additive across four layers, and additive systems are undebuggable without
 * provenance — you can look at a user's row, a profile default, a role default and three sets and
 * still not know which one is responsible. This answers it in words.
 *
 * The case it exists for is the tab scope that DIDN'T apply. A set scoping Billing to Ledger is
 * defeated by any unscoped grant of Billing from any other layer, and the layers that defeat it
 * (profile and role defaults) have no tab column to inspect — so without this the admin has literally
 * nothing to look at. `unscopedBy` names the culprit.
 */
export function EffectiveAccessDrawer({
  zohoUserId,
  onClose,
}: {
  zohoUserId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<EffectiveAccessResponse | null>(null);
  const [error, setError] = useState('');
  const panelRef = useModalFocus<HTMLDivElement>();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getEffectiveAccess(zohoUserId)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not resolve access');
      });
    return () => {
      cancelled = true;
    };
  }, [zohoUserId]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trace = data?.trace;

  return (
    <div
      className={s.modalBackdrop}
      onMouseDown={(e) => {
        // Origin check, same as UserAccessForm: a text drag started inside the panel and released on
        // the backdrop also fires a click here, and this drawer is full of text people select.
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${s.modal} ${s.accessModal}`}
        role="dialog"
        aria-modal="true"
        aria-label="Effective access"
      >
        <div className={s.modalHead}>
          <span className={s.cardTitle}>
            Effective access{data?.worker.name ? ` — ${data.worker.name}` : ''}
          </span>
          <button type="button" className={s.linkBtn} onClick={onClose}>
            Close
          </button>
        </div>

        {error && <p className={s.noticeNote}>{error}</p>}
        {!data && !error && <p className={s.noticeNote}>Resolving…</p>}

        {data && (
          <div className={s.profileCardBody}>
            {data.access.allDepartmentAccess && (
              <p className={s.noticeNote}>
                All-department access — every Mytrion and every tab. Tab scopes are not applied to
                an all-access grant.
              </p>
            )}
            {trace?.allDeptDowngraded && (
              <p className={s.noticeNote}>
                An all-access grant was downgraded to explicit departments because a deny list
                exists — all-access is a full bypass and cannot express “everything except X”.
              </p>
            )}

            {trace?.mytrions.map((entry) => {
              const title = MYTRIONS[entry.mytrion]?.title ?? entry.mytrion;
              const total = tabsFor(entry.mytrion).length;
              return (
                <div key={entry.mytrion} className={s.permissionSetRow}>
                  <strong>
                    {title} — {entry.mode === 'read' ? 'Read-only' : 'Full'}
                  </strong>
                  <p className={s.noticeNote}>
                    Granted by {entry.grantedBy.map((g) => g.label).join(' and ') || 'a default'}.
                    {' '}Mode from {entry.modeFrom.label}.
                  </p>

                  {entry.tabs.scoped ? (
                    <p className={s.noticeNote}>
                      {entry.tabs.keys.length} of {total} tabs:{' '}
                      {entry.tabs.keys
                        .map((k) => findTab(entry.mytrion, k)?.label ?? k)
                        .join(', ') || 'none'}
                    </p>
                  ) : entry.tabs.unscopedBy ? (
                    /* The whole reason this drawer exists. */
                    <p className={s.noticeNote}>
                      <strong>All tabs</strong> — {entry.tabs.unscopedBy.label} grants {title}{' '}
                      without a tab scope, so the permission set’s narrower scope has no effect. To
                      make it apply, remove {title} from that layer so the set is the only source.
                    </p>
                  ) : (
                    <p className={s.noticeNote}>All {total} tabs.</p>
                  )}
                </div>
              );
            })}

            {trace && trace.mytrions.length === 0 && (
              <p className={s.noticeNote}>No Mytrions — this worker cannot enter the portal.</p>
            )}
            {trace && trace.denied.length > 0 && (
              <p className={s.noticeNote}>
                Denied by the per-user override: {trace.denied.join(', ')}.
              </p>
            )}
            {!trace && <p className={s.noticeNote}>Access resolved, but provenance was unavailable.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
