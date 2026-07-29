/**
 * Signed-in worker profile — opened from the sidebar username.
 *
 * Details are always read-only (name, email, Zoho profile/role, plus the linked HR employee row when
 * present). The only write is the profile picture.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, X } from 'lucide-react';
import { setMyAvatar } from '../../api/auth';
import { getHrMe, type HrEmployeeDto } from '../../api/hr';
import {
  useReloadUserContext,
  useUserContext,
} from '../../context/UserContextProvider';
import { resizeImageToDataUrl } from './resizeImageDataUrl';
import styles from './UserProfileModal.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function UserProfileModal({ onClose }: { onClose: () => void }) {
  const user = useUserContext();
  const reload = useReloadUserContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [employee, setEmployee] = useState<HrEmployeeDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => {
    let cancelled = false;
    void getHrMe()
      .then((row) => {
        if (!cancelled) setEmployee(row);
      })
      .catch(() => {
        // Not linked / no HR grant — session fields alone are enough.
        if (!cancelled) setEmployee(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPick = async (file: File | null): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await setMyAvatar(dataUrl);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onClear = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await setMyAvatar(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 id="user-profile-title">Profile</h2>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className={styles.hero}>
          <div className={styles.avatarWrap}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className={styles.avatarImg} />
            ) : (
              <span className={styles.avatarFallback}>{initials(user.userName)}</span>
            )}
            <button
              type="button"
              className={styles.cameraBtn}
              aria-label="Upload profile picture"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={14} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
          <div className={styles.heroText}>
            <div className={styles.name}>{user.userName || '—'}</div>
            <div className={styles.meta}>
              {[user.profile, user.role].filter(Boolean).join(' · ') || '—'}
            </div>
            <div className={styles.photoActions}>
              <button
                type="button"
                className={styles.textBtn}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {user.avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {user.avatarUrl ? (
                <button
                  type="button"
                  className={styles.textBtnDanger}
                  disabled={busy}
                  onClick={() => void onClear()}
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <section className={styles.section}>
          <h3>Account</h3>
          <dl className={styles.grid}>
            <Field label="Name" value={user.userName || null} />
            <Field label="Email" value={user.email ?? null} mono />
            <Field label="Zoho profile" value={user.profile || null} />
            <Field label="Zoho role" value={user.role || null} />
          </dl>
          <p className={styles.hint}>
            These details come from your Zoho sign-in and cannot be edited here.
          </p>
        </section>

        {employee === undefined ? (
          <p className={styles.loading}>Loading employee record…</p>
        ) : employee ? (
          <section className={styles.section}>
            <h3>Employee record</h3>
            <dl className={styles.grid}>
              <Field label="Employee ID" value={employee.employeeId} mono />
              <Field label="Department" value={employee.department} />
              <Field label="Designation" value={employee.designation} />
              <Field label="Status" value={employee.status} />
              <Field label="Location" value={employee.location} />
              <Field label="Mobile" value={employee.mobile} mono />
              <Field label="Face ID" value={employee.faceId} mono />
              <Field label="Reports to" value={employee.reportingTo} />
              <Field label="Joined" value={employee.dateOfJoining} mono />
            </dl>
            <p className={styles.hint}>
              Directory fields are managed by HR admins — view only from your profile.
            </p>
          </section>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  const text = (value ?? '').trim();
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined}>{text || '—'}</dd>
    </div>
  );
}
