/**
 * The Audit Log row detail — every column of one event, including the raw `detail` JSON.
 *
 * Split from AuditLog.tsx to keep that file inside the 580-line target once the filter bar and the
 * export path landed there.
 */
import { useEffect, useRef } from 'react';
import type { AuditEntry } from '../../api/audit';
import { XIcon } from '../../components/icons';
import { useModalFocus } from '../_shared/useModalFocus';
import s from './admin.module.css';

/** "Who" cell: display name first, falling back to the raw user id. */
function actorName(e: AuditEntry): string {
  return e.userName ?? e.userId ?? 'system';
}

export function AuditDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  // Initial focus, the Tab cycle and focus restore come from the shared hook: the panel declares
  // aria-modal="true", so Tab must not walk into the filter chips still focusable behind the backdrop.
  const panelRef = useModalFocus<HTMLDivElement>();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className={s.modalBackdrop}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`Audit event ${entry.action}`}
        tabIndex={-1}
      >
        <div className={s.modalHead}>
          <span className={s.cardTitle}>{entry.action}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.metaGrid}>
          <Meta label="When" value={new Date(entry.createdAt).toLocaleString()} />
          <Meta label="Status" value={entry.status} />
          <Meta label="User" value={actorName(entry)} />
          <Meta label="User id" value={entry.userId ?? '—'} />
          <Meta label="Profile" value={entry.profile ?? '—'} />
          <Meta label="Role" value={entry.callerRole ?? entry.role ?? '—'} />
          <Meta label="Audience" value={entry.audience ?? '—'} />
          <Meta label="Company" value={entry.company ?? '—'} />
          <Meta label="Acting agent" value={entry.actingAgent ?? '—'} />
          <Meta label="Impersonator" value={entry.impersonatorUserId ?? '—'} />
          <Meta
            label="Resource"
            value={
              entry.resourceId ? `${entry.resourceType ?? ''} ${entry.resourceId}`.trim() : '—'
            }
          />
          <Meta label="IP" value={entry.ip ?? '—'} />
        </div>

        {entry.detail && (
          <div className={s.chunkCard}>
            <div className={s.chunkMeta}>
              <span className={s.mono}>detail</span>
            </div>
            <pre className={s.chunkText}>{JSON.stringify(entry.detail, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.metaValue}>{value}</span>
    </div>
  );
}
