/**
 * Signed-in worker profile — opened from Profile in the account menu.
 *
 * Details are always read-only (name, email, Zoho profile/role, plus the linked HR employee row
 * when present). The only write is the profile picture.
 *
 * Rebuilt on `ds/Dialog`. The hand-rolled version was a bare div with its own backdrop and its own
 * Escape listener and NO focus trap, so Tab walked straight out of the modal into the page behind
 * it. It also stacked thirteen read-only fields in one scrolling column — the hero, four account
 * fields and nine employee fields — which is what made it read as a wall rather than a profile.
 *
 * The fields are split across tabs instead: identity stays visible in the header, and each tab is
 * one short list you can take in at a glance. That is the "pagination" this screen needed — the
 * content is small, it was the presentation that was flat.
 */
import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Dialog, Tabs } from '../../ds';
import { setMyAvatar } from '../../api/auth';
import { getHrMe, type HrEmployeeDto } from '../../api/hr';
import { useReloadUserContext, useUserContext } from '../../context/UserContextProvider';
import { initials } from '../../lib/initials';
import { resizeImageToDataUrl } from './resizeImageDataUrl';
import styles from './UserProfileModal.module.css';

type TabValue = 'account' | 'employee';

export function UserProfileModal({ onClose }: { onClose: () => void }) {
  const user = useUserContext();
  const reload = useReloadUserContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [employee, setEmployee] = useState<HrEmployeeDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabValue>('account');

  useEffect(() => {
    let cancelled = false;
    void getHrMe()
      .then((row) => {
        if (!cancelled) setEmployee(row);
      })
      .catch(() => {
        // Not linked / no HR grant — the session fields alone are enough.
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
      await setMyAvatar(await resizeImageToDataUrl(file));
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

  /**
   * The employee tab is offered once we know there IS a record — but the SLOT is held while we find
   * out, disabled. Appending a tab after the fetch resolved moved the whole strip under the
   * pointer; a user who had already reached for "Account" got a different target.
   *
   * It carried a `count: 9` badge, which read as nine things needing attention. It was the number of
   * read-only fields.
   */
  const loadingEmployee = employee === undefined;
  const hasEmployee = Boolean(employee);
  const items = [
    { value: 'account', label: 'Account' },
    ...(hasEmployee || loadingEmployee
      ? [
          {
            value: 'employee' as const,
            label: 'Employee record',
            ...(loadingEmployee ? { disabled: true, title: 'Looking for your HR record…' } : {}),
          },
        ]
      : []),
  ];

  return (
    <Dialog
      open
      // `busy` blocks dismissal while an avatar upload is in flight — closing mid-request would
      // leave the reload firing against an unmounted tree.
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Profile"
      subtitle={[user.profile, user.role].filter(Boolean).join(' · ') || undefined}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <div className={styles.body}>
        <div className={styles.hero}>
          <Avatar
            size="lg"
            initials={initials(user.userName)}
            {...(user.avatarUrl ? { src: user.avatarUrl } : {})}
          />
          <div className={styles.heroText}>
            <p className={styles.name}>{user.userName || '—'}</p>
            <p className={styles.email}>{user.email || '—'}</p>
            <div className={styles.photoActions}>
              <Button
                size="sm"
                variant="secondary"
                icon="photo_camera"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {user.avatarUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {user.avatarUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="delete"
                  disabled={busy}
                  onClick={() => void onClear()}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
        </div>

        <Tabs
          items={items}
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          size="sm"
        >
          {tab === 'account' ? (
            <div className={styles.panel}>
              <dl className={styles.grid}>
                <Field label="Name" value={user.userName} />
                <Field label="Email" value={user.email} mono />
                <Field label="Zoho profile" value={user.profile} />
                <Field label="Zoho role" value={user.role} />
              </dl>
              <p className={styles.hint}>
                These come from your Zoho sign-in and cannot be edited here.
              </p>
            </div>
          ) : employee ? (
            <div className={styles.panel}>
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
            </div>
          ) : null}
        </Tabs>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function Field({ label, value, mono }: {
  label: string;
  value?: string | null | undefined;
  mono?: boolean | undefined;
}) {
  const text = (value ?? '').trim();
  return (
    <div className={styles.field}>
      <dt className={styles.label}>{label}</dt>
      {/* An empty value still renders an em dash, so the two columns never fall out of step. */}
      <dd className={mono ? styles.mono : styles.value}>{text || '—'}</dd>
    </div>
  );
}
