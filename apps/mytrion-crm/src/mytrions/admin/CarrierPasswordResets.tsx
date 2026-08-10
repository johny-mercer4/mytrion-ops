/**
 * Pending mini-app password resets — split out of CarrierUsers to stay under the file-size cap.
 * Admin sees the tenant-wide queue; resolving sets a new password and clears the request.
 */
import { useState } from 'react';
import {
  resolvePasswordReset,
  type PasswordResetRequest,
} from '../../api/carrierUsers';
import { adminToast } from './toast';
import s from './admin.module.css';

export function CarrierPasswordResets({
  resets,
  loading,
  onResolved,
}: {
  resets: PasswordResetRequest[];
  loading: boolean;
  onResolved: () => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save(id: string) {
    if (password.length < 4) {
      adminToast.error('Password too short', 'Use at least 4 characters.');
      return;
    }
    setBusyId(id);
    try {
      await resolvePasswordReset(id, password);
      adminToast.success('Password updated', 'The user can log in with the new password.');
      setTargetId(null);
      setPassword('');
      onResolved();
    } catch (e) {
      adminToast.error("Couldn't reset", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={`${s.card} ${s.cardPad}`} style={{ marginTop: 'var(--space-4)' }} aria-label="Pending password resets">
      <div className={s.head} style={{ marginBottom: 'var(--space-2)' }}>
        <div>
          <h3 className={s.cardTitle} style={{ margin: 0 }}>Pending password resets</h3>
          <p className={s.sub} style={{ marginTop: 4 }}>
            Forgot-password requests from the Telegram mini-app. Set a new password to unlock login.
            Sales Manage shows the same queue scoped to one carrier.
          </p>
        </div>
        <span className={s.chipMeta}>{loading ? '…' : `${resets.length} pending`}</span>
      </div>

      {loading && <p className={s.cellSub}>Loading reset requests…</p>}
      {!loading && resets.length === 0 && (
        <p className={s.none} style={{ margin: 0 }}>No pending password reset requests.</p>
      )}
      {!loading &&
        resets.map((r) => (
          <div
            key={r.id}
            className={s.tRow}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr auto',
              gap: 'var(--space-3)',
              alignItems: 'center',
              padding: '12px 0',
              borderTop: '1px solid var(--border2)',
            }}
          >
            <div className={s.cellStack}>
              <span className={s.docTitle}>{r.companyName ?? '—'}</span>
              <span className={s.cellSub}>
                {r.login} · {r.profile}
                {r.carrierId ? ` · ${r.carrierId}` : ''}
              </span>
              {r.note && <span className={s.cellSub}>{r.note}</span>}
            </div>
            <span className={s.cellSub}>{r.agentName ?? '—'}</span>
            <span className={s.cellSub} title={new Date(r.createdAt).toLocaleString()}>
              {new Date(r.createdAt).toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {targetId === r.id ? (
                <>
                  <input
                    type="password"
                    className={s.searchInput}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="New password (min 4)"
                    aria-label={`New password for ${r.login}`}
                    style={{ width: 180, height: 32 }}
                  />
                  <button
                    type="button"
                    className={s.primaryBtn}
                    style={{ height: 32, padding: '0 12px', fontSize: 12 }}
                    disabled={busyId === r.id || password.length < 4}
                    onClick={() => void save(r.id)}
                  >
                    {busyId === r.id ? '…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={s.ghostBtn}
                    style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    onClick={() => { setTargetId(null); setPassword(''); }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={s.miniBtn}
                  onClick={() => { setTargetId(r.id); setPassword(''); }}
                >
                  Set new password
                </button>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}
